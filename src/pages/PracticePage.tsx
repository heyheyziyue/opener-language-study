import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSong, getAllFavorites, saveFavorite } from "../lib/storage";
import { useAudio } from "../lib/audioContext";
import { getPracticeSourceSongId } from "../lib/navigation";
import { useSeekDuration } from "../lib/settings";
import PlayPauseIcon from "../components/PlayPauseIcon";
import type { FavoriteLine, LyricLine } from "../lib/types";
import "./PracticePage.css";

export default function PracticePage() {
  const { favoriteId } = useParams<{ favoriteId: string }>();
  const navigate = useNavigate();
  const { loadSong: loadAudioSong, pause, stop, playClip, resumeClip, clearClipMonitoring, setPlaybackRate, seek, state: audioState, setGlobalKeysEnabled } = useAudio();
  const checkEndRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [favorite, setFavorite] = useState<FavoriteLine | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(0);
  const [hasStartedClip, setHasStartedClip] = useState(false);
  const [loopCount, setLoopCount] = useState(0); // 0 = 无限循环
  const [currentLoop, setCurrentLoop] = useState(0);
  const [isAutoLooping, setIsAutoLooping] = useState(false); // 防止 auto-loop 多次触发
  const [note, setNote] = useState("");
  const [seekDuration] = useSeekDuration(); // 左右箭头调整进度的幅度（秒，全局设置）

  useEffect(() => {
    // 禁用全局键盘监听，练习模式使用自己的键盘控制
    setGlobalKeysEnabled(false);
    loadFavorite();
    return () => {
      // 恢复全局键盘监听
      setGlobalKeysEnabled(true);
      // 清除可能残留的 clip 监控定时器，并将播放速度恢复为 1，
      // 避免离开练习模式后影响歌词页等页面的播放行为
      resetPracticeAudio();
      if (checkEndRef.current) clearInterval(checkEndRef.current);
    };
  }, [favoriteId]);

  // 空格键控制播放/暂停，左右箭头调整进度
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 点击按钮后焦点会转移，blur 让焦点回到 body 以便键盘控制正常工作
      if (document.activeElement instanceof HTMLButtonElement) {
        document.activeElement.blur();
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seek(Math.max(clipStart / 1000, audioState.currentTime - seekDuration));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seek(Math.min(clipEnd / 1000, audioState.currentTime + seekDuration));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, audioState.currentTime, clipStart, clipEnd, seekDuration]);

  const loadFavorite = async () => {
    const all = await getAllFavorites();
    const fav = all.find((f) => f.id === favoriteId);
    if (fav) {
      setFavorite(fav);
      setSpeed(fav.speed || 1);
      setNote(fav.note || "");
      const s = await getSong(fav.songId);
      if (s) {
        loadAudioSong(s);
        // 优先使用歌曲中最新的 clipStart/clipEnd，防止收藏记录中时间戳过时
        const latestLine = s.lyrics.find((l: LyricLine) => l.id === fav.line.id);
        if (latestLine?.clipStart !== undefined && latestLine.clipEnd !== undefined) {
          setClipStart(latestLine.clipStart);
          setClipEnd(latestLine.clipEnd);
        } else if (fav.line.clipStart !== undefined && fav.line.clipEnd !== undefined) {
          // 回退：使用收藏中存储的旧值
          setClipStart(fav.line.clipStart);
          setClipEnd(fav.line.clipEnd);
        }
      } else if (fav.line.clipStart !== undefined && fav.line.clipEnd !== undefined) {
        // 歌曲被删除时，回退到收藏的旧值
        setClipStart(fav.line.clipStart);
        setClipEnd(fav.line.clipEnd);
      }
    }
  };

