import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getAllFavorites, getSong } from "../lib/storage";
import { useAudio } from "../lib/audioContext";
import PlayPauseIcon from "../components/PlayPauseIcon";
import type { FavoriteLine, LyricLine } from "../lib/types";
import "./DictationPage.css";

type DiffWord = {
  word: string;
  status: "correct" | "wrong" | "missing" | "extra";
};

const diffLyrics = (original: string, input: string): DiffWord[] => {
  const origWords = original.split(/\s+/).filter(Boolean);
  const inputWords = input.trim().split(/\s+/).filter(Boolean);
  const result: DiffWord[] = [];
  const maxLen = Math.max(origWords.length, inputWords.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < origWords.length && i < inputWords.length) {
      const cleanOrig = origWords[i].toLowerCase().replace(/[^a-z]/g, "");
      const cleanInput = inputWords[i].toLowerCase().replace(/[^a-z]/g, "");
      if (cleanOrig === cleanInput) {
        result.push({ word: inputWords[i], status: "correct" });
      } else {
        result.push({ word: inputWords[i], status: "wrong" });
      }
    } else if (i < origWords.length) {
      result.push({ word: origWords[i], status: "missing" });
    } else {
      result.push({ word: inputWords[i], status: "extra" });
    }
  }
  return result;
};

