/**
 * 内置示例歌曲 Seed
 *
 * 首次启动时（IndexedDB 中无 sample-song-1），自动从 public/ 拉取音频 + LRC
 * 写入 IndexedDB 并创建 3-4 条示例收藏。已存在则跳过（幂等）。
 *
 * 触发逻辑：App.tsx 顶层 useEffect 调用 seedSampleSongIfMissing()
 * 失败策略：fetch 失败或解析失败时静默放弃，不阻塞主应用
 */

import { saveSong, saveFavorite, getSong, generateId } from "./storage";
import { parseLrc, buildClipSuggestions } from "./lrcParser";
import type { Song, FavoriteLine } from "./types";

const SAMPLE_SONG_ID = "sample-song-1";
const AUDIO_URL = "/sample-song.mp3";
const LRC_URL = "/sample-song.lrc";

/** 示例收藏：精选 3-4 句"练习价值高"的歌词行 */
const SAMPLE_FAVORITE_LINE_INDICES = [3, 5, 6, 7]; // 0-based：第 4、6、7、8 句

/**
 * 幂等：若 sample-song-1 已存在则直接返回；否则下载并写入。
 * 返回 'inserted' | 'exists' | 'failed' 便于 App.tsx 调试日志。
 */
export async function seedSampleSongIfMissing(): Promise<"inserted" | "exists" | "failed"> {
  try {
    // 1. 幂等检查
    const existing = await getSong(SAMPLE_SONG_ID);
    if (existing) return "exists";

    // 2. 并行下载音频 + LRC
    const [audioRes, lrcRes] = await Promise.all([
      fetch(AUDIO_URL),
      fetch(LRC_URL),
    ]);
    if (!audioRes.ok || !lrcRes.ok) {
      console.warn(`[seed] fetch failed: audio=${audioRes.status}, lrc=${lrcRes.status}`);
      return "failed";
    }
    const [audioBlob, lrcText] = await Promise.all([audioRes.blob(), lrcRes.text()]);

    // 3. 解析 LRC
    const parsed = parseLrc(lrcText);
    if (parsed.lines.length === 0) {
      console.warn("[seed] LRC parsed to 0 lines, aborting");
      return "failed";
    }
    const suggestions = buildClipSuggestions(parsed.lines);

    // 4. 构建 Song（含 timestamp + 自动 clip）
    const song: Song = {
      id: SAMPLE_SONG_ID,
      name: parsed.title || "示例歌曲",
      audioBlob,
      lyrics: parsed.lines.map((l) => {
        const sug = suggestions.get(l.id);
        return {
          id: generateId(),
          text: l.text,
          timestamp: l.timestamp,
          clipStart: sug?.clipStart,
          clipEnd: sug?.clipEnd,
        };
      }),
      createdAt: new Date().toISOString(),
    };
    await saveSong(song);

    // 5. 写入示例收藏
    for (const idx of SAMPLE_FAVORITE_LINE_INDICES) {
      const line = song.lyrics[idx];
      if (!line) continue;
      const fav: FavoriteLine = {
        id: `sample-fav-${idx}`,
        songId: song.id,
        songName: song.name,
        line,
        practiceCount: 0,
        speed: 1,
        createdAt: new Date().toISOString(),
      };
      await saveFavorite(fav);
    }

    console.log(
      `[seed] inserted sample song: ${song.name} (${song.lyrics.length} lyrics, ${SAMPLE_FAVORITE_LINE_INDICES.length} favorites)`
    );
    return "inserted";
  } catch (err) {
    console.warn("[seed] failed:", err);
    return "failed";
  }
}
