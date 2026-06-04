/**
 * LRC 歌词格式解析器
 *
 * LRC 格式示例：
 *   [ti:歌名]
 *   [ar:艺人]
 *   [00:01.23]第一句歌词
 *   [00:05.67]第二句歌词
 *   [00:10.00]第三句
 *
 * 支持变体：
 *   - [mm:ss.xx]  / [mm:ss.xxx]（2 或 3 位毫秒）
 *   - [mm:ss]（无毫秒，按 0 处理）
 *   - 同一行多时间戳：[00:01.23][00:05.67]同一句（取第一个）
 *   - 元数据行 [ti:..] [ar:..] [al:..] [by:..] [offset:..] 跳过
 *
 * 返回的 lines 已按 timestamp 升序排列。
 */

export interface ParsedLrcLine {
  /** 唯一 ID（解析时生成，前端用 key） */
  id: string;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 歌词文本（已 trim） */
  text: string;
}

export interface ParsedLrc {
  title?: string;
  artist?: string;
  album?: string;
  /** 解析失败的行（含原因） */
  errors: { line: string; reason: string }[];
  lines: ParsedLrcLine[];
}

/** 匹配单个时间戳：[mm:ss.xx] / [mm:ss.xxx] / [mm:ss] */
const TIMESTAMP_RE = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;

/** 元数据键（[ti:..] 这种，key 不是数字开头） */
const METADATA_KEY_RE = /^\[([a-zA-Z][a-zA-Z0-9_]*):(.*)\]$/;

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseTimestampLine(line: string): {
  timestamps: number[];
  text: string;
  metadata?: { key: string; value: string };
} | null {
  // 元数据：[ti:..] [ar:..] 等
  const trimmed = line.trim();
  if (!trimmed) return null;

  const meta = trimmed.match(METADATA_KEY_RE);
  if (meta) {
    return { timestamps: [], text: "", metadata: { key: meta[1].toLowerCase(), value: meta[2].trim() } };
  }

  // 提取所有时间戳 + 剩余文本
  const timestamps: number[] = [];
  let cursor = 0;
  // 用全局正则匹配所有 [..] 时间戳
  const matches = Array.from(trimmed.matchAll(TIMESTAMP_RE));
  if (matches.length === 0) return null;

  for (const m of matches) {
    const mm = parseInt(m[1], 10);
    const ss = parseInt(m[2], 10);
    const msStr = m[3] || "0";
    // [ms.xx] 2 位 → 实际是 厘秒 × 10；[ms.xxx] 3 位 → 毫秒
    const ms = msStr.length === 3
      ? parseInt(msStr, 10)
      : parseInt(msStr.padEnd(2, "0"), 10) * 10; // xx → xx0 毫秒
    const total = mm * 60_000 + ss * 1000 + ms;
    timestamps.push(total);
    cursor = (m.index ?? 0) + m[0].length;
  }

  const text = trimmed.slice(cursor).trim();
  return { timestamps, text };
}

export function parseLrc(input: string): ParsedLrc {
  const result: ParsedLrc = { errors: [], lines: [] };

  // 拆分并解析
  const rawLines = input.split(/\r?\n/);
  for (const raw of rawLines) {
    const parsed = parseTimestampLine(raw);
    if (!parsed) continue;

    if (parsed.metadata) {
      const { key, value } = parsed.metadata;
      if (key === "ti" || key === "title") result.title = value;
      else if (key === "ar" || key === "artist") result.artist = value;
      else if (key === "al" || key === "album") result.album = value;
      // 其他元数据（by, length, offset 等）忽略
      continue;
    }

    if (parsed.timestamps.length === 0) continue;
    // 取第一个时间戳
    const timestamp = parsed.timestamps[0];
    // 文本可为空（纯音乐行 / 伴奏标记）
    result.lines.push({
      id: nextId(),
      timestamp,
      text: parsed.text,
    });
  }

  // 按时间戳排序
  result.lines.sort((a, b) => a.timestamp - b.timestamp);

  return result;
}

/**
 * 从已解析的 LRC lines 自动生成 clipStart / clipEnd 范围。
 *
 * 规则（方案 1：纯时间戳推断）：
 *   - clipStart = line.timestamp
 *   - clipEnd = nextLine.timestamp - 200ms（留 200ms 间隙）
 *   - 若是最后一行：clipEnd = timestamp + 5000ms
 *   - 跳过纯空行（text 为空）不生成 clip
 *
 * 全部返回"推荐"值，由 UI 层决定是否应用（用户可手动调整）。
 */
export interface ClipSuggestion {
  clipStart: number;
  clipEnd: number;
  /** 是否为推荐值（用户可改） */
  suggested: true;
}

export function buildClipSuggestions(lines: ParsedLrcLine[]): Map<string, ClipSuggestion> {
  const out = new Map<string, ClipSuggestion>();
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    if (!cur.text) continue; // 跳过空行
    const next = lines[i + 1];
    const clipStart = cur.timestamp;
    const clipEnd = next ? Math.max(clipStart + 500, next.timestamp - 200) : cur.timestamp + 5000;
    out.set(cur.id, { clipStart, clipEnd, suggested: true });
  }
  return out;
}
