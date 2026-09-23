"""Persistent output and VoiceDesign regression tests, with no GPU or downloads."""

import io
import json
import threading
import zipfile
from dataclasses import replace
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from qwen3_tts_web.library import AudioLibrary


@pytest.fixture
def api(tmp_path, monkeypatch):
    from qwen3_tts_web import server

    monkeypatch.setattr(server, "OUT_DIR", tmp_path / "output")
    monkeypatch.setattr(server, "settings", replace(server.settings, root=tmp_path))
    calls = []

    def generate(**kwargs):
        calls.append(kwargs)
        return [np.sin(np.arange(2400) * 0.1).astype(np.float32)], 24000

    monkeypatch.setattr(
        server,
        "model",
        SimpleNamespace(generate_voice_design=generate, generate_voice_clone=generate),
    )
    monkeypatch.setattr(server, "active_model_key", "voicedesign")
    client = TestClient(server.app)
    try:
        yield client, server, calls
    finally:
        client.close()


def test_design_crud_export_and_reopen(api):
    client, server, calls = api
    draft = client.post(
        "/api/clips",
        json={
            "title": "测试名称",
            "text": "你好",
            "instruct": "温暖的女声",
            "synthesis_mode": "design",
        },
    ).json()
    key = draft["id"]
    response = client.post(
        "/api/voice-design",
        json={"text": "你好", "instruct": "温暖的女声", "clip_id": key},
    )
    assert response.status_code == 200, response.text
    record = response.json()["clip"]
    assert record["available"] and record["duration"] > 0
    assert calls == [{"text": "你好", "instruct": "温暖的女声", "language": "Chinese"}]
    assert AudioLibrary(server.OUT_DIR).list()[0]["id"] == key
    assert client.get(record["url"]).headers["content-type"] == "audio/wav"
    audio, rate = sf.read(io.BytesIO(client.get(record["url"]).content))
    assert rate == 24000 and np.isfinite(audio).all() and np.any(audio)
    changed = client.patch(
        "/api/clips/" + key,
        json={"title": "改名", "instruct": "低沉的男声", "delay": 1.5},
    ).json()
    assert changed["title"] == "改名"
    assert changed["generated"]["instruct"] == "温暖的女声"
    assert client.get("/api/clips/" + key).json()["delay"] == 1.5
    download = client.get("/api/clips/" + key + "/download")
    assert download.content == client.get(record["url"]).content
    export = client.post("/api/clips/export", json={"ids": [key, key]})
    assert export.status_code == 200
    with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
        assert len(archive.namelist()) == 2
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest[0]["title"] == "改名"
        assert manifest[0]["generated"]["instruct"] == "温暖的女声"
    assert client.delete("/api/clips/" + key).status_code == 200
    assert client.get(record["url"]).status_code == 404
    assert client.get("/api/clips").json() == {"clips": []}
    assert client.get("/api/clips/" + key).status_code == 404


@pytest.mark.parametrize(
    "emotion, expected",
    [("期待", "期待"), (" 愤怒 ", "愤怒"), ("", "平静"), (None, "平静")],
)
def test_edit_emotion_persists(api, emotion, expected):
    client, server, _ = api
    record = client.post("/api/clips", json={"role": "Test"}).json()
    response = client.patch("/api/clips/" + record["id"], json={"emotion": emotion})
    assert response.status_code == 200
    assert response.json()["emotion"] == expected
    assert AudioLibrary(server.OUT_DIR).get(record["id"])["emotion"] == expected


def test_legacy_import_and_missing_file(api):
    client, server, _ = api
    server.OUT_DIR.mkdir()
    sf.write(server.OUT_DIR / "旧音频.wav", np.ones(500), 24000)
    (server.OUT_DIR / "broken.wav").write_bytes(b"invalid")
    records = client.get("/api/clips").json()["clips"]
    assert len(records) == 1 and records[0]["synthesis_mode"] == "legacy"
    assert client.get("/api/clips").json()["clips"][0]["id"] == records[0]["id"]
    (server.OUT_DIR / "旧音频.wav").unlink()
    assert not client.get("/api/clips").json()["clips"][0]["available"]
    assert (
        client.post("/api/clips/export", json={"ids": [records[0]["id"]]}).status_code
        == 409
    )
    assert client.get("/api/clips/" + records[0]["id"] + "/download").status_code == 404


def test_database_and_arbitrary_files_not_public(api):
    client, server, _ = api
    client.get("/api/clips")
    assert (server.OUT_DIR / "library.sqlite3").exists()
    assert client.get("/static/audio/library.sqlite3").status_code == 404
    assert client.get("/static/audio/..%2Flibrary.sqlite3").status_code == 404


def test_legacy_filename_is_url_encoded(api):
    client, server, _ = api
    server.OUT_DIR.mkdir()
    sf.write(server.OUT_DIR / "中文 #1%.wav", np.ones(500), 24000)
    record = client.get("/api/clips").json()["clips"][0]
    assert "%23" in record["url"] and "%25" in record["url"]
    assert client.get(record["url"]).status_code == 200


@pytest.mark.parametrize(
    "changes",
    [
        {"filename": "../../private"},
        {"delay": -1},
        {"synthesis_mode": "bogus"},
        {"instruct": "x" * 2001},
    ],
)
def test_metadata_validation(api, changes):
    client, _, _ = api
    assert client.post("/api/clips", json=changes).status_code == 422


