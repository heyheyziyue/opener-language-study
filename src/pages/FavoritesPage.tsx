import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { getAllFavorites, deleteFavorite } from "../lib/storage";
import { setPracticeSourceSongId } from "../lib/navigation";
import type { FavoriteLine } from "../lib/types";
import "./FavoritesPage.css";

export default function FavoritesPage() {
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<FavoriteLine[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    const all = await getAllFavorites();
    setFavorites(all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  };

  const handleDelete = async (id: string) => {
    if (confirm("确认删除？")) {
      await deleteFavorite(id);
      await loadFavorites();
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
      await loadFavorites();
    }
  };

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
      setSelectedIds(new Set(favorites.map(f => f.id)));
    }
  };

  const handlePractice = (favorite: FavoriteLine) => {
    setPracticeSourceSongId(favorite.songId);
    navigate(`/practice/${favorite.id}`);
  };

  const handleBack = () => {
    navigate(-1);
  };

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
          </>
        )}
      </header>

      {isSelectMode && selectedIds.size > 0 && (
        <div className="batch-actions">
          <button className="btn-text active" onClick={handleBatchDelete}>
            删除已选 ({selectedIds.size})
          </button>
        </div>
      )}

      <main className="content">
        {favorites.length === 0 ? (
          <div className="empty">
            <p>暂无收藏</p>
            <span>在歌词页面点击句子即可收藏</span>
          </div>
        ) : (
          <div className="favorites-list">
            {favorites.map((fav, index) => (
              <motion.div
                key={fav.id}
                className={`favorite-item ${selectedIds.has(fav.id) ? 'selected' : ''}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => isSelectMode ? toggleSelect(fav.id) : handlePractice(fav)}
              >
                {isSelectMode && (
                  <div className={`checkbox ${selectedIds.has(fav.id) ? 'checked' : ''}`}>
                    {selectedIds.has(fav.id) ? "✓" : ""}
                  </div>
                )}
                <div className="fav-content">
                  <div className="fav-song">{fav.songName}</div>
                  <div className="fav-line">{fav.line.text}</div>
                </div>
                {!isSelectMode && (
                  <button className="delete-btn btn-text" onClick={(e) => { e.stopPropagation(); handleDelete(fav.id); }}>
                    删除
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}