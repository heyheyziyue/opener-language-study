import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { Song, FavoriteLine, LyricLine } from "./types";

const DB_NAME = "opener-db";
const DB_VERSION = 1;

interface OpenerDB {
  songs: Song;
  favorites: FavoriteLine;
}

let dbPromise: Promise<IDBPDatabase<OpenerDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OpenerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Songs store
        if (!db.objectStoreNames.contains("songs")) {
          db.createObjectStore("songs", { keyPath: "id" });
        }
        // Favorites store
        if (!db.objectStoreNames.contains("favorites")) {
          const store = db.createObjectStore("favorites", { keyPath: "id" });
          store.createIndex("by-song", "songId");
        }
      },
    });
  }
  return dbPromise;
}

// Songs
export async function saveSong(song: Song) {
  const db = await getDb();
  await db.put("songs", song);
  return song;
}

export async function getSong(id: string) {
  const db = await getDb();
  return db.get("songs", id);
}

export async function getAllSongs() {
  const db = await getDb();
  return db.getAll("songs");
}

export async function deleteSong(id: string) {
  const db = await getDb();
  await db.delete("songs", id);
}

// Favorites
export async function saveFavorite(favorite: FavoriteLine) {
  const db = await getDb();
  await db.put("favorites", favorite);
  return favorite;
}

export async function getAllFavorites() {
  const db = await getDb();
  return db.getAll("favorites");
}

export async function getFavoritesBySong(songId: string) {
  const db = await getDb();
  return db.getAllFromIndex("favorites", "by-song", songId);
}

export async function deleteFavorite(id: string) {
  const db = await getDb();
  await db.delete("favorites", id);
}

// 更新收藏夹中指定歌词行的引用（当歌词内容或时间戳变化时调用）
export async function updateFavoritesByLineId(songId: string, lineId: string, updatedLine: LyricLine) {
  const db = await getDb();
  const allFavs = await db.getAllFromIndex("favorites", "by-song", songId);
  for (const fav of allFavs) {
    if (fav.line.id === lineId) {
      fav.line = updatedLine;
      await db.put("favorites", fav);
    }
  }
}

// 删除收藏夹中指定歌词行的所有引用（当歌词行被删除时调用）
export async function deleteFavoritesByLineId(songId: string, lineId: string) {
  const db = await getDb();
  const allFavs = await db.getAllFromIndex("favorites", "by-song", songId);
  for (const fav of allFavs) {
    if (fav.line.id === lineId) {
      await db.delete("favorites", fav.id);
    }
  }
}

// 删除歌曲的所有收藏记录
export async function deleteFavoritesBySongId(songId: string) {
  const db = await getDb();
  const allFavs = await db.getAllFromIndex("favorites", "by-song", songId);
  for (const fav of allFavs) {
    await db.delete("favorites", fav.id);
  }
}

export async function updateFavoritePractice(id: string, practiceCount: number, speed: number) {
  const db = await getDb();
  const favorite = await db.get("favorites", id);
  if (favorite) {
    favorite.practiceCount = practiceCount;
    favorite.speed = speed;
    await db.put("favorites", favorite);
  }
}

// Generate unique ID
export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Create LyricLine helper
export function createLyricLine(text: string): LyricLine {
  return {
    id: generateId(),
    text,
  };
}