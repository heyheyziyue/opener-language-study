# Frontend 集成文档（stage 2 用）

> 给前端同事 / 未来自己的对接文档。**不是**后端运行时需要的文件。

## 1. endpoint

```
POST ${VITE_API_BASE}/api/generate
```

`VITE_API_BASE` 是 EdgeOne Pages Functions 部署后的域名，例如：
- 本地开发：`http://localhost:8787`
- 线上：`https://opener-xxx.edgeone.app`（或自定义域名）

## 2. 请求

```ts
interface GenerateRequest {
  userInput: string;       // 必填，≤500 字符
  language?: string;       // 可选，默认 "en"
}

fetch(`${API_BASE}/api/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userInput: '我想学咖啡店点单',
    language: 'en',  // 可省
  }),
});
```

## 3. 响应

### 3.1 成功 200

```ts
interface GenerateResponse {
  title: string;                          // 短歌名 → 作为 Song.name
  style: string;                          // 风格描述（逗号分隔多个标签）
  lyrics: string;                         // 带 [Verse]/[Chorus] 段落标签，**没有时间戳**
  audioUrl: string;                       // MiniMax 音频 URL，**24h 过期**
  audioSetting: {
    sampleRate: number;
    bitrate: number;
    format: 'mp3';
  };
  audioMeta: {
    durationMs: number;                   // 歌曲时长（毫秒），用于显示 "3:24"
    sizeBytes: number;                    // 音频大小（字节）
    channels: number;                     // 声道数（通常 2=立体声）
  };
}
```

### 3.2 错误

```ts
interface ErrorResponse {
  error: string;   // 人类可读
}

// HTTP 状态码
// 400 - 请求体非法 / userInput 空 / 超 500 字 / 输入含敏感内容
// 500 - MINIMAX_API_KEY 未配 / 其他未捕获异常
// 502 - 上游 API 错误：API Key 错 / 鉴权失败 / 歌词端点返回空 / 音频响应缺字段
// 503 - 触发限流
// 504 - 生成超时（>120s 或 EdgeOne 30s 限制）
```

## 4. 前端使用流程

### 4.1 拿到响应后

```ts
const res = await fetch(`${API_BASE}/api/generate`, { ... });
const data: GenerateResponse = await res.json();

// ⚠️ 关键：audioUrl 24h 过期，必须立刻 fetch 转 Blob 存进 IndexedDB
const audioBlob = await fetch(data.audioUrl).then(r => r.blob());

// 把 lyrics 解析成 LyricLine[]
// 注意：lyrics 是 [Verse]/[Chorus] 结构化文本，**没有时间戳**
// 先看 src/lib/lrcParser.ts 是否能处理这种格式；不能的话写个新解析器
// 简化方案：去掉段落标签，按行切，每行 LyricLine.timestamp = undefined
import { generateId } from '../lib/storage';
import type { LyricLine } from '../lib/types';

const rawLines = data.lyrics
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('[') || l.match(/^\[(?:Verse|Chorus|Intro|Outro)/i));
// ↑ 上面这行只是示意，stage 2 实际写解析器时再细化

const lyricLines: LyricLine[] = rawLines.map(text => ({
  id: generateId(),
  text,
  timestamp: undefined,            // 用户后续手动加
  clipStart: undefined,
  clipEnd: undefined,
}));

// 构造 Song，写进 IndexedDB
import { saveSong } from '../lib/storage';
const song: Song = {
  id: generateId(),
  name: data.title,
  audioBlob,                       // 看 types.ts 字段名确认
  lyrics: lyricLines,
  createdAt: new Date().toISOString(),
  folderId: undefined,
};
await saveSong(song);

// 跳转到歌词页
navigate(`/lyrics/${song.id}`);
```

### 4.2 ⚠️ 关于 lyrics 解析

后端返回的 `lyrics` 形如：
```
[Verse 1]
Hi, can I get a coffee?
Sure, what size?
(Verse 的伴唱)
...
[Chorus]
Hi, can I get a coffee?
Sure, what size?
```

特点：
- 段落标签：`[Verse]` / `[Verse 1]` / `[Chorus]` / `[Intro]` / `[Outro]` / `[Bridge]` / `[Pre-Chorus]` 等
- 伴唱/和声用 `(...)` 包裹
- **没有 `[mm:ss.xx]` 时间戳**

建议 stage 2 处理：
- **方案 A**（推荐）：写个小解析器，识别 `[段落]` 标签作为分组信息，正文行作为 `LyricLine.text`，全部 `timestamp = undefined` 让用户手动加
- **方案 B**：去掉所有 `[...]` 段落标签和 `(...)` 伴唱，把正文按行切，粗暴一点
- **方案 C**：原样显示，让用户自己删/编辑

### 4.3 关于 `audioUrl` vs `audioBlob`

**先看 `src/lib/types.ts` 里 Song 怎么定义的音频字段**：
- 如果是 `audioBlob: Blob`：把 `audioUrl` fetch 下来转 Blob 存（上面代码已写）
- 如果是 `audioUrl: string`：直接存 `data.audioUrl`

### 4.4 用户加时间戳

进歌词页后，每行 LyricLine.timestamp / clipStart / clipEnd 都是 undefined。
- 用户播放音频，听到对应行时点击"设时间戳"按钮 → 记录当前 audio.currentTime
- 这一步是现有"用户上传"流程就有的功能，**不需要新代码**
- 歌词页（LyricsPage）应该已经支持这个交互

### 4.5 超时与降级

- 后端最长 120s（我们设的 `MUSIC_TIMEOUT_MS`），EdgeOne 强制 30s 截断
- 前端 fetch 用 `AbortController` 设 90s 超时比较合适
- 超时后给用户"生成超时，请重试"提示

## 5. UI 交互建议

输入页建议元素：
- 大文本框（≤500 字）
- 语言下拉（默认 English，可选 Japanese/Chinese/Spanish）
- 「生成」按钮（点击后禁用 + spinner）
- 加载文案：建议"AI 正在写歌 + 谱曲，约需 30-60 秒"

错误兜底文案建议：
- 400: "请检查输入内容"
- 500/502/503/504: "生成失败，请重试。如多次失败请稍后再试。"

## 6. 测试建议

后端真机测试：
1. 在 EdgeOne Pages 控制台部署 `edge-functions/`
2. 配置 `MINIMAX_API_KEY`
3. 用 curl 测 happy path（见 `edge-functions/README.md`）
4. 确认返回的 `audioUrl` 能直接 `<audio src=...>` 播放
5. 跑 2-3 次看 `style` 是否有变化（确认随机感）

集成测试：
1. 在 dev 环境用 Vite 5173 调 EdgeOne Functions 本地服务
2. CORS 应当自动放开（`cors.js` 里 `Allow-Origin: *`）
3. 完成后端到端联调
