// MiniMax API 封装：歌词生成 + 音乐生成
// 共用 base_url + 同一种 Bearer 鉴权
//
// 文档来源（已用真实 OpenAPI 验证过的字段）：
// - 歌词生成: https://api.minimaxi.com/v1/lyrics_generation
// - 音乐生成: https://api.minimaxi.com/v1/music_generation
//
// 错误码定义（base_resp.status_code）：
//   0    - 成功
//   1002 - 限流
//   1004 - 鉴权失败
//   1008 - 余额不足
//   1026 - 输入含敏感内容
//   2013 - 入参异常
//   2049 - 无效 API Key

const BASE_URL = 'https://api.minimaxi.com';

// 业务层错误码 → HTTP 状态码 + 默认错误信息
const ERROR_CODE_MAP = {
  1002: { status: 503, message: '触发限流，请稍后重试' },
  1004: { status: 502, message: 'API Key 鉴权失败' },
  1008: { status: 502, message: '账户余额不足' },
  1026: { status: 400, message: '输入包含敏感内容' },
  2013: { status: 400, message: '传入参数异常' },
  2049: { status: 502, message: '无效的 API Key' },
};

/** 把 base_resp 错误转成抛错（含 HTTP 状态） */
function throwIfApiError(baseResp, contextLabel) {
  if (!baseResp || baseResp.status_code === 0) return;
  const code = baseResp.status_code;
  const mapped = ERROR_CODE_MAP[code];
  const err = new Error(
    `${contextLabel} 失败: ${mapped?.message || baseResp.status_msg || '未知错误'} (code=${code})`
  );
  err.statusCode = mapped?.status || 500;
  err.apiCode = code;
  throw err;
}

// ============== 通用 fetch + 超时 ==============
// EdgeOne Pages Functions 是 V8 Isolates，单次执行超时（默认 ~30s）。
// 音乐生成实测可能 30-90s，调用方需要自己用 AbortController 控制超时。

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 通用：调一次 MiniMax API，自动检查 base_resp 错误 */
async function callMiniMaxApi({ endpoint, body, apiKey, timeoutMs, contextLabel }) {
  const res = await fetchWithTimeout(
    `${BASE_URL}${endpoint}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      // 关键：预编码为 UTF-8 Buffer，避免 Node.js fetch 内部把含中文的 body 字符串
      // 当作 Latin-1 ByteString 转换时报 "Cannot convert argument to a ByteString"。
      body: Buffer.from(JSON.stringify(body), 'utf-8'),
    },
    timeoutMs
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `${contextLabel} HTTP ${res.status}: ${errText.slice(0, 500)}`
    );
  }

  const data = await res.json();
  throwIfApiError(data?.base_resp, contextLabel);
  return data;
}

// ============== 歌词生成 ==============
// 输入：prompt（自然语言描述，主题/场景/曲风等）
// 返回：{ song_title, style_tags, lyrics } — lyrics 带 [Verse]/[Chorus] 段落标签，
//       可直接喂给 generateMusic() 的 lyrics 参数
export async function generateLyrics({ prompt, apiKey, timeoutMs = 30_000 }) {
  const data = await callMiniMaxApi({
    endpoint: '/v1/lyrics_generation',
    body: {
      mode: 'write_full_song',
      prompt,
    },
    apiKey,
    timeoutMs,
    contextLabel: 'MiniMax 歌词生成',
  });

  return {
    songTitle: data?.song_title || 'Untitled',
    styleTags: data?.style_tags || '',
    lyrics: data?.lyrics || '',
  };
}

// ============== 音乐生成 ==============
// 输入：lyrics（带 [Verse]/[Chorus] 标签的结构化文本）、style（自然语言风格描述）
// 输出：{ audioUrl, durationMs, sampleRate, bitrate, sizeBytes }
//
// 重要：audioUrl 24 小时过期，前端必须在收到后立即 fetch 存为 Blob。
// 不能缓存 audioUrl 等以后再用。
export async function generateMusic({ lyrics, style, apiKey, timeoutMs = 120_000 }) {
  const data = await callMiniMaxApi({
    endpoint: '/v1/music_generation',
    body: {
      model: 'music-2.6',
      prompt: style,
      lyrics,
      audio_setting: {
        sample_rate: 44100,
        bitrate: 256000,
        format: 'mp3',
      },
      output_format: 'url',
    },
    apiKey,
    timeoutMs,
    contextLabel: 'MiniMax music-2.6',
  });

  // 响应结构（per OpenAPI spec）：
  //   data.audio: 当 output_format=url 时是 https URL；hex 时是十六进制字符串
  //   data.status: 1=合成中 / 2=已完成
  //   extra_info: { music_duration(ms), music_sample_rate, bitrate, music_size, ... }
  // 我们用 url 模式 + 同步调用，data.status 应该是 2
  const audioUrl = data?.data?.audio;
  if (typeof audioUrl !== 'string' || !audioUrl.startsWith('http')) {
    throw new Error(
      `MiniMax music-2.6 响应缺少 audio URL 字段。data.status=${data?.data?.status}，` +
      `响应前 500 字：${JSON.stringify(data).slice(0, 500)}`
    );
  }
  if (data.data.status !== 2) {
    // 防御：理论上同步调用不会出现 status=1
    throw new Error(
      `MiniMax music-2.6 状态异常: status=${data.data.status}（预期 2=已完成）`
    );
  }

  return {
    audioUrl,
    durationMs: data?.extra_info?.music_duration,
    sampleRate: data?.extra_info?.music_sample_rate,
    bitrate: data?.extra_info?.bitrate,
    sizeBytes: data?.extra_info?.music_size,
    channels: data?.extra_info?.music_channel,
    raw: data,
  };
}
