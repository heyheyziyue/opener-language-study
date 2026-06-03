import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AudioProvider } from "./lib/audioContext";
import BottomNav from "./components/BottomNav";
import UploadPage from "./pages/UploadPage";
import LibraryPage from "./pages/LibraryPage";
import LyricsPage from "./pages/LyricsPage";
import FavoritesPage from "./pages/FavoritesPage";
import PracticePage from "./pages/PracticePage";
import DictationPage from "./pages/DictationPage";

function App() {
  return (
    <AudioProvider>
      <BrowserRouter>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <div style={{ flex: 1, paddingBottom: '140px' }}>
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
      </BrowserRouter>
    </AudioProvider>
  );
}

export default App;