const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
    setPlaybackRate(newSpeed);
  };

  const handleNoteChange = async (newNote: string) => {
    setNote(newNote);
    if (favorite) {
      favorite.note = newNote;
      await saveFavorite(favorite);
    }
  };

  const handlePlay = () => {
    if (!favorite) return;

    // 使用 state 中的最新 clipStart/clipEnd（来自歌曲，而非收藏的旧快照）
    if (clipStart === 0 && clipEnd === 0) {
      alert("请先在歌词页面截取音频片段");
      return;
    }

    // 如果是首次播放或已完成片段，从头开始播放
    if (!hasStartedClip || audioState.currentTime >= clipEnd / 1000) {
      if (checkEndRef.current) clearInterval(checkEndRef.current);
      playClip(clipStart, clipEnd);
      setHasStartedClip(true);
      setCurrentLoop(1);
    } else {
      // 从暂停位置继续播放，保持 clip 边界
      if (checkEndRef.current) clearInterval(checkEndRef.current);
      resumeClip(clipStart, clipEnd);
    }
    setIsPlaying(true);
  };

  const handlePause = () => {
    pause();
    if (checkEndRef.current) clearInterval(checkEndRef.current);
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (isPlaying) {
      handlePause();
    } else {
      handlePlay();
    }
  };

  // 当 loopCount 改变时，重置 currentLoop 并从头开始播放
  useEffect(() => {
    // 如果设定了循环次数（loopCount > 0），初始为1表示第一次循环即将开始
    // 如果是无限循环（loopCount === 0），初始为0
    setCurrentLoop(loopCount > 0 ? 1 : 0);
    setIsAutoLooping(false);

    // 如果当前正在播放，点击循环按钮后从头开始
    if (isPlaying && clipEnd > 0) {
      if (checkEndRef.current) clearInterval(checkEndRef.current);
      playClip(clipStart, clipEnd);
      setCurrentLoop(loopCount > 0 ? 1 : 0);
    }
  }, [loopCount]);

  // 监听音频结束事件，重置hasStartedClip
  useEffect(() => {
    if (audioState.isPlaying === false && hasStartedClip && audioState.currentTime === 0) {
      setHasStartedClip(false);
    }
  }, [audioState.isPlaying, audioState.currentTime, hasStartedClip]);

  // 自动循环播放逻辑 - 当 clip 播放完毕且当前时间回到 clipStart 附近时自动循环
  useEffect(() => {
    // audio 正在播放时，不做任何事
    if (audioState.isPlaying) {
      setIsAutoLooping(false); // 开始播放时允许下一次循环触发
      return;
    }
    // 防止重复触发
    if (isAutoLooping) return;
    // 没有 clip 数据时，不做任何事
    if (clipEnd === 0) return;
    // 还没有开始过 clip 时，不做任何事
    if (!hasStartedClip) return;

    // 检查是否在 clipStart 附近（playClip 到达 clipEnd 后重置的位置）
    const atClipStart = Math.abs(audioState.currentTime - clipStart / 1000) < 0.2;
    if (!atClipStart) return;

    // 判断是否可以继续循环（loopCount 为 0 表示无限循环）
    const canLoop = loopCount === 0 || currentLoop < loopCount;
    if (!canLoop) return;

    // 需要循环，标记并重新播放
    setIsAutoLooping(true);
    if (loopCount > 0) {
      setCurrentLoop(prev => prev + 1);
    }
    setTimeout(() => {
      if (checkEndRef.current) clearInterval(checkEndRef.current);
      playClip(clipStart, clipEnd);
      setIsPlaying(true);
    }, 100);
  }, [audioState.isPlaying, audioState.currentTime, clipEnd, clipStart, loopCount, currentLoop, hasStartedClip, isAutoLooping]);

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // 离开练习模式前重置全局音频参数，防止影响其他页面
  const resetPracticeAudio = () => {
    clearClipMonitoring();
    setPlaybackRate(1);
  };

  // 计算相对于片段的时间
  const clipDuration = (clipEnd - clipStart) / 1000;
  const currentTimeInClip = Math.max(0, audioState.currentTime - clipStart / 1000);
  const currentTimeInClipFixed = Math.min(currentTimeInClip, clipDuration);

  return (
    <div className="practice-page">
      <header className="header">
        <img src="/logo.png" alt="Opener" className="header-logo" />
        <button className="back-btn" onClick={() => { stop(); resetPracticeAudio(); navigate(-1); }} aria-label="返回">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="11 18 5 12 11 6" />
          </svg>
        </button>
        <h1>练习模式</h1>
        <button className="btn-text" onClick={() => {
          const sourceSongId = getPracticeSourceSongId();
          stop();
          resetPracticeAudio();
          if (sourceSongId) {
            navigate(`/lyrics/${sourceSongId}`);
          } else {
            navigate("/library");
          }
        }}>
          返回原歌曲
        </button>
      </header>

      {favorite ? (
        <main className="content">
          <div className="practice-card">
            <div className="song-name">{favorite.songName}</div>
            <div className="lyric-line">{favorite.line.text}</div>
            {favorite.line.annotation && (
              <div className="annotation">📝 {favorite.line.annotation}</div>
            )}
            <textarea
              className="note-input"
              placeholder="添加批注..."
              value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
            />
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
              max={clipDuration}
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

          <div className="practice-controls">
            <button
              className="play-btn transparent-play-btn"
              onClick={togglePlay}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              <PlayPauseIcon isPlaying={isPlaying} size={32} />
            </button>
          </div>
        </main>
      ) : (
        <main className="content">
          <p>加载中...</p>
        </main>
      )}
    </div>
  );
}