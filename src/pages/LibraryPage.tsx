import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { getAllSongs, deleteSong, deleteFavoritesBySongId } from "../lib/storage";
import { useAudio } from "../lib/audioContext";
import type { Song } from "../lib/types";
import "./LibraryPage.css";

export default function LibraryPage() {
  const navigate = useNavigate();
  const { state: audioState, clearSong } = useAudio();
  const [songs, setSongs] = useState<Song[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadSongs();
  }, []);

  const loadSongs = async () => {
    const all = await getAllSongs();
    setSongs(all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("确认删除这首歌曲？")) {
      if (audioState.songId === id) clearSong();
      await deleteFavoritesBySongId(id);
      await deleteSong(id);
      await loadSongs();
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
    if (selectedIds.size === songs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(songs.map(s => s.id)));
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
      await loadSongs();
    }
  };

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
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-text" onClick={() => navigate("/upload")}>
                上传
              </button>
              <button className="btn-text" onClick={toggleSelectMode}>
                选择
              </button>
            </div>
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
        {songs.length === 0 ? (
          <div className="empty">
            <p>暂无歌曲</p>
            <span>点击右上角上传歌曲开始学习</span>
          </div>
        ) : (
          <div className="songs-list">
            {songs.map((song, index) => (
              <motion.div
                key={song.id}
                className={`song-item ${selectedIds.has(song.id) ? 'selected' : ''}`}
                onClick={() => isSelectMode ? toggleSelect(song.id) : navigate(`/lyrics/${song.id}`)}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                {isSelectMode && (
                  <div className={`checkbox ${selectedIds.has(song.id) ? 'checked' : ''}`}>
                    {selectedIds.has(song.id) ? "✓" : ""}
                  </div>
                )}
                <div className="song-info">
                  <div className="song-name" style={{ color: '#000000' }}>{song.name}</div>
                  <div className="song-meta">
                    <span>{song.lyrics.length} 句歌词</span>
                    <span>创建于 {new Date(song.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                {!isSelectMode && (
                  <button className="delete-btn btn-text" onClick={(e) => handleDelete(song.id, e)}>
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