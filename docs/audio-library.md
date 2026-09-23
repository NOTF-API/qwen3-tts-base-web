# 本地语音库与 VoiceDesign

## 音频记录

记录使用服务端 SQLite 保存，不依赖浏览器 localStorage。刷新与重启不会丢失已保存的记录。
API 返回的 `id` 是不透明字符串。`url` 指向原始 WAV；`available` 表示文件存在。
`generated` 保存上次成功合成使用的参数，顶层参数是当前编辑版本。
二者不同表示需要重新生成；失败时保留旧 WAV。

角色情绪支持选择已有标签或手动输入，列表与编辑弹窗均可修改；空白仍默认为「平静」。
情绪在 Base 克隆中用于定位角色的 `.pt` 文件，不是任意情绪指令；没有匹配文件时生成返回 404，
需要先创建对应音色。自由描述音色或表达方式请使用 VoiceDesign，描述可在列表内或编辑弹窗修改。
历史导入音频也可以补充或修改情绪标签，但修改标签不会改变原 WAV 的声音。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/clips` | 读取全部记录，纳入旧 `output/*.wav` |
| POST | `/api/clips` | 新建台词草稿，返回 201 |
| GET | `/api/clips/{id}` | 获取单条记录 |
| PATCH | `/api/clips/{id}` | 部分更新名称与参数 |
| DELETE | `/api/clips/{id}` | 删除记录及其原始音频 |
| GET | `/api/clips/{id}/download` | 下载单条原始 WAV |
| POST | `/api/clips/export` | 按 `ids` 顺序打包 WAV 与 `manifest.json` |
| GET | `/api/capabilities` | VoiceDesign 完整性、离线状态、当前模型 |

创建/修改可用字段：`title`、`text`、`role`、`emotion`、`language`、`synthesis_mode`
（`clone`/`design`/`legacy`）、`instruct`、`speaker`、`signal`、`delay`、`position`。
不能通过编辑接口修改文件路径、ID 或生成快照。文件丢失时单条下载返回 404，批量导出返回 409。
批量导出示例：`{"ids":["record-id-1","record-id-2"]}`，最多 1000 条，重复 ID 自动去重。

旧 `/api/tts` 请求和响应字段保持兼容，新增可选 `clip_id`，生成成功后更新该草稿/记录。
不传 `clip_id` 时自动创建记录。`mode=file` 仍返回 WAV，同时保留本地记录。
在生成期间删除记录，生成结果不会重新创建它。

## 描述音色

`POST /api/voice-design`：

```json
{
  "text": "你好，欢迎来到语音工作台。",
  "instruct": "年轻女性，温暖清晰的中音，语速舒缓，带自然的微笑感。",
  "language": "Chinese",
  "mode": "url",
  "allow_download": false
}
```

`text` 与 `instruct` 必填且不能只有空白。`language` 使用模型英文标识，页面显示原生语言名。
`mode` 支持 `url` 与 `file`；可选 `clip_id` 复用已有记录。
URL 响应包含 `status`、`filename`、`url`、`local_path` 和完整的 `clip` 记录。

使用 `Qwen3-TTS-12Hz-1.7B-VoiceDesign.generate_voice_design(text, instruct, language)`，
不是把提示词附加到 Base 的克隆方法。缺失或不完整的模型返回 409 与缺失项。
显式 `allow_download=true` 后，服务通过独立下载进程复用国内源/官方回退和完整性校验；
服务配置为离线时，即使该标志为 true 也不联网。首次下载和模型切换可能较慢，服务终端显示下载日志。

模型在推理锁内切换，旧模型释放后才加载新模型；下载失败时保留原模型。
加载失败时健康接口报告未就绪，后续请求可以重试加载。回到角色合成或制作克隆音色时切回 Base。
同一描述多次生成不保证完全一致的说话人；需要固定角色时，可将生成的 WAV 作为参考音频创建 `.pt`。

## 验证

```bash
.venv-tools/bin/python -m pytest -q
node tests/browser_audio_library.cjs
node tests/browser_recording.cjs
```

浏览器测试需要安装 Playwright 与 Chromium，可用 `NODE_PATH` 指定已有的 Playwright 安装，
用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定 Chromium 可执行文件。
它通过模拟 API 验证桌面端生成、播放、失败重试、刷新恢复、编辑、下载确认、离线拒绝、导出和删除。
后端测试使用临时目录、模拟模型，不访问用户数据或下载模型。
录音测试使用 Chromium 虚拟麦克风与真实 MediaRecorder 编码，覆盖权限拒绝、延迟授权后取消、
录音、试听、裁切后的 WAV 上传、重录、时长限制、麦克风释放与文件上传回退；不访问真实麦克风。
Safari 等其他浏览器及真实麦克风的音质尚需手动验收。
这些测试不替代 VoiceDesign 在真实 MPS/CUDA 设备上的音质与内存验收。
