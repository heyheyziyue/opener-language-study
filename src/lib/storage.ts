import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { Song, FavoriteLine, LyricLine, Folder } from "./types";

const DB_NAME = "opener-db";
const DB_VERSION = 2;

interface OpenerDB {
  songs: Song;
  favorites: FavoriteLine;
  folders: Folder;
}

let dbPromise: Promise<IDBPDatabase<OpenerDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OpenerDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1: songs + favorites
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains("songs")) {
            db.createObjectStore("songs", { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains("favorites")) {
            const store = db.createObjectStore("favorites", { keyPath: "id" });
            store.createIndex("by-song", "songId");
          }
        }
        // v2: folders
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains("folders")) {
            db.createObjectStore("folders", { keyPath: "id" });
          }
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

// ===== Folders (v2) =====
// 注意：folderId 在 FavoriteLine 上是 optional 字段，
// 已存在的 v1 数据没有 folderId，UI 渲染时归到"未分类"组

export async function saveFolder(folder: Folder) {
  const db = await getDb();
  await db.put("folders", folder);
  return folder;
}

export async function getAllFolders(): Promise<Folder[]> {
  const db = await getDb();
  return db.getAll("folders");
}

export async function renameFolder(id: string, newName: string) {
  const db = await getDb();
  const folder = await db.get("folders", id);
  if (folder) {
    folder.name = newName;
    await db.put("folders", folder);
  }
  return folder;
}

// 删除文件夹：级联清除组内收藏的 folderId（→ 自动归到"未分类"）
export async function deleteFolder(id: string) {
  const db = await getDb();
  await db.delete("folders", id);
  // 把所有引用此文件夹的收藏 folderId 置为 undefined
  const tx = db.transaction("favorites", "readwrite");
  const allFavs = await tx.objectStore("favorites").getAll();
  for (const fav of allFavs) {
    if (fav.folderId === id) {
      fav.folderId = undefined;
      await tx.objectStore("favorites").put(fav);
    }
  }
  await tx.done;
}

// 移动单条收藏到指定文件夹(传入 undefined = 移到"未分类")
export async function moveFavoriteToFolder(favoriteId: string, folderId: string | undefined) {
  const db = await getDb();
  const fav = await db.get("favorites", favoriteId);
  if (fav) {
    fav.folderId = folderId;
    await db.put("favorites", fav);
  }
  return fav;
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