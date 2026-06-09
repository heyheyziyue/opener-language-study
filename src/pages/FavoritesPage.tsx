import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
import {
  getAllFavorites,
  deleteFavorite,
  getAllFolders,
  renameFolder,
  deleteFolder,
  moveFavoriteToFolder,
  batchUpdateFavoriteOrders,
} from "../lib/storage";
import { setPracticeSourceSongId } from "../lib/navigation";
import type { FavoriteLine, Folder } from "../lib/types";
import FolderPickerModal from "../components/FolderPickerModal";
import "./FavoritesPage.css";

const COLLAPSED_KEY = "favorites-collapsed-folder-ids";

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

// order 优先；未指定 order 的按 createdAt 降序
const sortByOrderThenCreated = (a: FavoriteLine, b: FavoriteLine): number => {
  if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
  if (a.order !== undefined) return -1;
  if (b.order !== undefined) return 1;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
};

export default function FavoritesPage() {
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<FavoriteLine[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());

  // 文件夹管理菜单（每个文件夹头部右侧的 ⋯ 按钮）
  const [openMenuFolderId, setOpenMenuFolderId] = useState<string | null>(null);
  // 重命名输入态
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  // 删除文件夹二次确认
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  // 批量移动弹窗
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  // 单条移动弹窗
  const [movingFavorite, setMovingFavorite] = useState<FavoriteLine | null>(null);
  // 顶部 + 按钮：新建空文件夹
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
    const [favs, allFolders] = await Promise.all([getAllFavorites(), getAllFolders()]);
    setFavorites(favs);
    setFolders(allFolders.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  };

  // ===== 拖拽排序 =====
  const handleReorder = useCallback(
    async (groupKey: string, newItems: FavoriteLine[]) => {
      setFavorites((prev) =>
        prev.map((f) => {
          if (groupKey === "__uncategorized__") {
            if (f.folderId) return f;
          } else if (f.folderId !== groupKey) {
            return f;
          }
          const idx = newItems.findIndex((ni) => ni.id === f.id);
          if (idx >= 0) return { ...f, order: idx };
          return f;
        })
      );
      const orders = newItems.map((item, idx) => ({ id: item.id, order: idx }));
      await batchUpdateFavoriteOrders(orders);
    },
    []
  );

  // ===== 收藏删除 =====
  const handleDelete = async (id: string) => {
    if (confirm("确认删除？")) {
      await deleteFavorite(id);
      await loadAll();
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (confirm(`确认删除选中的 ${selectedIds.size} 条收藏？`)) {
      for (const id of selectedIds) {
        await deleteFavorite(id);
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
    if (selectedIds.size === favorites.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(favorites.map((f) => f.id)));
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

  // ===== 移动单条 / 批量 =====
  const handleMoveFavorite = async (folderId: string | null | undefined) => {
    if (!movingFavorite) return;
    await moveFavoriteToFolder(movingFavorite.id, folderId ?? undefined);
    setMovingFavorite(null);
    await loadAll();
  };

  const handleBatchMove = async (folderId: string | null | undefined) => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await moveFavoriteToFolder(id, folderId ?? undefined);
    }
    setBatchMoveOpen(false);
    setSelectedIds(new Set());
    setIsSelectMode(false);
    await loadAll();
  };

  // ===== 顶部 + 按钮：新建空文件夹 =====
  // FolderPickerModal 在 createOnly 模式下创建完会自动调用 onConfirm(newFolderId)
  // 这里只需关闭弹窗并刷新列表（无需对收藏做任何操作）
  const handleCreateFolderFromHeader = async (_newFolderId: string | null | undefined) => {
    setNewFolderOpen(false);
    await loadAll();
  };

  // ===== 导航 =====
  const handlePractice = (favorite: FavoriteLine) => {
    setPracticeSourceSongId(favorite.songId);
    navigate(`/practice/${favorite.id}`);
  };

  const handleBack = () => {
    navigate(-1);
  };

  // ===== 分组（带排序） =====
  const groups = useMemo<
    Array<{ key: string; folder: Folder | null; items: FavoriteLine[] }>
  >(() => {
    const result: Array<{ key: string; folder: Folder | null; items: FavoriteLine[] }> = [];
    const uncategorized = favorites
      .filter((f) => !f.folderId)
      .sort(sortByOrderThenCreated);
    result.push({ key: "__uncategorized__", folder: null, items: uncategorized });
    for (const folder of folders) {
      const items = favorites
        .filter((f) => f.folderId === folder.id)
        .sort(sortByOrderThenCreated);
      result.push({ key: folder.id, folder, items });
    }
    return result;
  }, [favorites, folders]);

  return (
    <div className="favorites-page">
      <header className="header">
        <img src="/logo.png" alt="Opener" className="header-logo" />
        {isSelectMode ? (
          <>
            <button className="back-btn" onClick={toggleSelectMode}>
              取消
            </button>
            <h1>选择收藏 ({selectedIds.size})</h1>
            <button className="select-all-btn btn-text" onClick={toggleSelectAll}>
              {selectedIds.size === favorites.length ? "取消全选" : "全选"}
            </button>
          </>
        ) : (
          <>
            <button className="back-btn" onClick={handleBack} aria-label="返回">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="11 18 5 12 11 6" />
              </svg>
            </button>
            <h1>收藏夹</h1>
            <button className="select-btn btn-text" onClick={toggleSelectMode}>
              选择
            </button>
            <button
              className="new-folder-btn"
              onClick={() => setNewFolderOpen(true)}
              aria-label="新建收藏夹"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
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
        {favorites.length === 0 && folders.length === 0 ? (
          <div className="empty">
            <p>暂无收藏</p>
            <span>在歌词页面点击句子即可收藏</span>
          </div>
        ) : (
          <div className="favorites-groups">
            {groups.map((group) => {
              // "未分类"在没有任何收藏时也不显示（避免空白标题）
              // 用户创建的文件夹即使为空也要显示（用户可能先建空文件夹再填内容）
              if (!group.folder && group.items.length === 0) return null;
              const isCollapsed = collapsed.has(group.key);
              return (
                <div key={group.key} className="favorites-group">
                  <div className="favorites-group-header">
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
                      <div className="group-menu-wrap" ref={openMenuFolderId === group.key ? menuRef : null}>
                        <button
                          className="group-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuFolderId(openMenuFolderId === group.key ? null : group.key);
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
                        className="favorites-collapse"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                      >
                        {group.items.length === 0 && group.folder && (
                          <div className="favorites-empty-hint">空文件夹 — 收藏歌词后可在此选择「移动」加入</div>
                        )}
                        <Reorder.Group
                          axis="y"
                          values={group.items}
                          onReorder={(newItems) => handleReorder(group.key, newItems)}
                          as="div"
                          className="favorites-list"
                        >
                          {group.items.map((fav) => (
                            <FavoriteItem
                              key={fav.id}
                              fav={fav}
                              isSelectMode={isSelectMode}
                              isSelected={selectedIds.has(fav.id)}
                              onToggleSelect={() => toggleSelect(fav.id)}
                              onClick={() => (isSelectMode ? toggleSelect(fav.id) : handlePractice(fav))}
                              onDelete={() => handleDelete(fav.id)}
                              onMove={() => setMovingFavorite(fav)}
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
        )}
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
              <div className="action-line">确定要删除这个文件夹吗？文件夹内的收藏将归到「未分类」。</div>
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

      {/* 单条移动弹窗 */}
      <AnimatePresence>
        {movingFavorite && (
          <FolderPickerModal
            selectedFolderId={movingFavorite.folderId}
            onClose={() => setMovingFavorite(null)}
            onConfirm={handleMoveFavorite}
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

      {/* 顶部 + 按钮：新建空收藏夹 */}
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

// 单条收藏项（带拖拽手柄）
function FavoriteItem({
  fav,
  isSelectMode,
  isSelected,
  onToggleSelect,
  onClick,
  onDelete,
  onMove,
}: {
  fav: FavoriteLine;
  isSelectMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={fav}
      dragListener={false}
      dragControls={controls}
      className={`favorite-item ${isSelected ? "selected" : ""}`}
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
      <div className="fav-content" onClick={onClick}>
        <div className="fav-song">{fav.songName}</div>
        <div className="fav-line">{fav.line.text}</div>
      </div>
      {!isSelectMode && (
        <>
          <button className="move-btn btn-text" onClick={(e) => { e.stopPropagation(); onMove(); }}>
            移动
          </button>
          <button className="delete-btn btn-text" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            删除
          </button>
        </>
      )}
    </Reorder.Item>
  );
}
