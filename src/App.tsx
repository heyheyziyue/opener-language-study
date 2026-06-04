import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AudioProvider } from "./lib/audioContext";
import { seedSampleSongIfMissing } from "./lib/seed";
import BottomNav from "./components/BottomNav";
import UploadPage from "./pages/UploadPage";
import LibraryPage from "./pages/LibraryPage";
import LyricsPage from "./pages/LyricsPage";
import FavoritesPage from "./pages/FavoritesPage";
import PracticePage from "./pages/PracticePage";
import DictationPage from "./pages/DictationPage";

function App() {
  // 首次启动植入示例歌曲（幂等：sample-song-1 已存在则跳过）
  // 用 state 门控渲染，避免子页面在 seed 完成前先读 IndexedDB（导致短暂"暂无歌曲"）
  const [seedReady, setSeedReady] = useState(false);

  useEffect(() => {
    seedSampleSongIfMissing().finally(() => setSeedReady(true));
  }, []);

  return (
    <AudioProvider>
      <BrowserRouter>
        {seedReady ? (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <div style={{ flex: 1 }}>
              <Routes>
                <Route path="/" element={<Navigate to="/library" replace />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/lyrics/:songId" element={<LyricsPage />} />
                <Route path="/favorites" element={<FavoritesPage />} />
                <Route path="/practice/:favoriteId" element={<PracticePage />} />
                <Route path="/dictation" element={<DictationPage />} />
              </Routes>
            </div>
            <BottomNav />
          </div>
        ) : (
          // 极简加载占位（seed 通常 < 200ms，仅首次启动可见一次）
          <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-page, #fff)',
          }} />
        )}
      </BrowserRouter>
    </AudioProvider>
  );
}

export default App;