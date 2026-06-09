# edge-functions/

Opener 项目的腾讯 EdgeOne Pages Functions 后端。当前只有一个 endpoint：

```
POST /api/generate
```

串行调用 MiniMax **歌词生成端点** + **music-2.6**，同步返回：
- 生成的歌曲音频 URL（**24 小时过期**）
- 带 `[Verse]` / `[Chorus]` 段落标签的歌词（**不带时间戳**，用户在前端手动加）
- 推断的曲风（来自歌词端点）
- 标题

## 文件结构

```
edge-functions/
├── api/
│   └── generate.js        # POST /api/generate 主 endpoint
├── lib/
│   ├── MiniMax.js         # 歌词端点 + music-2.6 封装
│   └── cors.js            # CORS 工具（本地跨域开发用）
├── README.md              ← 本文件
└── INTEGRATION.md         # 前端对接文档（stage 2 用）
```

## EdgeOne Pages 控制台配置

1. 创建 Pages 项目，把本仓库 `edge-functions/` 目录作为 Functions 源
2. **环境变量**：项目设置 → 环境变量 → 添加
   - `MINIMAX_API_KEY` = 你的 MiniMax API Key
3. （可选）自定义域名 / 路径

> 暂时不需要 KV 存储：当前设计是单次同步调用，不存任务状态。

## 本地开发 / 测试

EdgeOne Pages 提供本地 CLI（类似 `wrangler`）：

```bash
# 假设 EdgeOne CLI 已安装
edgeone pages dev edge-functions/

# 设置本地环境变量
export MINIMAX_API_KEY=sk-xxx...

# 测试 happy path
curl -X POST http://localhost:8787/api/generate \
  -H "Content-Type: application/json" \
  -d '{"userInput":"我想学咖啡店点单","language":"en"}'

# 测试缺 userInput
curl -X POST http://localhost:8787/api/generate \
  -H "Content-Type: application/json" \
  -d '{}'
```

如果 CLI 启动端口不是 8787，替换成实际端口。

## API 契约

### `POST /api/generate`

**请求体**

```json
{
  "userInput": "我想学咖啡店点单",     // 必填，≤500 字符
  "language": "en"                     // 可选，默认 "en"
}
```

**成功响应 200**

```json
{
  "title": "Coffee Shop Chat",
  "style": "Jazz, Smooth, Late Night",
  "lyrics": "[Verse 1]\nHi, can I get a coffee?\nSure, what size?\n\n[Chorus]\n...",
  "audioUrl": "https://filecdn.minimax.chat/.../song.mp3",
  "audioSetting": { "sampleRate": 44100, "bitrate": 256000, "format": "mp3" },
  "audioMeta": {
    "durationMs": 32450,
    "sizeBytes": 1024000,
    "channels": 2
  }
}
```

**字段说明**：
- `lyrics`：带 `[Verse]` / `[Chorus]` / `[Intro]` / `[Outro]` 等段落标签。**没有时间戳**，用户在前端手动加。
- `audioUrl`：**24 小时内有效**。前端必须在收到后立即 `fetch → Blob` 存进 IndexedDB，不能缓存。
- `audioMeta.durationMs`：歌曲时长（毫秒），可用于前端显示"3:24"。

**错误响应**

| HTTP 状态码 | 含义 | 触发条件 |
|---|---|---|
| 400 | 请求体非法 | JSON 解析失败 / `userInput` 空 / 超 500 字 / MiniMax 1026 敏感词 / 2013 参数错 |
| 500 | 服务端配置/未知错误 | `MINIMAX_API_KEY` 未配 / 其他未捕获异常 |
| 502 | 上游 API 错误 | MiniMax 1004 鉴权失败 / 2049 无效 Key / 歌词端点返回空 / 音频响应缺字段 |
| 503 | 限流 | MiniMax 1002 触发限流 |
| 504 | 超时 | fetch abort（EdgeOne 30s 限制 / 我们的 120s 限制）|

错误响应格式：`{ "error": "人类可读的错误描述" }`

## 已知限制 & 待优化

1. **EdgeOne Pages Functions 默认 ~30s 超时**，music-2.6 实测可能 30-90s。
   缓解方案（未实现，后续可加）：
   - 拆成 2 个 endpoint：先 `/api/lyrics`（快），再 `/api/music`（慢）
   - 加 KV 存任务状态 + 轮询
2. **音频 URL 24h 过期**。当前设计：前端立即 fetch → Blob → 存 IndexedDB（不依赖 URL 持续有效）。如果以后想跨设备同步，需要后端 fetch 音频 → 上传 COS → 返回永久 URL。
3. **歌词端点没有时间戳**。用户在前端用现有的"点击行打时间戳"流程手动加。
4. **没做配额 / 限流 / 用户认证**。本次范围只覆盖核心生成逻辑。

## 调试

- MiniMax API Key 错误（`base_resp.status_code=1004` 或 2049）→ 502，看错误消息
- 限流（1002）→ 503，等几秒重试
- 余额不足（1008）→ 502，去 MiniMax 控制台充值
- 歌词端点偶发返回空 → 502，用同样 prompt 再调一次
- 音乐生成超时 → 504，考虑降级到 `music-2.6-free` 模型（更慢但更便宜/可能更宽松）

## 升级路径

如果以后想：
- **多语言**：`buildLyricsPrompt` 已支持传任意语言代码
- **指定曲风**：用户输入里说"我要爵士风"——歌词端点会自己推断 style_tags；不需要额外代码
- **用户配额 / 鉴权**：在 generate.js 入口加校验逻辑
- **跨设备同步**：后端 fetch audioUrl → 上传腾讯云 COS → Song.audioUrl 存永久 URL（前端不再依赖 MiniMax 链接）
