import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAudio } from "../lib/audioContext";
import { useSeekDuration } from "../lib/settings";
import PlayPauseIcon from "./PlayPauseIcon";
import "./BottomNav.css";

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, toggle, seek } = useAudio();
  const [seekDuration] = useSeekDuration();

  const { song, currentTime, duration, isPlaying } = state;
  const currentPath = location.pathname;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!state.globalKeysEnabled) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!song) return;

      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seek(Math.max(0, state.currentTime - seekDuration));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seek(Math.min(state.duration, state.currentTime + seekDuration));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.globalKeysEnabled, song, state.currentTime, state.duration, seek, toggle, seekDuration]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handlePlaybackToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggle();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = (parseFloat(e.target.value) / 100) * duration;
    seek(newTime);
  };

  const handleSkipBack = (e: React.MouseEvent) => {
    e.stopPropagation();
    seek(Math.max(0, state.currentTime - 2));
  };

  const handleSkipForward = (e: React.MouseEvent) => {
    e.stopPropagation();
    seek(Math.min(state.duration, state.currentTime + 2));
  };

  return (
    <div className="bottom-nav">
      {song && (
        <div className="playback-section" onClick={() => navigate(`/lyrics/${song.id}`)}>
          <div className="playback-controls">
            <button
              className="transparent-play-btn skip-btn"
              onClick={handleSkipBack}
              aria-label="后退2秒"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="19,5 5,12 19,19" />
              </svg>
            </button>
            <button
              className="playback-btn transparent-play-btn"
              onClick={handlePlaybackToggle}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              <PlayPauseIcon isPlaying={isPlaying} />
            </button>
            <button
              className="transparent-play-btn skip-btn"
              onClick={handleSkipForward}
              aria-label="前进2秒"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="5,5 19,12 5,19" />
              </svg>
            </button>
          </div>
          <input
            type="range"
            className="seek-slider"
            min="0"
            max="100"
            value={progress}
            onChange={handleSeek}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="playback-time">{formatTime(currentTime)}</div>
        </div>
      )}

      <div className="nav-buttons">
        <button
          className={currentPath === "/library" ? "active" : ""}
          onClick={() => navigate("/library")}
        >
          歌曲库
        </button>
        <button
          className={currentPath === "/favorites" ? "active" : ""}
          onClick={() => navigate("/favorites")}
        >
          收藏夹
        </button>
        <button
          className={currentPath === "/dictation" ? "active" : ""}
          onClick={() => navigate("/dictation")}
        >
          听写
        </button>
      </div>
    </div>
  );
}