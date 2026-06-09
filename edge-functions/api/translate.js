// POST /api/translate
// 接收歌词行数组，1 次 LLM 调用批量翻译（比 MyMemory 逐行调用快 50 倍）
// body: { lines: ["string", ...] }
// returns: { translations: ["string", ...] }
//
// 实现思路：
//   1) 把 N 行歌词按 "1. xxx\n2. yyy" 格式发给 LLM
//   2) prompt 强调"说唱风格、保留俚语"
//   3) LLM 按同样格式返回 "1. 翻译\n2. 翻译"
//   4) 解析回数组，对没解析到的行用原文兜底
//
// 为什么用批量而不是单行多次：
//   - LLM 一次调用比 50 次串行快得多（一次 ~3s，串行 50 次 ~150s）
//   - 上下文更长，LLM 能更好把握整首歌的语气一致性
//   - 成本：单次调用 vs 50 次调用，便宜

import { jsonResponse, handleOptions } from '../lib/cors.js';

const BASE_URL = 'https://api.minimaxi.com';
const TRANSLATE_TIMEOUT_MS = 30_000;        // 30s 限制内，留点 buffer
const MAX_LINES_PER_REQUEST = 100;          // 防止超大输入
const MAX_LINE_LENGTH = 500;                // 单行长度上限

const SYSTEM_PROMPT = `你是一个说唱歌词翻译专家，专门将英文说唱歌词翻译成中文。
要求：
1. 准确传达原意，保留俚语、隐喻和说唱风格（如 slang、押韵、语气词）
2. 翻译自然流畅，符合中文表达习惯
3. 保留原文的语气和情感（不要过度书面化）
4. 直接给出翻译结果，不要任何解释或额外内容`;

/**
 * 把 N 行歌词组织成 "1. xxx\n2. yyy" 格式，方便 LLM 按编号回答
 */
function buildUserPrompt(lines) {
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
  return `请将以下英文说唱歌词翻译成中文，**严格保持行数和顺序**。
每行翻译单独一行，前面加上对应编号（"数字+点+空格"）。
不要添加任何解释、备注或额外内容。

歌词：
${numbered}`;
}

/**
 * 解析 LLM 返回的 "1. 翻译\n2. 翻译" 格式
 * 鲁棒性：容忍空行、编号大小写差异、点号变体
 */
function parseNumberedTranslations(text, expectedCount) {
  const translations = new Array(expectedCount).fill('');
  // 按行处理
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // 匹配 "1. xxx" 或 "1、xxx" 或 "1: xxx"
    const match = line.match(/^(\d+)\s*[.\u3001:、]\s*(.+)$/);
    if (match) {
      const idx = parseInt(match[1], 10) - 1; // 1-based → 0-based
      const trans = match[2].trim();
      if (idx >= 0 && idx < expectedCount && !translations[idx]) {
        translations[idx] = trans;
      }
    }
  }
  return translations;
}

/**
 * 把 OpenAI 风格消息（role/content）转成 MiniMax 老格式（sender_type/sender_name/text）
 * MiniMax chatcompletion_pro 端点限制：
 *   - 不支持 sender_type=SYSTEM
 *   - 必须有 sender_name
 * 解决：把 system 内容合并到第一条 user 消息前面
 */
function convertMessages(messages) {
  // 收集 system 提示 + user 内容，合并成单条 user 消息
  const systemParts = [];
  const userParts = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
    } else if (m.role === 'user') {
      userParts.push(m.content);
    }
    // 忽略 assistant 消息（单轮对话用不到）
  }
  const mergedText = systemParts.length
    ? `${systemParts.join('\n\n')}\n\n---\n\n${userParts.join('\n\n')}`
    : userParts.join('\n\n');
  return [
    {
      sender_type: 'USER',
      sender_name: 'user',
      text: mergedText,
    },
  ];
}

/**
 * 调 MiniMax LLM（chatcompletion_pro 老端点）
 * 兼容多种响应格式（不同 API 版本字段可能不同）
 */
async function callLLM({ messages, apiKey, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/v1/text/chatcompletion_pro`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      // 预编码 UTF-8，避免 V8 Isolates（EdgeOne Pages 运行时）的中文 ByteString 问题
      // 注：不能用 Buffer.from()——Isolates 没 Node.js 的 Buffer 全局对象
      // 用 TextEncoder（Isolates + Node.js + 浏览器都支持）
      // 注意：MiniMax chatcompletion_pro 是老格式 API，必填：
      //   - model: 模型名
      //   - bot_setting: 机器人人设（数组）
      //   - reply_constraints: 谁回复（sender_type/sender_name）
      //   - messages: 每条要有 sender_type + sender_name + text（不是 role/content）
      body: new TextEncoder().encode(JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: convertMessages(messages),
        bot_setting: [
          {
            bot_name: 'LyricTranslator',
            content: SYSTEM_PROMPT,
          },
        ],
        reply_constraints: {
          sender_type: 'BOT',
          sender_name: 'LyricTranslator',
        },
        temperature: 0.3,
        tokens_to_generate: 4096,
      })),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 300)}`);
      err.statusCode = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
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

    const lines = Array.isArray(body?.lines) ? body.lines : null;
    if (!lines || lines.length === 0) {
      return jsonResponse({ error: 'lines 必须是非空数组' }, 400);
    }
    if (lines.length > MAX_LINES_PER_REQUEST) {
      return jsonResponse(
        { error: `单次最多翻译 ${MAX_LINES_PER_REQUEST} 行` },
        400
      );
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (typeof line !== 'string') {
        return jsonResponse({ error: `第 ${i + 1} 行必须是字符串` }, 400);
      }
      if (line.length > MAX_LINE_LENGTH) {
        return jsonResponse(
          { error: `第 ${i + 1} 行超过 ${MAX_LINE_LENGTH} 字符` },
          400
        );
      }
    }

    // 2) 检查 API key
    const apiKey = env?.MINIMAX_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: '服务端未配置 MINIMAX_API_KEY 环境变量' },
        500
      );
    }

    // 3) 调 LLM
    let data;
    try {
      data = await callLLM({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(lines) },
        ],
        apiKey,
        timeoutMs: TRANSLATE_TIMEOUT_MS,
      });
    } catch (e) {
      if (e?.name === 'AbortError') {
        return jsonResponse({ error: '翻译超时（>30s）' }, 504);
      }
      return jsonResponse({ error: e.message }, e.statusCode || 500);
    }

    // 4) 解析 LLM 响应
    // 先检查 base_resp 错误（参考 lib/MiniMax.js 的 throwIfApiError 模式）
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      const code = data.base_resp.status_code;
      const msg = data.base_resp.status_msg || '未知错误';
      return jsonResponse(
        { error: `LLM 错误 (code=${code}): ${msg}` },
        code === 2013 ? 400 : 500
      );
    }

    // 兼容多种字段路径（不同 MiniMax API 版本）
    const content =
      data?.choices?.[0]?.message?.content ??
      data?.reply ??
      data?.data?.reply ??
      '';
    if (!content) {
      return jsonResponse(
        {
          error: 'LLM 响应为空',
          raw: JSON.stringify(data).slice(0, 500),
        },
        502
      );
    }

    const translations = parseNumberedTranslations(content, lines.length);

    // 兜底：没解析到的行用原文
    for (let i = 0; i < translations.length; i++) {
      if (!translations[i]) translations[i] = lines[i];
    }

    return jsonResponse({ translations });
  } catch (err) {
    const msg = err?.message || String(err);
    return jsonResponse({ error: msg }, 500);
  }
}

// OPTIONS 预检
export async function onRequestOptions() {
  return handleOptions();
}