const shuffle = <T,>(arr: T[]): T[] => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export default function DictationPage() {
  const navigate = useNavigate();
  const {
    loadSong: loadAudioSong,
    playClip,
    pause,
    resumeClip,
    clearClipMonitoring,
    setPlaybackRate,
    seek,
    state: audioState,
    setGlobalKeysEnabled,
  } = useAudio();

  const [favorites, setFavorites] = useState<FavoriteLine[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [showLyrics, setShowLyrics] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffWord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loopCount, setLoopCount] = useState(0);
  const [currentLoop, setCurrentLoop] = useState(0);
  const [isAutoLooping, setIsAutoLooping] = useState(false);
  const [hasStartedClip, setHasStartedClip] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // 实时从歌曲数据中获取最新的 clipStart/clipEnd（不读 favorite 旧快照）
  const [latestClipStart, setLatestClipStart] = useState<number | undefined>(undefined);
  const [latestClipEnd, setLatestClipEnd] = useState<number | undefined>(undefined);

  const currentFavorite = favorites[currentIndex];
  const hasClip = latestClipStart !== undefined && latestClipEnd !== undefined;
  // 播放使用的 clipStart/clipEnd：仅在有最新时间戳时使用，否则回退到 0（用于 UI 计算）
  const clipStart = latestClipStart ?? 0;
  const clipEnd = latestClipEnd ?? 0;

  useEffect(() => {
    setGlobalKeysEnabled(false);
    loadRandomFavorites();
    return () => {
      setGlobalKeysEnabled(true);
      clearClipMonitoring();
      setPlaybackRate(1);
    };
  }, []);

  // 当前歌词变化时，加载音频片段
  useEffect(() => {
    const loadCurrentAudio = async () => {
      if (!currentFavorite) {
        setLatestClipStart(undefined);
        setLatestClipEnd(undefined);
        return;
      }
      const s = await getSong(currentFavorite.songId);
      if (s) {
        loadAudioSong(s);
        // 仅使用歌曲中最新的 clipStart/clipEnd；若该行未截取则置为 undefined
        // 绝不回退到 favorite 旧快照，避免播放过时片段
        const latestLine = s.lyrics.find((l: LyricLine) => l.id === currentFavorite.line.id);
        if (latestLine?.clipStart !== undefined && latestLine.clipEnd !== undefined) {
          setLatestClipStart(latestLine.clipStart);
          setLatestClipEnd(latestLine.clipEnd);
        } else {
          setLatestClipStart(undefined);
          setLatestClipEnd(undefined);
        }
      } else {
        // 歌曲被删除时，标记为无截取（避免误用 favorite 旧值）
        setLatestClipStart(undefined);
        setLatestClipEnd(undefined);
      }
    };
    loadCurrentAudio();
    // 切换到新歌词时，重置循环相关状态
    setCurrentLoop(loopCount > 0 ? 1 : 0);
    setIsAutoLooping(false);
  }, [currentFavorite?.id]);

  const loadRandomFavorites = async () => {
    setIsLoading(true);
    const all = await getAllFavorites();
    setFavorites(shuffle(all));
    setCurrentIndex(0);
    setIsLoading(false);
  };

  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
    setPlaybackRate(newSpeed);
  };

  const handleSubmit = () => {
    if (!currentFavorite) return;
    const result = diffLyrics(currentFavorite.line.text, userInput);
    setDiffResult(result);
    setSubmitted(true);
  };

  const switchLine = (newIndex: number) => {
    setCurrentIndex(newIndex);
    setUserInput("");
    setShowLyrics(false);
    setSubmitted(false);
    setDiffResult([]);
    setHasStartedClip(false);
    setIsPlaying(false);
    setLatestClipStart(undefined);
    setLatestClipEnd(undefined);
    setCurrentLoop(loopCount > 0 ? 1 : 0);
    setIsAutoLooping(false);
    pause();
    setPlaybackRate(1);
    setSpeed(1);
  };

  const handlePrevLine = () => {
    if (favorites.length === 0) return;
    const newIndex = currentIndex === 0 ? favorites.length - 1 : currentIndex - 1;
    switchLine(newIndex);
  };

  const handleNextLine = () => {
    if (favorites.length === 0) return;
    const newIndex = (currentIndex + 1) % favorites.length;
    switchLine(newIndex);
  };

  const handleToggleLyrics = () => {
    setShowLyrics(!showLyrics);
  };

  const handleGoToPractice = () => {
    if (!currentFavorite) return;
    navigate(`/practice/${currentFavorite.id}`);
  };

  const togglePlay = () => {
    if (!currentFavorite) return;
    // 仅当最新歌曲数据中确实没有截取时间戳时弹窗
    // （与 PracticePage 一致：clipStart/End 来自实时歌曲数据，0 是合法值）
    if (!hasClip) {
      alert("该收藏没有截取片段");
      return;
    }
    if (isPlaying) {
      pause();
      setIsPlaying(false);
    } else {
      if (!hasStartedClip || audioState.currentTime >= clipEnd / 1000) {
        playClip(clipStart, clipEnd);
        setHasStartedClip(true);
        setCurrentLoop(loopCount > 0 ? 1 : 0);
        setIsAutoLooping(false);
      } else {
        resumeClip(clipStart, clipEnd);
      }
      setIsPlaying(true);
    }
  };

  // 用 ref 持有最新的 togglePlay，避免空格键 handler 闭包里捕获过期的 clipStart/clipEnd
  // （之前 useEffect 依赖中没有 latestClipStart/End，导致异步加载歌曲后旧 handler 仍然存在）
  const togglePlayRef = useRef<() => void>(() => {});
  togglePlayRef.current = togglePlay;

  // 空格键控制播放/暂停：调用 ref 始终拿到最新的 togglePlay（与点击播放按钮行为一致）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlayRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 当 loopCount 改变时，重置 currentLoop 并从头开始播放
  useEffect(() => {
    setCurrentLoop(loopCount > 0 ? 1 : 0);
    setIsAutoLooping(false);

    // 使用最新时间戳（latestClipStart/End）而非 currentFavorite 旧快照
    if (isPlaying && hasClip) {
      playClip(clipStart, clipEnd);
      setCurrentLoop(loopCount > 0 ? 1 : 0);
    }
  }, [loopCount]);

  // 自动循环播放逻辑 - 当 clip 播放完毕且当前时间回到 clipStart 附近时自动循环
  useEffect(() => {
    if (audioState.isPlaying) {
      setIsAutoLooping(false);
      return;
    }
    if (isAutoLooping) return;
    if (!hasClip) return;
    if (!hasStartedClip) return;
    if (!currentFavorite) return;

    const atClipStart = Math.abs(audioState.currentTime - clipStart / 1000) < 0.2;
    if (!atClipStart) return;

    const canLoop = loopCount === 0 || currentLoop < loopCount;
    if (!canLoop) return;

    setIsAutoLooping(true);
    if (loopCount > 0) {
      setCurrentLoop(prev => prev + 1);
    }
    setTimeout(() => {
      // 使用最新时间戳重新播放
      if (hasClip) {
        playClip(clipStart, clipEnd);
        setIsPlaying(true);
      }
    }, 100);
  }, [audioState.isPlaying, audioState.currentTime, clipEnd, clipStart, loopCount, currentLoop, hasStartedClip, isAutoLooping, hasClip, currentFavorite]);

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const clipDuration = (clipEnd - clipStart) / 1000;
  const currentTimeInClip = Math.max(0, audioState.currentTime - clipStart / 1000);
  const currentTimeInClipFixed = Math.min(currentTimeInClip, clipDuration);

  return (
    <div className="dictation-page">
      <header className="header">
        <img src="/logo.png" alt="Opener" className="header-logo" />
        <button className="back-btn" onClick={() => navigate(-1)} aria-label="返回">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="11 18 5 12 11 6" />
          </svg>
        </button>
        <h1>听写</h1>
      </header>

      {isLoading ? (
        <main className="content">
          <p>加载中...</p>
        </main>
      ) : favorites.length === 0 ? (
        <main className="content empty">
          <p>暂无收藏</p>
          <span>先去收藏几句歌词再开始听写练习</span>
        </main>
      ) : currentFavorite ? (
        <main className="content">
          <div className="dictation-card">
            <div className="song-name">{currentFavorite.songName}</div>
            {showLyrics ? (
              <div className="lyric-text">{currentFavorite.line.text}</div>
            ) : (
              <div className="lyric-mask" />
            )}
          </div>

          <div className="speed-control">
            <span>播放速度</span>
            <div className="speed-buttons">
              {[0.5, 0.75, 1, 1.25, 1.5].map((s) => (
                <button
                  key={s}
                  className={`btn-text ${speed === s ? "active" : ""}`}
                  onClick={() => handleSpeedChange(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          <div className="loop-control">
            <span>循环次数</span>
            <div className="loop-buttons">
              {[0, 1, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  className={`btn-text ${loopCount === n ? "active" : ""}`}
                  onClick={() => setLoopCount(n)}
                >
                  {n === 0 ? "∞" : n}
                </button>
              ))}
            </div>
          </div>

          <div className="progress-bar">
            <span>{formatTime(currentTimeInClipFixed)}</span>
            <input
              type="range"
              min="0"
              max={clipDuration || 1}
              value={currentTimeInClipFixed}
              onChange={(e) => seek(clipStart / 1000 + Number(e.target.value))}
            />
            <span>{formatTime(clipDuration)}</span>
          </div>

          {loopCount > 0 && (
            <div className="loop-counter">
              已循环 {currentLoop} / {loopCount} 次
            </div>
          )}

          <div className="dictation-controls">
            <button
              className="playback-nav-btn transparent-play-btn"
              onClick={handlePrevLine}
              aria-label="上一句"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15,18 9,12 15,6" />
              </svg>
            </button>
            <button
              className="play-btn transparent-play-btn"
              onClick={togglePlay}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              <PlayPauseIcon isPlaying={isPlaying} size={32} />
            </button>
            <button
              className="playback-nav-btn transparent-play-btn"
              onClick={handleNextLine}
              aria-label="下一句"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9,18 15,12 9,6" />
              </svg>
            </button>
          </div>

          <div className="input-area">
            <textarea
              className="dictation-input"
              placeholder="在此输入你听到的歌词..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              rows={3}
            />
          </div>

          <div className="action-buttons">
            <button
              className="btn-text active"
              onClick={handleSubmit}
            >
              {submitted ? "重新提交" : "提交"}
            </button>
            <button className="btn-text" onClick={handleToggleLyrics}>
              {showLyrics ? "隐藏歌词" : "查看歌词"}
            </button>
            {submitted && (
              <button className="btn-text" onClick={handleGoToPractice}>
                去练习这句
              </button>
            )}
          </div>

          {submitted && (
            <>
              <div className="diff-hint">标红内容为错误</div>
              <div className="diff-section">
                <div className="diff-words">
                  {diffResult.map((d, i) => (
                    <span key={i} className={`diff-word ${d.status}`}>
                      {d.status === "missing" ? `[${d.word}]` : d.word}
                      {i < diffResult.length - 1 ? " " : ""}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </main>
      ) : null}
    </div>
  );
}