@pytest.mark.parametrize(
    "payload", [{"text": " ", "instruct": "voice"}, {"text": "hello", "instruct": ""}]
)
def test_design_requires_text_and_prompt(api, payload):
    client, _, calls = api
    assert client.post("/api/voice-design", json=payload).status_code == 422
    assert not calls


def test_regeneration_replaces_file_only_after_success(api, monkeypatch):
    client, server, _ = api
    record = client.post(
        "/api/voice-design", json={"text": "hello", "instruct": "warm"}
    ).json()["clip"]
    old_path = server.OUT_DIR / record["filename"]
    original = server.model.generate_voice_design
    monkeypatch.setattr(
        server.model,
        "generate_voice_design",
        lambda **kw: ([np.array([np.nan])], 24000),
    )
    assert (
        client.post(
            "/api/voice-design",
            json={"text": "hello", "instruct": "warm", "clip_id": record["id"]},
        ).status_code
        == 500
    )
    assert old_path.is_file()
    monkeypatch.setattr(server.model, "generate_voice_design", original)
    response = client.post(
        "/api/voice-design",
        json={"text": "hello again", "instruct": "warm", "clip_id": record["id"]},
    )
    assert response.status_code == 200
    assert not old_path.exists()
    assert len(client.get("/api/clips").json()["clips"]) == 1


def test_deleted_during_inference_not_resurrected(api, monkeypatch):
    client, server, _ = api
    record = client.post("/api/clips", json={}).json()

    def generate(**kwargs):
        AudioLibrary(server.OUT_DIR).delete(record["id"])
        return [np.ones(200)], 24000

    monkeypatch.setattr(server.model, "generate_voice_design", generate)
    response = client.post(
        "/api/voice-design",
        json={"text": "hello", "instruct": "warm", "clip_id": record["id"]},
    )
    assert response.status_code == 404
    assert client.get("/api/clips").json()["clips"] == []
    assert not list(server.OUT_DIR.glob("*.wav"))


def test_model_switch_consent_offline_and_reload(api, monkeypatch):
    client, server, _ = api
    from qwen3_tts_web import models

    monkeypatch.setattr(server, "active_model_key", "base")
    monkeypatch.setattr(
        models, "validate_model", lambda *args: ["model.safetensors missing"]
    )
    calls = []
    monkeypatch.setattr(
        models,
        "prepare_model",
        lambda *args, **kw: calls.append(("prepare", kw["key"])),
    )
    monkeypatch.setattr(server, "free", lambda: calls.append(("free", server.model)))
    fake_model = server.model
    monkeypatch.setattr(
        server,
        "load",
        lambda *args, **kw: calls.append(("load", kw["key"])) or fake_model,
    )
    payload = {"text": "你好", "instruct": "低沉男声"}
    assert client.post("/api/voice-design", json=payload).status_code == 409
    assert not calls
    monkeypatch.setattr(server, "settings", replace(server.settings, offline=True))
    assert (
        client.post(
            "/api/voice-design", json={**payload, "allow_download": True}
        ).status_code
        == 409
    )
    assert not calls
    monkeypatch.setattr(server, "settings", replace(server.settings, offline=False))
    assert (
        client.post(
            "/api/voice-design", json={**payload, "allow_download": True}
        ).status_code
        == 200
    )
    assert calls == [
        ("prepare", "voicedesign"),
        ("free", None),
        ("load", "voicedesign"),
    ]
    assert server.active_model_key == "voicedesign"


def test_concurrent_metadata_updates_do_not_drop_fields(tmp_path):
    library = AudioLibrary(tmp_path)
    record = library.create({"text": "original"})
    threads = [
        threading.Thread(target=library.update, args=(record["id"], {f"field{i}": i}))
        for i in range(10)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    result = AudioLibrary(tmp_path).get(record["id"])
    assert all(result[f"field{i}"] == i for i in range(10))


def test_download_failure_keeps_active_model(api, monkeypatch):
    client, server, _ = api
    from qwen3_tts_web import models

    old_model = server.model
    monkeypatch.setattr(server, "active_model_key", "base")
    monkeypatch.setattr(models, "validate_model", lambda *args: ["missing"])

    def fail(*args, **kwargs):
        raise RuntimeError("download failed")

    monkeypatch.setattr(models, "prepare_model", fail)
    response = client.post(
        "/api/voice-design",
        json={"text": "hello", "instruct": "warm", "allow_download": True},
    )
    assert response.status_code == 500
    assert server.model is old_model and server.active_model_key == "base"


def test_prepare_model_forwards_explicit_download_key(tmp_path, monkeypatch):
    from qwen3_tts_web import models, process
    from qwen3_tts_web.config import Settings

    settings = Settings(root=tmp_path)
    calls = []
    monkeypatch.setattr(models, "validate_model", lambda *args: ["missing"])
    monkeypatch.setattr(
        process.Runner,
        "run",
        lambda self, command, **kwargs: calls.append((command, kwargs)),
    )
    monkeypatch.setattr(
        models, "ensure_model", lambda settings, key, **kwargs: (settings.offline, key)
    )
    assert models.prepare_model(settings, key="voicedesign") == (True, "voicedesign")
    assert calls[0][0][-2:] == ["--model-key", "voicedesign"]
    assert calls[0][1]["env"]["QWEN3_TTS_ROOT"] == str(tmp_path)
