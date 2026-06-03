import { createContext, useContext, useRef, useEffect, useState } from "react";
import type { Song, LyricLine } from "./types";

interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  songId: string | null;
  volume: number;
  playbackRate: number;
  song: Song | null;
  activeLyric: LyricLine | null;
  globalKeysEnabled: boolean;
}

interface AudioContextType {
  state: AudioState;
  loadSong: (song: Song) => void;
  updateSong: (song: Song) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  stop: () => void;
  playClip: (clipStart: number, clipEnd: number) => void;
  resumeClip: (clipStart: number, clipEnd: number) => void;
  clearClipMonitoring: () => void;
  resumePlay: () => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  clearSong: () => void;
  setActiveLyric: (lyric: LyricLine | null) => void;
  setGlobalKeysEnabled: (enabled: boolean) => void;
}

const AudioContext = createContext<AudioContextType | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const checkEndRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);

  const [state, setState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    songId: null,
    volume: 1,
    playbackRate: 1,
    song: null,
    activeLyric: null,
    globalKeysEnabled: true,
  });

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.addEventListener("timeupdate", () => {
      const currentTime = audio.currentTime;
      setState((prev) => {
        // Find active lyric based on clipStart/clipEnd
        let activeLyric: LyricLine | null = null;
        if (prev.song?.lyrics) {
          const currentTimeMs = currentTime * 1000;
          for (const line of prev.song.lyrics) {
            if (line.clipStart === undefined) continue;
            const endTime = line.clipEnd ?? line.clipStart + 5000;
            if (currentTimeMs >= line.clipStart && currentTimeMs <= endTime) {
              activeLyric = line;
              break; // Take the first match
            }
          }
        }
        return { ...prev, currentTime, activeLyric };
      });
    });

    audio.addEventListener("loadedmetadata", () => {
      setState((prev) => ({ ...prev, duration: audio.duration }));
    });
    audio.addEventListener("ended", () => {
      setState((prev) => ({ ...prev, isPlaying: false }));
    });
    audio.addEventListener("play", () => {
      setState((prev) => ({ ...prev, isPlaying: true }));
    });
    audio.addEventListener("pause", () => {
      setState((prev) => ({ ...prev, isPlaying: false }));
    });

    return () => {
      audio.pause();
      audio.src = "";
      if (currentAudioUrlRef.current) {
        URL.revokeObjectURL(currentAudioUrlRef.current);
        currentAudioUrlRef.current = null;
      }
    };
  }, []);

  const loadSong = (song: Song) => {
    if (!audioRef.current) return;
    audioRef.current.pause();

    // 释放上一首的 Blob URL
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }

    // 用本首的 Blob 重新生成 URL
    if (song.audioBlob) {
      const url = URL.createObjectURL(song.audioBlob);
      currentAudioUrlRef.current = url;
      audioRef.current.src = url;
    } else {
      audioRef.current.src = "";
    }
    audioRef.current.load();

    setState((prev) => ({
      ...prev,
      songId: song.id,
      song: song,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      activeLyric: null,
    }));
  };

  // 只更新歌曲数据，不重置播放状态（用于歌词编辑后同步）
  const updateSong = (song: Song) => {
    setState((prev) => {
      // 如果不是同一首歌，不更新
      if (prev.songId !== song.id) return prev;
      return { ...prev, song: song };
    });
  };

  const clearSong = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.src = "";
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      songId: null,
      song: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      activeLyric: null,
    }));
  };

  const play = () => {
    audioRef.current?.play();
  };

  const pause = () => {
    audioRef.current?.pause();
  };

  const toggle = () => {
    if (!audioRef.current) return;
    if (state.isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const seek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
    }
  };

  const playClip = (clipStart: number, clipEnd: number) => {
    if (!audioRef.current) return;
    if (checkEndRef.current) clearInterval(checkEndRef.current);

    audioRef.current.currentTime = clipStart / 1000;
    audioRef.current.play();
    setState((prev) => ({ ...prev, isPlaying: true }));

    checkEndRef.current = setInterval(() => {
      if (audioRef.current && audioRef.current.currentTime >= clipEnd / 1000) {
        audioRef.current.pause();
        audioRef.current.currentTime = clipStart / 1000;
        setState((prev) => ({ ...prev, isPlaying: false }));
        if (checkEndRef.current) clearInterval(checkEndRef.current);
      }
    }, 100);
  };

  // 从当前暂停位置继续播放，保持 clip 边界检查
  const resumeClip = (clipStart: number, clipEnd: number) => {
    if (!audioRef.current) return;
    if (checkEndRef.current) clearInterval(checkEndRef.current);

    audioRef.current.play();
    setState((prev) => ({ ...prev, isPlaying: true }));

    checkEndRef.current = setInterval(() => {
      if (audioRef.current && audioRef.current.currentTime >= clipEnd / 1000) {
        audioRef.current.pause();
        audioRef.current.currentTime = clipStart / 1000;
        setState((prev) => ({ ...prev, isPlaying: false }));
        if (checkEndRef.current) clearInterval(checkEndRef.current);
      }
    }, 100);
  };

  const clearClipMonitoring = () => {
    if (checkEndRef.current) {
      clearInterval(checkEndRef.current);
      checkEndRef.current = null;
    }
  };

  const resumePlay = () => {
    audioRef.current?.play();
  };

  const setVolume = (volume: number) => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      setState((prev) => ({ ...prev, volume }));
    }
  };

  const setPlaybackRate = (rate: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
      setState((prev) => ({ ...prev, playbackRate: rate }));
    }
  };

  const setActiveLyric = (lyric: LyricLine | null) => {
    setState((prev) => ({ ...prev, activeLyric: lyric }));
  };

  const setGlobalKeysEnabled = (enabled: boolean) => {
    setState((prev) => ({ ...prev, globalKeysEnabled: enabled }));
  };

  return (
    <AudioContext.Provider value={{ state, loadSong, updateSong, play, pause, toggle, seek, stop, playClip, resumeClip, clearClipMonitoring, resumePlay, setVolume, setPlaybackRate, clearSong, setActiveLyric, setGlobalKeysEnabled }}>
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error("useAudio must be used within AudioProvider");
  return ctx;
}