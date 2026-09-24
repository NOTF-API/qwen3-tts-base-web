<div align="center">

# Qwen3-TTS Web

**在电脑上运行的本地语音工作台**

角色克隆 · Prompt 音色设计 · 本地语音库 · 批量导出 · 中文 TUI

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](pyproject.toml)
[![License](https://img.shields.io/badge/License-MIT-3DA639)](LICENSE)
![macOS](https://img.shields.io/badge/macOS-Apple_Silicon-000000?logo=apple&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-NVIDIA_CUDA-76B900?logo=nvidia&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-NVIDIA_CUDA-76B900?logo=linux&logoColor=white)
![FastAPI](https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white)

[快速开始](#快速开始) · [常用命令](#常用命令) · [功能与使用](#功能与使用) · [运行要求](#运行要求)

</div>

## 快速开始

**支持 macOS Apple Silicon，以及 Windows / Linux 的 NVIDIA 显卡。** 不需要提前创建虚拟环境；引导脚本会检查 Python 3.11，并在确认后安装缺失工具。

### 1. 获取项目

```bash
git clone https://github.com/NOTF-API/qwen3-tts-base-web.git
cd qwen3-tts-base-web
```

已有项目时，直接在项目目录执行下面的命令。

### 2. 安装并启动

**macOS / Linux**

```bash
# 首次安装依赖并下载 Base 模型
bash scripts/bootstrap.sh setup

# 启动服务，仅允许本机访问
bash scripts/bootstrap.sh serve --host 127.0.0.1
```

**Windows PowerShell**

```powershell
# 首次安装依赖并下载 Base 模型
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 setup

# 启动服务，仅允许本机访问
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 serve --host 127.0.0.1
```

### 3. 打开工作台

浏览器访问 **[http://localhost:8001](http://localhost:8001)**。服务不会自动打开浏览器。

> **更喜欢菜单操作？** macOS / Linux 执行 `bash scripts/bootstrap.sh`；Windows 执行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1`。进入中文 TUI 后选择「安装 / 修复」，完成后选择「启动服务」。

## 常用命令

`setup` 已包含默认模型下载，日常只需 `serve`。以下子命令可接在两个平台入口之后：

| 操作 | 子命令 |
| --- | --- |
| 环境检查，不安装 | `doctor` |
| 安装 / 修复依赖与默认模型 | `setup` |
| 下载默认 Base 模型 | `download` |
| 下载描述音色模型 | `download --model-key voicedesign` |
| 启动本机服务 | `serve --host 127.0.0.1` |
| 离线启动 | `serve --offline --host 127.0.0.1` |

<details>
<summary><strong>完整命令示例与可选参数</strong></summary>

```bash
# macOS / Linux
bash scripts/bootstrap.sh doctor
bash scripts/bootstrap.sh download --model-key voicedesign
bash scripts/bootstrap.sh serve --offline --host 127.0.0.1
```

```powershell
# Windows PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 doctor
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 download --model-key voicedesign
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 serve --offline --host 127.0.0.1
```

| 参数 | 用途 |
| --- | --- |
| `--model 0.6B` | 使用较小的 Base；VoiceDesign 仍为 1.7B |
| `--device mps` / `--device cuda:0` | 指定推理设备 |
| `--port 8002` | 更换端口 |
| `--source official` | 使用官方源 |
| `--yes` | 自动确认安装 / 下载，适用于无人值守 |

管理环境准备完成后，也可使用该环境中的 `qwen3-tts-web` 命令。`doctor` 只检查；首次执行引导脚本时，若管理环境缺失，仍需先确认安装管理工具。

</details>

## 功能与使用

| 功能 | 操作入口 | 结果 |
| --- | --- | --- |
| 角色克隆 | 「克隆音色」上传音频或直接录音，裁切后创建 `.pt`；回到「角色音色」输入台词 | 使用保存的角色音色合成，情绪默认「平静」 |
| Prompt 音色设计 | 「描述音色」填写提示词与台词 | 独立 VoiceDesign 模型生成，无需参考音频 |
| 本地语音库 | 工作台列表 | 刷新 / 重启后恢复，支持搜索、改名、编辑、重新生成与删除 |
| 导出音频 | 单条下载，或勾选后批量导出 | 原始 WAV；批量 ZIP 包含音频与参数清单 |
| 部署管理 | 中文 TUI | 环境检查、依赖修复、模型下载、服务启停与日志 |

**音色描述示例：**「年轻女性，温暖清晰的中音，语速舒缓，带自然的微笑感。」

首次使用「描述音色」时，确认后下载 VoiceDesign 1.7B。Base 与 VoiceDesign 按需切换，设备上只保留一个推理模型，切换需要时间；离线模式不下载缺失模型。`.pt` 角色属于 Base 克隆提示文件，不是上游 CustomVoice 的内置说话人。CustomVoice 目前仅支持下载，尚未接入推理接口。

### 浏览器录音

在「克隆音色」页面选择麦克风，点击「开始录音」并允许权限，录制时显示实时输入波形。结束时点击「停止录音」，可拖动选区或填写起止时间，试听后「确认裁切」，再生成角色 `.pt`。录制最长 2 分钟；无声时会提示检查设备，不保存全静音录音；取消录音保留原参考音频。

使用 `http://localhost:8001/maker` 或 HTTPS 地址录音；普通局域网 HTTP 地址不提供麦克风访问。权限被拒绝时，请在浏览器站点设置中允许麦克风后重试。录音和裁切先在浏览器内处理，只有点击「生成 .pt 文件」才上传裁切后的 WAV；关闭页面前未提交的录音不会保留。

### 本地数据

- WAV 和 `output/library.sqlite3` 共同组成语音库；备份时先停止服务，再备份整个 `output/`。
- 旧 `output/*.wav` 自动纳入列表，不移动文件；旧版未保存的台词和角色信息无法恢复。
- 编辑参数不会修改已有音频；重新生成成功后才替换旧 WAV，失败则保留旧音频。
- 删除需确认，会同时删除记录和对应文件。
- 设备 / 信号音效仅用于浏览器播放，不包含在导出的原始 WAV 中。

## 运行要求

| 平台 | 推理方式 | 建议与限制 |
| --- | --- | --- |
| macOS Apple Silicon | MPS，`float32 + sdpa` | 原生 arm64 Python；建议 24 GiB 统一内存 |
| Windows / Linux NVIDIA | CUDA，按设备选择精度 | 默认 1.7B 至少 6 GiB 显存，Base 0.6B 至少 4 GiB；安装时检查兼容性 |
| 通用 | Python 3.11 | 首次部署建议至少 10 GiB 空闲磁盘；VoiceDesign 需额外空间 |

不承诺 Intel Mac、纯 CPU、AMD GPU 或 MLX 支持，不静默回退 CPU，不默认安装 FlashAttention。

默认下载完整 Base 模型（含内嵌语音 tokenizer，1.7B 约 4.6 GB）。国内源优先、官方源回退，完整模型直接复用。系统音频工具需单独确认安装，不自动安装系统包管理器、不修改全局镜像配置。

## 配置与安全

配置示例见 [config.example.toml](config.example.toml)。项目根目录的 `config.toml` 支持设备、Base 规格、下载源、监听地址和端口。

**优先级：命令行 > `QWEN3_TTS_*` 环境变量 > `config.toml` > 默认值。**

| 地址 | 用途 |
| --- | --- |
| `/` | 语音工作台与本地语音库 |
| `/maker` | 参考音频与克隆角色管理 |
| `/docs` | 交互式 HTTP API 文档 |
| `/api/health` | 模型就绪状态与设备 |

> **安全提示：** 默认监听 `0.0.0.0:8001`，无身份认证，同一局域网内其他设备可能访问并修改数据。仅本机使用请保留快捷命令中的 `--host 127.0.0.1`，不要直接暴露到公网。只加载可信 `.pt` 文件，PyTorch pickle 文件可以执行代码。

## 项目结构

```text
.
├── pyproject.toml             # 包元数据、依赖与 CLI
├── config.example.toml        # 配置示例
├── main.py                    # uvicorn main:app 兼容入口
├── src/qwen3_tts_web/         # 服务、运行时、CLI、TUI
│   ├── constraints/           # macOS / CUDA 固定依赖分支
│   └── web/                   # 桌面 Web 界面
├── scripts/                   # 跨平台引导与启动脚本
├── models/                    # 模型，不提交
├── pt/                        # 角色音色，不提交
├── uploads/                   # 上传音频，不提交
├── references/                # 参考音频，不提交
└── output/                    # WAV 与 SQLite 语音库，不提交
```

管理环境为 `.venv-tools/`，推理环境为 `.venv/`，日志位于 `.logs/`。旧数据目录不迁移、不删除，新音频统一写入 `output/`。

## 项目配置

- [依赖与打包配置](pyproject.toml)
- [配置项示例](config.example.toml)

服务启动后可访问 `/docs` 查看交互式 HTTP API。

## 许可与致谢

本项目使用 [MIT License](LICENSE)。上游代码及模型遵循各自许可证，分发时保留署名与许可文件。

感谢 [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)、PyTorch、ModelScope、FastAPI 与 Textual 社区。
