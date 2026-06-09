import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { Song, FavoriteLine, LyricLine, Folder, FolderScope } from "./types";

const DB_NAME = "opener-db";
const DB_VERSION = 3;

interface OpenerDB {
  songs: Song;
  favorites: FavoriteLine;
  folders: Folder;
}

let dbPromise: Promise<IDBPDatabase<OpenerDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OpenerDB>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
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
        // v2: folders（无 scope 字段）
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains("folders")) {
            db.createObjectStore("folders", { keyPath: "id" });
          }
        }
        // v3: folders 加 scope 字段，把 v2 时期的文件夹回填到 "favorites" 作用域
        // （v2 时期功能只服务于收藏夹，库页 v2.2.19 才加）
        if (oldVersion < 3) {
          if (db.objectStoreNames.contains("folders")) {
            const store = transaction.objectStore("folders");
            const all = await store.getAll();
            for (const f of all) {
              if (!(f as Folder).scope) {
                (f as Folder).scope = "favorites";
                await store.put(f);
              }
            }
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

// ===== Folders (v2 + v3 scope) =====
// v2: 加 folders 仓库（无 scope）
// v3: Folder 加 scope 字段（'songs' | 'favorites'），歌曲夹和收藏夹完全隔离
// v1 时期的收藏没有 folderId 字段，UI 渲染时归到"未分类"组

export async function saveFolder(folder: Folder) {
  const db = await getDb();
  await db.put("folders", folder);
  return folder;
}

export async function getAllFolders(scope: FolderScope): Promise<Folder[]> {
  const db = await getDb();
  const all = await db.getAll("folders");
  return all.filter((f) => f.scope === scope);
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

// 删除文件夹：只级联清除同 scope 下的引用（歌曲夹只清歌曲，收藏夹只清收藏）
export async function deleteFolder(id: string, scope: FolderScope) {
  const db = await getDb();
  await db.delete("folders", id);
  if (scope === "favorites") {
    const tx = db.transaction("favorites", "readwrite");
    const allFavs = await tx.objectStore("favorites").getAll();
    for (const fav of allFavs) {
      if (fav.folderId === id) {
        fav.folderId = undefined;
        await tx.objectStore("favorites").put(fav);
      }
    }
    await tx.done;
  } else {
    const tx = db.transaction("songs", "readwrite");
    const allSongs = await tx.objectStore("songs").getAll();
    for (const song of allSongs) {
      if (song.folderId === id) {
        song.folderId = undefined;
        await tx.objectStore("songs").put(song);
      }
    }
    await tx.done;
  }
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

// 移动单首歌曲到指定文件夹(传入 undefined = 移到"未分类")
export async function moveSongToFolder(songId: string, folderId: string | undefined) {
  const db = await getDb();
  const song = await db.get("songs", songId);
  if (song) {
    song.folderId = folderId;
    await db.put("songs", song);
  }
  return song;
}

// 更新单首歌曲的文件夹内排序序号
export async function updateSongOrder(songId: string, order: number) {
  const db = await getDb();
  const song = await db.get("songs", songId);
  if (song) {
    song.order = order;
    await db.put("songs", song);
  }
  return song;
}

// 更新单条收藏的文件夹内排序序号
export async function updateFavoriteOrder(favoriteId: string, order: number) {
  const db = await getDb();
  const fav = await db.get("favorites", favoriteId);
  if (fav) {
    fav.order = order;
    await db.put("favorites", fav);
  }
  return fav;
}

// 批量更新歌曲的 order（拖拽落位时一次写入所有变更）
export async function batchUpdateSongOrders(orders: Array<{ id: string; order: number }>) {
  const db = await getDb();
  const tx = db.transaction("songs", "readwrite");
  for (const { id, order } of orders) {
    const song = await tx.objectStore("songs").get(id);
    if (song) {
      song.order = order;
      await tx.objectStore("songs").put(song);
    }
  }
  await tx.done;
}

// 批量更新收藏的 order
export async function batchUpdateFavoriteOrders(orders: Array<{ id: string; order: number }>) {
  const db = await getDb();
  const tx = db.transaction("favorites", "readwrite");
  for (const { id, order } of orders) {
    const fav = await tx.objectStore("favorites").get(id);
    if (fav) {
      fav.order = order;
      await tx.objectStore("favorites").put(fav);
    }
  }
  await tx.done;
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