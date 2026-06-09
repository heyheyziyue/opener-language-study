import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Reorder, motion, AnimatePresence, useDragControls } from "framer-motion";
import {
  getAllSongs,
  deleteSong,
  deleteFavoritesBySongId,
  getAllFolders,
  renameFolder,
  deleteFolder,
  moveSongToFolder,
  batchUpdateSongOrders,
} from "../lib/storage";
import { useAudio } from "../lib/audioContext";
import type { Song, Folder } from "../lib/types";
import FolderPickerModal from "../components/FolderPickerModal";
import "./LibraryPage.css";

const COLLAPSED_KEY = "library-collapsed-folder-ids";

const loadCollapsed = (): Set<string> => {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
};

const saveCollapsed = (set: Set<string>) => {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
};

// 比较函数：order 优先；未指定 order 的按 createdAt 降序
const sortByOrderThenCreated = (a: Song, b: Song): number => {
  if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
  if (a.order !== undefined) return -1;
  if (b.order !== undefined) return 1;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
};

export default function LibraryPage() {
  const navigate = useNavigate();
  const { state: audioState, clearSong } = useAudio();
  const [songs, setSongs] = useState<Song[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());

  // 文件夹管理菜单
  const [openMenuFolderId, setOpenMenuFolderId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [movingSong, setMovingSong] = useState<Song | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAll();
  }, []);

  // ⋯ 菜单点外面关闭
  useEffect(() => {
    if (!openMenuFolderId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuFolderId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuFolderId]);

  const loadAll = async () => {
    const [allSongs, allFolders] = await Promise.all([getAllSongs(), getAllFolders()]);
    setSongs(allSongs);
    setFolders(
      allFolders.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    );
  };

  // ===== 歌曲删除 =====
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("确认删除这首歌曲？")) {
      if (audioState.songId === id) clearSong();
      await deleteFavoritesBySongId(id);
      await deleteSong(id);
      await loadAll();
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (confirm(`确认删除选中的 ${selectedIds.size} 首歌曲？`)) {
      for (const id of selectedIds) {
        if (audioState.songId === id) clearSong();
        await deleteFavoritesBySongId(id);
        await deleteSong(id);
      }
      setSelectedIds(new Set());
      setIsSelectMode(false);
      await loadAll();
    }
  };

  // ===== 选择模式 =====
  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === songs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(songs.map((s) => s.id)));
    }
  };

  // ===== 折叠 / 展开 =====
  const toggleCollapse = (folderId: string) => {
    const newSet = new Set(collapsed);
    if (newSet.has(folderId)) {
      newSet.delete(folderId);
    } else {
      newSet.add(folderId);
    }
    setCollapsed(newSet);
    saveCollapsed(newSet);
  };

  // ===== 文件夹管理 =====
  const handleStartRename = (folder: Folder) => {
    setRenamingFolderId(folder.id);
    setRenamingValue(folder.name);
    setOpenMenuFolderId(null);
  };

  const handleConfirmRename = async () => {
    if (!renamingFolderId) return;
    const name = renamingValue.trim();
    if (!name) {
      setRenamingFolderId(null);
      return;
    }
    await renameFolder(renamingFolderId, name);
    setRenamingFolderId(null);
    setRenamingValue("");
    await loadAll();
  };

  const handleConfirmDeleteFolder = async () => {
    if (!confirmDeleteFolderId) return;
    await deleteFolder(confirmDeleteFolderId);
    setConfirmDeleteFolderId(null);
    await loadAll();
  };

  // ===== 移动单首 / 批量 =====
  const handleMoveSong = async (folderId: string | null | undefined) => {
    if (!movingSong) return;
    await moveSongToFolder(movingSong.id, folderId ?? undefined);
    setMovingSong(null);
    await loadAll();
  };

  const handleBatchMove = async (folderId: string | null | undefined) => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await moveSongToFolder(id, folderId ?? undefined);
    }
    setBatchMoveOpen(false);
    setSelectedIds(new Set());
    setIsSelectMode(false);
    await loadAll();
  };

  // ===== 顶部 + 按钮：新建空文件夹 =====
  const handleCreateFolderFromHeader = async (_newFolderId: string | null | undefined) => {
    setNewFolderOpen(false);
    await loadAll();
  };

  // ===== 拖拽排序 =====
  const handleReorder = useCallback(
    async (groupKey: string, newItems: Song[]) => {
      // 给 newItems 中每项设置 order = index
      setSongs((prev) =>
        prev.map((s) => {
          if (groupKey === "__uncategorized__") {
            if (s.folderId) return s;
          } else if (s.folderId !== groupKey) {
            return s;
          }
          const idx = newItems.findIndex((ni) => ni.id === s.id);
          if (idx >= 0) return { ...s, order: idx };
          return s;
        })
      );
      // 批量持久化
      const orders = newItems.map((item, idx) => ({ id: item.id, order: idx }));
      await batchUpdateSongOrders(orders);
    },
    []
  );

  // ===== 分组（带排序） =====
  const groups = useMemo<
    Array<{ key: string; folder: Folder | null; items: Song[] }>
  >(() => {
    const result: Array<{ key: string; folder: Folder | null; items: Song[] }> = [];
    const uncategorized = songs
      .filter((s) => !s.folderId)
      .sort(sortByOrderThenCreated);
    result.push({ key: "__uncategorized__", folder: null, items: uncategorized });
    for (const folder of folders) {
      const items = songs
        .filter((s) => s.folderId === folder.id)
        .sort(sortByOrderThenCreated);
      result.push({ key: folder.id, folder, items });
    }
    return result;
  }, [songs, folders]);

  // 没有歌曲 + 没有文件夹 → 真正全空
  if (songs.length === 0 && folders.length === 0) {
    return (
      <div className="library-page">
        <header className="header">
          <img src="/logo.png" alt="Opener" className="header-logo" />
          <h1>歌曲库</h1>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn-text" onClick={() => navigate("/upload")}>
              上传
            </button>
          </div>
        </header>
        <main className="content">
          <div className="empty">
            <p>暂无歌曲</p>
            <span>点击右上角上传歌曲开始学习</span>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="library-page">
      <header className="header">
        <img src="/logo.png" alt="Opener" className="header-logo" />
        {isSelectMode ? (
          <>
            <button className="back-btn" onClick={toggleSelectMode}>
              取消
            </button>
            <h1>选择歌曲 ({selectedIds.size})</h1>
            <button className="select-all-btn btn-text" onClick={toggleSelectAll}>
              {selectedIds.size === songs.length ? "取消全选" : "全选"}
            </button>
          </>
        ) : (
          <>
            <h1>歌曲库</h1>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn-text" onClick={() => navigate("/upload")}>
                上传
              </button>
              <button className="btn-text" onClick={toggleSelectMode}>
                选择
              </button>
              <button
                className="new-folder-btn"
                onClick={() => setNewFolderOpen(true)}
                aria-label="新建歌曲夹"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </>
        )}
      </header>

      {isSelectMode && selectedIds.size > 0 && (
        <div className="batch-actions">
          <button className="btn-text" onClick={() => setBatchMoveOpen(true)}>
            移动到文件夹 ({selectedIds.size})
          </button>
          <button className="btn-text active" onClick={handleBatchDelete}>
            删除已选 ({selectedIds.size})
          </button>
        </div>
      )}

      <main className="content">
        <div className="library-groups">
          {groups.map((group) => {
            // 未分类在没有歌曲时不显示（避免空白标题）
            // 用户创建的歌曲夹即使为空也要显示
            if (!group.folder && group.items.length === 0) return null;
            const isCollapsed = collapsed.has(group.key);
            return (
              <div key={group.key} className="library-group">
                <div className="library-group-header">
                  <button
                    className="group-chevron-btn"
                    onClick={() => toggleCollapse(group.key)}
                    aria-label={isCollapsed ? "展开" : "折叠"}
                  >
                    <svg
                      className={`group-chevron ${isCollapsed ? "collapsed" : ""}`}
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {renamingFolderId === group.key ? (
                    <input
                      className="folder-rename-input"
                      type="text"
                      value={renamingValue}
                      onChange={(e) => setRenamingValue(e.target.value)}
                      onBlur={handleConfirmRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleConfirmRename();
                        if (e.key === "Escape") {
                          setRenamingFolderId(null);
                          setRenamingValue("");
                        }
                      }}
                      autoFocus
                      maxLength={20}
                    />
                  ) : (
                    <span className="group-title">
                      {group.folder ? group.folder.name : "未分类"}
                    </span>
                  )}

                  <span className="group-count">{group.items.length}</span>

                  {group.folder && renamingFolderId !== group.key && (
                    <div
                      className="group-menu-wrap"
                      ref={openMenuFolderId === group.key ? menuRef : null}
                    >
                      <button
                        className="group-menu-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuFolderId(
                            openMenuFolderId === group.key ? null : group.key
                          );
                        }}
                        aria-label="更多"
                      >
                        ⋯
                      </button>
                      {openMenuFolderId === group.key && (
                        <div className="group-menu">
                          <button
                            className="group-menu-item"
                            onClick={() => handleStartRename(group.folder!)}
                          >
                            重命名
                          </button>
                          <button
                            className="group-menu-item danger"
                            onClick={() => {
                              setOpenMenuFolderId(null);
                              setConfirmDeleteFolderId(group.key);
                            }}
                          >
                            删除文件夹
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      style={{ overflow: "hidden" }}
                    >
                      {group.items.length === 0 && group.folder && (
                        <div className="favorites-empty-hint">
                          空文件夹 — 上传歌曲后可在此选择「移动」加入
                        </div>
                      )}
                      <Reorder.Group
                        axis="y"
                        values={group.items}
                        onReorder={(newItems) => handleReorder(group.key, newItems)}
                        as="div"
                        className="songs-list"
                      >
                        {group.items.map((song) => (
                          <SongItem
                            key={song.id}
                            song={song}
                            isSelectMode={isSelectMode}
                            isSelected={selectedIds.has(song.id)}
                            onToggleSelect={() => toggleSelect(song.id)}
                            onClick={() =>
                              isSelectMode
                                ? toggleSelect(song.id)
                                : navigate(`/lyrics/${song.id}`)
                            }
                            onDelete={(e) => handleDelete(song.id, e)}
                            onMove={(e) => {
                              e.stopPropagation();
                              setMovingSong(song);
                            }}
                          />
                        ))}
                      </Reorder.Group>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </main>

      {/* 删除文件夹二次确认 */}
      <AnimatePresence>
        {confirmDeleteFolderId && (
          <motion.div
            className="action-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setConfirmDeleteFolderId(null)}
          >
            <motion.div
              className="action-sheet"
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="action-line">
                确定要删除这个文件夹吗？文件夹内的歌曲将归到「未分类」。
              </div>
              <button className="btn-text" onClick={() => setConfirmDeleteFolderId(null)}>
                取消
              </button>
              <button className="btn-text active" onClick={handleConfirmDeleteFolder}>
                删除文件夹
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 单首移动弹窗 */}
      <AnimatePresence>
        {movingSong && (
          <FolderPickerModal
            selectedFolderId={movingSong.folderId}
            onClose={() => setMovingSong(null)}
            onConfirm={handleMoveSong}
          />
        )}
      </AnimatePresence>

      {/* 批量移动弹窗 */}
      <AnimatePresence>
        {batchMoveOpen && (
          <FolderPickerModal
            selectedFolderId={undefined}
            onClose={() => setBatchMoveOpen(false)}
            onConfirm={handleBatchMove}
          />
        )}
      </AnimatePresence>

      {/* 顶部 + 按钮：新建空歌曲夹 */}
      <AnimatePresence>
        {newFolderOpen && (
          <FolderPickerModal
            selectedFolderId={undefined}
            createOnly
            onClose={() => setNewFolderOpen(false)}
            onConfirm={handleCreateFolderFromHeader}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// 单首歌曲项（带拖拽手柄）
function SongItem({
  song,
  isSelectMode,
  isSelected,
  onToggleSelect,
  onClick,
  onDelete,
  onMove,
}: {
  song: Song;
  isSelectMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onMove: (e: React.MouseEvent) => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={song}
      dragListener={false}
      dragControls={controls}
      className={`song-item ${isSelected ? "selected" : ""}`}
      whileDrag={{
        scale: 1.02,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        zIndex: 10,
      }}
      style={{ listStyle: "none" }}
    >
      {!isSelectMode && (
        <button
          className="drag-handle"
          onPointerDown={(e) => controls.start(e)}
          aria-label="拖动排序"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="19" r="1" />
          </svg>
        </button>
      )}
      {isSelectMode && (
        <div className={`checkbox ${isSelected ? "checked" : ""}`} onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}>
          {isSelected ? "✓" : ""}
        </div>
      )}
      <div className="song-info" onClick={onClick}>
        <div className="song-name" style={{ color: "#000000" }}>
          {song.name}
        </div>
        <div className="song-meta">
          <span>{song.lyrics.length} 句歌词</span>
          <span>创建于 {new Date(song.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
      {!isSelectMode && (
        <>
          <button className="move-btn btn-text" onClick={onMove}>
            移动
          </button>
          <button className="delete-btn btn-text" onClick={onDelete}>
            删除
          </button>
        </>
      )}
    </Reorder.Item>
  );
}
