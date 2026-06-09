// POST /api/generate
// 接收用户自然语言输入，串行调用 MiniMax 歌词生成端点 + music-2.6 音频生成端点，
// 同步返回生成结果（音频 URL + 歌词 + 标题 + 风格）。
//
// EdgeOne Pages Functions 默认单次执行 ~30s；音乐生成实测可能 30-90s。
// 如果实测超时，需要拆成异步 + 轮询（见 README "已知限制"）。

import {
  generateLyrics,
  generateMusic,
} from '../lib/MiniMax.js';
import { jsonResponse, handleOptions } from '../lib/cors.js';

// ===== 配置 =====
const MAX_USER_INPUT_LEN = 500;          // 防止超长输入
const LYRICS_TIMEOUT_MS = 30_000;        // 歌词生成通常 5-15s
const MUSIC_TIMEOUT_MS = 120_000;        // 音乐生成 30-90s，给 buffer
const DEFAULT_LANGUAGE = 'en';

/**
 * 把用户的语言选项翻译成"明确的 prompt 前缀"
 *
 * 原因：专用歌词端点没有语言参数，必须靠 prompt 隐式指定。
 * 实测不写语言时它会偏中文，所以默认 en 时显式写"An English song about"
 */
function buildLyricsPrompt(userInput, language) {
  if (!language || language === 'en') {
    return `An English song about: ${userInput}`;
  }
  // 其他语言：直接传语言代码（"A song in ja about..."）
  return `A song in ${language} about: ${userInput}`;
}

// ===== 主 endpoint =====
export async function onRequestPost({ request, env }) {
  try {
    // 1) 解析 + 校验 body
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: '请求体必须是合法 JSON' }, 400);
    }

    const userInput = typeof body?.userInput === 'string' ? body.userInput.trim() : '';
    if (!userInput) {
      return jsonResponse({ error: 'userInput 不能为空' }, 400);
    }
    if (userInput.length > MAX_USER_INPUT_LEN) {
      return jsonResponse(
        { error: `userInput 超过最大长度 ${MAX_USER_INPUT_LEN} 字符` },
        400
      );
    }
    const language = typeof body?.language === 'string' && body.language.trim()
      ? body.language.trim().toLowerCase()
      : DEFAULT_LANGUAGE;

    // 2) 检查 API key
    const apiKey = env?.MINIMAX_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: '服务端未配置 MINIMAX_API_KEY 环境变量' },
        500
      );
    }

    // 3) 调歌词生成端点
    const lyricsPrompt = buildLyricsPrompt(userInput, language);
    let lyricsResult;
    try {
      lyricsResult = await generateLyrics({
        prompt: lyricsPrompt,
        apiKey,
        timeoutMs: LYRICS_TIMEOUT_MS,
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, e.statusCode || 500);
    }
    const { songTitle, styleTags, lyrics } = lyricsResult;
    if (!lyrics) {
      return jsonResponse(
        { error: '歌词生成端点返回了空的 lyrics 字段' },
        502
      );
    }

    // 4) 调 music-2.6 生成音频
    // 风格：用歌词端点推断出来的 style_tags；为空时用 'Pop' 兜底（不随机，
    // 因为用户输入被歌词端点读取后通常已含风格暗示）
    const style = styleTags.trim() || 'Pop, Feel-good';
    let musicResult;
    try {
      musicResult = await generateMusic({
        lyrics,
        style,
        apiKey,
        timeoutMs: MUSIC_TIMEOUT_MS,
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, e.statusCode || 500);
    }

    // 5) 返回结果
    // 注意：musicResult.audioUrl 24h 过期，前端必须立刻 fetch 存 Blob
    return jsonResponse({
      title: songTitle,
      style,
      lyrics,                  // 带 [Verse]/[Chorus] 段落标签，前端用 parseLrc 或新解析器
      audioUrl: musicResult.audioUrl,
      audioSetting: {
        sampleRate: musicResult.sampleRate || 44100,
        bitrate: musicResult.bitrate || 256000,
        format: 'mp3',
      },
      audioMeta: {
        durationMs: musicResult.durationMs,
        sizeBytes: musicResult.sizeBytes,
        channels: musicResult.channels,
      },
    });
  } catch (err) {
    // 兜底：fetch abort（超时）等未分类错误
    const msg = err?.message || String(err);
    const isAbort = err?.name === 'AbortError';
    return jsonResponse(
      {
        error: isAbort
          ? '生成超时（EdgeOne Pages Functions 单次执行可能 ~30s 限制）'
          : msg,
      },
      isAbort ? 504 : (err.statusCode || 500)
    );
  }
}

// OPTIONS 预检
export async function onRequestOptions() {
  return handleOptions();
}
