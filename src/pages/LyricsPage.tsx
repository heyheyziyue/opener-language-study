import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Volume2, Settings, Circle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getSong, saveSong } from "../lib/storage";
import { useAudio } from "../lib/audioContext";
import PlayPauseIcon from "../components/PlayPauseIcon";
import FolderPickerModal from "../components/FolderPickerModal";
import type { Song, LyricLine, FavoriteLine } from "../lib/types";
import { generateId, saveFavorite, getAllFavorites, updateFavoritesByLineId, deleteFavoritesByLineId, deleteFavorite } from "../lib/storage";
import { setPracticeSourceSongId } from "../lib/navigation";
import { useSeekDuration } from "../lib/settings";
import "./LyricsPage.css";

export default function LyricsPage() {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const { state, loadSong: loadAudioSong, updateSong: updateAudioSong, toggle, seek, playClip, resumeClip, pause, clearClipMonitoring, setVolume } = useAudio();

  const [song, setSong] = useState<Song | null>(null);
  const [selectedLine, setSelectedLine] = useState<LyricLine | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteLine[]>([]);
  // 收藏时弹文件夹选择器：linePendingFavorite 设置后弹窗显示
  const [linePendingFavorite, setLinePendingFavorite] = useState<LyricLine | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [clippingLineId, setClippingLineId] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingStart, setEditingStart] = useState("");
  const [editingEnd, setEditingEnd] = useState("");
  const [showAddLine, setShowAddLine] = useState(false);
  const [newLineText, setNewLineText] = useState("");
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [playingClipLineId, setPlayingClipLineId] = useState<string | null>(null);
  const [isStandalonePlay, setIsStandalonePlay] = useState(false);
  const [isStandaloneAutoLooping, setIsStandaloneAutoLooping] = useState(false);
  const [standaloneLoopCount, setStandaloneLoopCount] = useState(0); // 单独播放时循环次数，0=无限
  const [standaloneCurrentLoop, setStandaloneCurrentLoop] = useState(0);
  const [seekDuration, setSeekDuration] = useSeekDuration(); // 左右箭头调整进度的幅度（秒，全局设置）
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(() => {
    // 从 localStorage 读取关闭状态，默认显示
    return localStorage.getItem('guide-closed') !== 'true';
  });
  const [isTranslating, setIsTranslating] = useState(false); // 正在翻译
  const [editingTranslationLineId, setEditingTranslationLineId] = useState<string | null>(null); // 正在编辑翻译的行 ID
  const [editingTranslationText, setEditingTranslationText] = useState(""); // 翻译编辑中的临时文本
  const [dragType, setDragType] = useState<"start" | "end" | "range" | null>(null); // 时间轴拖拽类型
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 双击检测
  const timelineRef = useRef<HTMLDivElement>(null); // 时间轴 DOM 引用
  const songRef = useRef<Song | null>(null);
  const editingLineIdRef = useRef<string | null>(null);
  const editingStartMsRef = useRef(0);
  const editingEndMsRef = useRef(0);
  const songDurationMsRef = useRef(0);
  const windowStartRef = useRef(0);
  const windowRangeRef = useRef(0);
  const CLICK_THRESHOLD = 250; // 毫秒

  useEffect(() => {
    if (songId) {
      loadSongData();
      loadFavorites();
    }
    return () => {
      // 组件卸载时清理 timeout
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, [songId]);

  const loadSongData = async () => {
    const s = await getSong(songId!);
    if (s) {
      // 防御性清洗：清除历史上已存的脏数据（负值、终点早于起点）
      // 注：时长越界检查在保存时已用 state.duration 强约束，加载时只做不依赖时长的清洗
      let dirty = false;
      s.lyrics.forEach((line: LyricLine) => {
        if (line.clipStart !== undefined && line.clipStart < 0) {
          line.clipStart = undefined;
          dirty = true;
        }
        if (line.clipEnd !== undefined && line.clipEnd < 0) {
          line.clipEnd = undefined;
          dirty = true;
        }
        if (
          line.clipStart !== undefined &&
          line.clipEnd !== undefined &&
          line.clipEnd <= line.clipStart
        ) {
          line.clipEnd = undefined;
          dirty = true;
        }
      });
      if (dirty) {
        await saveSong(s);
      }
      setSong(s);
      // 只有当加载的歌曲与当前播放的不同时，才重新加载音频
      if (state.songId !== s.id) {
        loadAudioSong(s);
      }
    }
  };

  const loadFavorites = async () => {
    const all = await getAllFavorites();
    setFavorites(all.filter((f) => f.songId === songId));
  };

  // 翻译单句歌词（通过我们自己的 /api/translate 后端，1 行也走批量接口）
  const translateLine = async (line: LyricLine): Promise<string> => {
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: [line.text] }),
      });
      if (!response.ok) throw new Error("翻译请求失败");
      const data = await response.json();
      if (data.translations?.[0]) {
        return data.translations[0];
      }
      throw new Error("翻译失败");
    } catch (err) {
      console.error("翻译错误:", err);
      return line.text; // 翻译失败时返回原文
    }
  };

  // 一键翻译全部歌词
  // 为什么切片并行：EdgeOne 函数 ~30s 超时，行数多时单次批量调用会超时
  // 每批 20 行 ≈ 2-3s，并行后整首歌 ~3-5s 完成
  const TRANSLATE_BATCH_SIZE = 20;
  const handleTranslateAll = async () => {
    if (!song || isTranslating) return;
    setIsTranslating(true);
    try {
      // 找出还没翻译的行（避免重复翻译、节省 token）
      const untranslated = song.lyrics.filter((l) => !l.translation);
      if (untranslated.length === 0) return;

      // 切片：把 N 行分成 ceil(N/20) 个小批次
      const batches: LyricLine[][] = [];
      for (let i = 0; i < untranslated.length; i += TRANSLATE_BATCH_SIZE) {
        batches.push(untranslated.slice(i, i + TRANSLATE_BATCH_SIZE));
      }

      // 并行调所有批次（每批独立的 /api/translate 请求）
      // 每批带原行数组的引用，翻译结果直接写回 line.translation
      await Promise.all(
        batches.map(async (batch) => {
          const response = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines: batch.map((l) => l.text) }),
          });
          if (!response.ok) throw new Error("翻译请求失败");
          const data = await response.json();
          if (!Array.isArray(data.translations)) {
            throw new Error("翻译响应格式错误");
          }
          // 把翻译结果写回对应的行对象（line 是引用，直接修改即可）
          batch.forEach((line, i) => {
            line.translation = data.translations[i] || line.text;
          });
        })
      );

      setSong({ ...song, lyrics: [...song.lyrics] });
      await saveSong(song);
    } catch (err) {
      console.error("批量翻译错误:", err);
      alert("翻译失败，请稍后重试");
    } finally {
      setIsTranslating(false);
    }
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatMs = (ms: number) => formatTime(ms / 1000);

  // 解析 "1:30" 或 "90" 格式为秒数
  // 严格校验：禁止负号、多个冒号、非数字字符；MM:SS 中秒数须在 0-59
  const parseTimeStr = (str: string): number | null => {
    const trimmed = str.trim();
    if (!trimmed) return null;
    // 禁止负号
    if (trimmed.startsWith("-") || trimmed.includes("-")) return null;
    if (trimmed.includes(":")) {
      const parts = trimmed.split(":");
      // 只允许 1 个冒号（MM:SS），且分钟/秒均为非负整数
      if (parts.length !== 2) return null;
      const [minsStr, secsStr] = parts;
      if (!/^\d+$/.test(minsStr) || !/^\d+$/.test(secsStr)) return null;
      const mins = parseInt(minsStr, 10);
      const secs = parseInt(secsStr, 10);
      if (secs < 0 || secs >= 60) return null;
      return mins * 60 + secs;
    }
    // 纯秒数：必须为非负整数
    if (!/^\d+$/.test(trimmed)) return null;
    return parseInt(trimmed, 10);
  };

  // 字符串 → 毫秒（空字符串返回 0）
  const parseTimeMs = (str: string): number => {
    const sec = parseTimeStr(str);
    return sec === null ? 0 : sec * 1000;
  };

  // 同步关键值到 ref，供全局拖拽监听器读取最新值
  const editingStartMs = parseTimeMs(editingStart);
  const editingEndMs = parseTimeMs(editingEnd);
  const songDurationMs = state.duration ? state.duration * 1000 : 0;

  // 计算时间轴窗口：以片段为中心，前后各留 padding，窗口至少 5 秒
  const computeTimelineWindow = (): { windowStart: number; windowEnd: number } => {
    const rangeLength = editingEndMs - editingStartMs;
    const minPadding = 2000;
    const minTotalRange = 5000;
    let totalRange = Math.max(rangeLength + minPadding * 2, minTotalRange);
    let windowStart = editingStartMs - (totalRange - rangeLength) / 2;
    let windowEnd = editingEndMs + (totalRange - rangeLength) / 2;
    if (windowStart < 0) {
      windowEnd += -windowStart;
      windowStart = 0;
    }
    if (windowEnd > songDurationMs) {
      windowStart -= windowEnd - songDurationMs;
      windowEnd = songDurationMs;
    }
    if (windowStart < 0) windowStart = 0;
    return { windowStart, windowEnd };
  };

  const { windowStart, windowEnd } = computeTimelineWindow();
  const windowRange = windowEnd - windowStart;

  const rangeLeft = windowRange > 0 ? ((editingStartMs - windowStart) / windowRange) * 100 : 0;
  const rangeWidth = windowRange > 0 ? ((editingEndMs - editingStartMs) / windowRange) * 100 : 0;

  // 每次渲染后同步 ref，让全局监听器能拿到最新值
  songRef.current = song;
  editingLineIdRef.current = editingLineId;
  editingStartMsRef.current = editingStartMs;
  editingEndMsRef.current = editingEndMs;
  songDurationMsRef.current = songDurationMs;
  windowStartRef.current = windowStart;
  windowRangeRef.current = windowRange;

  // 鼠标像素 → 毫秒
  const pixelToMs = (clientX: number): number => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return windowStartRef.current + ratio * windowRangeRef.current;
  };

  // 起点手柄 / 终点手柄 / 范围区 拖拽起点
  const handleStartDragStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragType("start");
  };
  const handleEndDragStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragType("end");
  };
  const handleRangeDragStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragType("range");
  };

  // 全局 mousemove / mouseup：处理时间轴拖拽
  useEffect(() => {
    if (!dragType) return;

    const handleMouseMove = (e: MouseEvent) => {
      const time = pixelToMs(e.clientX);
      const song = songRef.current;
      const editingLineId = editingLineIdRef.current;
      if (!song || !editingLineId) return;
      const line = song.lyrics.find((l) => l.id === editingLineId);
      if (!line) return;

      if (dragType === "start") {
        const newStart = Math.max(0, Math.min(time, editingEndMsRef.current - 100));
        line.clipStart = newStart;
        setSong({ ...song });
        setEditingStart(formatMs(newStart));
      } else if (dragType === "end") {
        const newEnd = Math.min(songDurationMsRef.current, Math.max(time, editingStartMsRef.current + 100));
        line.clipEnd = newEnd;
        setSong({ ...song });
        setEditingEnd(formatMs(newEnd));
      } else if (dragType === "range") {
        const rangeLength = editingEndMsRef.current - editingStartMsRef.current;
        const newStart = Math.max(
          0,
          Math.min(time - rangeLength / 2, songDurationMsRef.current - rangeLength)
        );
        line.clipStart = newStart;
        line.clipEnd = newStart + rangeLength;
        setSong({ ...song });
        setEditingStart(formatMs(newStart));
        setEditingEnd(formatMs(newStart + rangeLength));
      }
    };

    const handleMouseUp = async () => {
      setDragType(null);
      const song = songRef.current;
      const editingLineId = editingLineIdRef.current;
      if (!song || !editingLineId) return;
      const line = song.lyrics.find((l) => l.id === editingLineId);
      if (!line) return;

      if (dragType === "start") {
        const endMs = line.clipEnd ?? line.clipStart! + 5000;
        await saveSong(song);
        await updateFavoritesByLineId(song.id, line.id, line);
        updateAudioSong(song);
        playClip(line.clipStart!, endMs);
      } else {
        await saveSong(song);
        await updateFavoritesByLineId(song.id, line.id, line);
        updateAudioSong(song);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragType]);

  const handleLineClick = (line: LyricLine) => {
    if (editingLineId) return;

    // 如果有 pending 的 timeout，说明这是双击的第二次点击，清除它并交给双击处理
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      return;
    }

    // 设置 timeout，如果在阈值时间内再次点击，会被 handleLineDoubleClick 清除
    clickTimeoutRef.current = setTimeout(() => {
      clickTimeoutRef.current = null;

      // 单击处理：选中并跳转到该行
      if (playingClipLineId !== line.id && isStandalonePlay) {
        handleCancelStandalone();
      }
      setSelectedLine(line);
      if (line.clipStart !== undefined) {
        seek(line.clipStart / 1000);
      }
    }, CLICK_THRESHOLD);
  };

  const handleShowActions = (line: LyricLine) => {
    if (editingLineId) return;
    setSelectedLine(line);
    setActiveLineId(null); // 清除自动高亮
    setShowActions(true);
  };

  const handleLineDoubleClick = (line: LyricLine) => {
    // 清除单击的 timeout，防止触发单击处理
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    handleShowActions(line);
  };

  const handleSaveEdit = async () => {
    if (!song || !editingLineId) return;
    const line = song.lyrics.find((l) => l.id === editingLineId);
    if (!line) return;

    line.text = editingText;

    // 未设置时间戳的歌词：startMs 和 endMs 都为 0，且原本就没有 clipStart
    // 这种情况跳过所有时间校验，仅保存文本
    const startMsRaw = parseTimeStr(editingStart);
    const endMsRaw = parseTimeStr(editingEnd);
    const isNoTimestamp =
      startMsRaw !== null && endMsRaw !== null &&
      startMsRaw === 0 && endMsRaw === 0 &&
      line.clipStart === undefined;

    if (!isNoTimestamp) {
      // 第一层：格式校验 — 解析失败必须由用户重新输入
      if (startMsRaw === null || endMsRaw === null) {
        alert("时间格式不正确，请输入如 1:30 或 90 的格式");
        return;
      }

      const startMs = startMsRaw * 1000;
      const endMs = endMsRaw * 1000;

      // 第二层：范围校验 — 必须在 [0, songDuration] 之间
      const songDurationMs = state.duration ? state.duration * 1000 : 0;
      if (
        startMs < 0 ||
        startMs > songDurationMs ||
        endMs < 0 ||
        endMs > songDurationMs
      ) {
        alert(`时间必须在 0:00 到 ${formatMs(songDurationMs)} 之间`);
        return;
      }

      // 第三层：顺序校验 — 终点必须严格晚于起点
      if (endMs <= startMs) {
        alert("截取终点必须晚于起点，请调整时间");
        return;
      }

      line.clipStart = startMs;
      line.clipEnd = endMs;
    }

    // 如果编辑的是正在单独播放的歌词，用新的时间戳重新开始播放
    if (playingClipLineId === editingLineId && isStandalonePlay) {
      clearClipMonitoring();
      setStandaloneCurrentLoop(0);
      setIsStandaloneAutoLooping(false);
      const clipEnd = line.clipEnd ?? line.clipStart! + 5000;
      playClip(line.clipStart!, clipEnd);
    }

    await saveSong(song);
    // 同步更新收藏夹中的歌词引用
    await updateFavoritesByLineId(song.id, line.id, line);
    await loadFavorites();
    setSong({ ...song });
    updateAudioSong(song);
    setEditingLineId(null);
  };

  const handleCancelEdit = () => {
    setEditingLineId(null);
  };

  const handlePlayLine = useCallback(() => {
    if (!song || !selectedLine) return;
    setShowActions(false);

    const line = selectedLine;
    const hasClip = line.clipStart !== undefined && line.clipEnd !== undefined;

    if (!hasClip) {
      // 开始截取模式 - 检查是否有其他行正在截取
      if (clippingLineId && clippingLineId !== line.id) {
        const currentTimeMs = state.currentTime * 1000;
        const prevLine = song.lyrics.find((l) => l.id === clippingLineId);
        if (prevLine) {
          prevLine.clipEnd = currentTimeMs;
        }
      }
      // 开始截取模式 - 记录当前播放位置为开始，不改变播放状态
      setClippingLineId(line.id);
      line.clipStart = state.currentTime * 1000;
      line.clipEnd = undefined;
      setSong({ ...song });
    } else {
      // 已有截取，播放片段
      clearClipMonitoring();
      setPlayingClipLineId(line.id);
      playClip(line.clipStart!, line.clipEnd!);
    }
  }, [song, selectedLine, state.currentTime, playClip]);

  // 单独播放 - 单独播放选中歌词对应的时间范围，显示独立时间轴
  const handlePlayLineStandalone = useCallback(() => {
    if (!song || !selectedLine || selectedLine.clipStart === undefined) return;
    const clipEnd = selectedLine.clipEnd ?? selectedLine.clipStart + 5000;
    setShowActions(false);
    // 确保在播放前设置好独立播放状态
    setPlayingClipLineId(selectedLine.id);
    setIsStandalonePlay(true);
    // 清除之前的监控
    clearClipMonitoring();
    // 开始播放
    playClip(selectedLine.clipStart, clipEnd);
  }, [song, selectedLine, clearClipMonitoring]);

  // 取消单独播放
  const handleCancelStandalone = useCallback(() => {
    setPlayingClipLineId(null);
    setIsStandalonePlay(false);
    setIsStandaloneAutoLooping(false);
    clearClipMonitoring();
  }, [clearClipMonitoring]);

  // 独立控制单独播放片段的播放/暂停
  const toggleStandalonePlay = () => {
    if (!song || !playingClipLineId) return;
    const line = song.lyrics.find((l) => l.id === playingClipLineId);
    if (!line || line.clipStart === undefined) return;
    const end = line.clipEnd ?? line.clipStart + 5000;

    if (state.isPlaying) {
      // 当前正在播放，暂停
      pause();
    } else {
      // 未播放（暂停中或已结束），从当前位置继续播放
      resumeClip(line.clipStart, end);
    }
  };

  // 监测截取是否完成
  useEffect(() => {
    if (!song || !clippingLineId) return;
    const line = song.lyrics.find((l) => l.id === clippingLineId);
    if (!line || !line.clipEnd) return;

    const clipEndSec = line.clipEnd / 1000;
    if (state.currentTime >= clipEndSec) {
      clearClipMonitoring();
      setClippingLineId(null);
    }
  }, [state.currentTime, clippingLineId, song]);

  // 监听主播放器的播放/暂停操作，退出单独播放模式
  const handleMainToggle = useCallback(() => {
    if (isStandalonePlay) {
      handleCancelStandalone();
    }
    toggle();
  }, [isStandalonePlay, handleCancelStandalone, toggle]);

  const handleMainSeek = useCallback((time: number) => {
    if (isStandalonePlay) {
      handleCancelStandalone();
    }
    seek(time);
  }, [isStandalonePlay, handleCancelStandalone, seek]);

  // 播放器前后微调 2 秒（取自音频上下文 duration，不超出 [0, duration]）
  const handleSkipBack = () => {
    handleMainSeek(Math.max(0, state.currentTime - 2));
  };

  const handleSkipForward = () => {
    const duration = state.duration || 0;
    handleMainSeek(Math.min(duration, state.currentTime + 2));
  };

  const finishClipping = (): boolean => {
    if (!song || !clippingLineId) return false;
    const line = song.lyrics.find((l) => l.id === clippingLineId);
    if (line && line.clipStart !== undefined) {
      // 校验：截取终点必须严格晚于起点
      if (state.currentTime * 1000 <= line.clipStart) {
        alert("截取终点必须晚于起点，请将进度调整到起点之后的位置");
        return false;
      }
      line.clipEnd = state.currentTime * 1000;
    }
    const nextSong = { ...song, lyrics: [...song.lyrics] };
    setSong(nextSong);
    updateAudioSong(nextSong);
    setClippingLineId(null);
    saveSong(nextSong);
    return true;
  };

  // 开始截取某行（记录 clipStart=当前时间，clipEnd=undefined）
  const startClipping = (lineId: string) => {
    if (!song) return;
    const line = song.lyrics.find((l) => l.id === lineId);
    if (!line) return;
    line.clipStart = state.currentTime * 1000;
    line.clipEnd = undefined;
    setClippingLineId(lineId);
    const nextSong = { ...song, lyrics: [...song.lyrics] };
    setSong(nextSong);
    updateAudioSong(nextSong);
    saveSong(nextSong);
  };

  // 剪刀按钮点击：同一行 → 完成截取；不同行 → 完成上一行(如有) + 开始新行
  const handleClipButtonClick = (line: LyricLine) => {
    if (!song) return;
    // 同一行：完成当前截取
    if (clippingLineId === line.id) {
      finishClipping();
      return;
    }
    // 切换到不同行：先尝试完成之前的截取
    if (clippingLineId) {
      if (!finishClipping()) return;
    }
    // 开始新行截取
    startClipping(line.id);
  };

  // 单独播放自动循环逻辑
  useEffect(() => {
    // audio 正在播放时，不做任何事
    if (state.isPlaying) {
      setIsStandaloneAutoLooping(false);
      return;
    }
    // 防止重复触发
    if (isStandaloneAutoLooping) return;
    // 没有单独播放时，不做任何事
    if (!playingClipLineId || !isStandalonePlay) return;
    if (!song) return;

    const line = song.lyrics.find(l => l.id === playingClipLineId);
    if (!line || line.clipStart === undefined) return;

    // 检查是否在 clipStart 附近（playClip 到达 clipEnd 后重置的位置）
    const atClipStart = Math.abs(state.currentTime - line.clipStart / 1000) < 0.2;
    if (!atClipStart) return;

    // 判断是否可以继续循环（loopCount 为 0 表示无限循环）
    const canLoop = standaloneLoopCount === 0 || standaloneCurrentLoop < standaloneLoopCount;
    if (!canLoop) return;

    // 需要循环，标记并重新播放
    setIsStandaloneAutoLooping(true);
    if (standaloneLoopCount > 0) {
      setStandaloneCurrentLoop(prev => prev + 1);
    }
    const clipEnd = line.clipEnd ?? line.clipStart + 5000;
    setTimeout(() => {
      clearClipMonitoring();
      playClip(line.clipStart!, clipEnd);
    }, 100);
  }, [state.isPlaying, state.currentTime, playingClipLineId, isStandalonePlay, standaloneLoopCount, standaloneCurrentLoop, isStandaloneAutoLooping, song]);

  // 当 standaloneLoopCount 改变时，重置 standaloneCurrentLoop
  useEffect(() => {
    setStandaloneCurrentLoop(standaloneLoopCount > 0 ? 1 : 0);
    setIsStandaloneAutoLooping(false);
  }, [standaloneLoopCount]);

  const handleCancelClip = () => {
    if (!song || !clippingLineId) return;
    const line = song.lyrics.find((l) => l.id === clippingLineId);
    if (line) {
      line.clipStart = undefined;
      line.clipEnd = undefined;
    }
    setSong({ ...song });
    updateAudioSong(song);
    setClippingLineId(null);
    setShowActions(false);
    saveSong(song);
  };

  // 取消之前的截取并开始新的截取
  const handleCancelClipThenStart = () => {
    if (!song || !selectedLine || clippingLineId === selectedLine.id) return;

    // 取消之前的截取
    const prevLine = song.lyrics.find((l) => l.id === clippingLineId);
    if (prevLine) {
      prevLine.clipStart = undefined;
      prevLine.clipEnd = undefined;
    }

    // 开始新的截取
    setClippingLineId(selectedLine.id);
    selectedLine.clipStart = state.currentTime * 1000;
    selectedLine.clipEnd = undefined;
    setSong({ ...song });
    updateAudioSong(song);
    saveSong(song);
  };

  const handleFavorite = async () => {
    if (!song || !selectedLine) return;

    // 检查是否已经收藏过这句歌词
    const allFavs = await getAllFavorites();
    const alreadyFavorited = allFavs.some(
      (fav) => fav.songId === song.id && fav.line.id === selectedLine.id
    );
    if (alreadyFavorited) {
      alert("这句歌词已经在收藏夹中了");
      setShowActions(false);
      return;
    }

    // 弹文件夹选择器，由用户确认后写入
    setLinePendingFavorite(selectedLine);
    setFolderPickerOpen(true);
    setShowActions(false);
  };

  // 用户在 FolderPickerModal 点击确定后实际写入收藏
  const performFavorite = async (folderId: string | null | undefined) => {
    if (!song || !linePendingFavorite) return;
    const favorite: FavoriteLine = {
      id: generateId(),
      songId: song.id,
      songName: song.name,
      line: linePendingFavorite,
      practiceCount: 0,
      speed: 1,
      createdAt: new Date().toISOString(),
      folderId: folderId ?? undefined,
    };
    await saveFavorite(favorite);
    await loadFavorites();
    setLinePendingFavorite(null);
  };

  const handleUnfavorite = async () => {
    if (!song || !selectedLine) return;
    const allFavs = await getAllFavorites();
    const fav = allFavs.find(
      (f) => f.songId === song.id && f.line.id === selectedLine.id
    );
    if (fav) {
      await deleteFavorite(fav.id);
      await loadFavorites();
    }
    setShowActions(false);
  };

  // 进入练习模式
  const handleEnterPractice = () => {
    if (!song || !selectedLine) return;
    const fav = favorites.find(
      (f) => f.line.id === selectedLine.id
    );
    if (!fav) {
      alert("请先收藏这句歌词");
      return;
    }
    setShowActions(false);
    setPracticeSourceSongId(song.id);
    navigate(`/practice/${fav.id}`);
  };

  const isLineFavorited = (lineId: string) => {
    return favorites.some((f) => f.line.id === lineId);
  };

  // 切换单行收藏状态（不依赖 selectedLine）— 取消时直接删除；添加时弹文件夹选择器
  const toggleLineFavorite = async (line: LyricLine) => {
    if (!song) return;
    const alreadyFav = favorites.some((f) => f.line.id === line.id);
    if (alreadyFav) {
      const allFavs = await getAllFavorites();
      const fav = allFavs.find(
        (f) => f.songId === song.id && f.line.id === line.id
      );
      if (fav) {
        await deleteFavorite(fav.id);
        await loadFavorites();
      }
    } else {
      // 弹文件夹选择器
      setLinePendingFavorite(line);
      setFolderPickerOpen(true);
    }
  };

  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    if (isSelectMode) {
      setSelectedLines(new Set());
    }
  };

  const toggleLineSelection = (lineId: string) => {
    const newSelected = new Set(selectedLines);
    if (newSelected.has(lineId)) {
      newSelected.delete(lineId);
    } else {
      newSelected.add(lineId);
    }
    setSelectedLines(newSelected);
  };

  const handleBatchDelete = async () => {
    if (!song || selectedLines.size === 0) return;
    if (!confirm(`确认删除选中的 ${selectedLines.size} 句歌词？`)) return;
    const deletedIds = Array.from(selectedLines);
    // 删除歌词行
    song.lyrics = song.lyrics.filter((l) => !deletedIds.includes(l.id));
    await saveSong(song);
    // 同步删除这些行关联的收藏
    for (const id of deletedIds) {
      await deleteFavoritesByLineId(song.id, id);
    }
    await loadFavorites();
    setSong({ ...song });
    updateAudioSong(song);
    setSelectedLines(new Set());
    setIsSelectMode(false);
  };

  const handleBatchFavorite = async () => {
    if (!song || selectedLines.size === 0) return;
    let addedCount = 0;
    for (const lineId of selectedLines) {
      const line = song.lyrics.find((l) => l.id === lineId);
      if (!line) continue;
      const alreadyFav = favorites.some((f) => f.line.id === lineId);
      if (alreadyFav) continue;
      const fav: FavoriteLine = {
        id: generateId(),
        songId: song.id,
        songName: song.name,
        line: line,
        practiceCount: 0,
        speed: 1,
        createdAt: new Date().toISOString(),
      };
      await saveFavorite(fav);
      addedCount++;
    }
    await loadFavorites();
    setSelectedLines(new Set());
    setIsSelectMode(false);
    if (addedCount > 0) {
      alert(`已添加 ${addedCount} 句到收藏夹`);
    } else {
      alert("所选歌词已在收藏夹中");
    }
  };

  const handleTranslate = async () => {
    if (!song || !selectedLine) return;
    setShowActions(false);
    // 仅在没有翻译时生成；清除翻译请用翻译行内的"隐藏"或"编辑"功能
    if (selectedLine.translation) return;
    selectedLine.translation = await translateLine(selectedLine);
    setSong({ ...song, lyrics: [...song.lyrics] });
    await saveSong(song);
  };

  // ===== 翻译行编辑（仅修改单行翻译内容，不影响原歌词行） =====
  const handleStartEditTranslation = (line: LyricLine) => {
    setEditingTranslationLineId(line.id);
    setEditingTranslationText(line.translation || "");
  };

  const handleCancelTranslationEdit = () => {
    setEditingTranslationLineId(null);
    setEditingTranslationText("");
  };

  const handleSaveTranslationEdit = async (line: LyricLine) => {
    if (!song) return;
    const target = song.lyrics.find((l) => l.id === line.id);
    if (!target) return;
    const trimmed = editingTranslationText.trim();
    target.translation = trimmed || undefined;
    // 保存后立即退出编辑态
    setSong({ ...song, lyrics: [...song.lyrics] });
    await saveSong(song);
    setEditingTranslationLineId(null);
    setEditingTranslationText("");
  };

  // ===== 翻译行隐藏 toggle（仅 UI 展示控制，不删除数据） =====
  const handleToggleTranslationHidden = async (line: LyricLine) => {
    if (!song) return;
    const target = song.lyrics.find((l) => l.id === line.id);
    if (!target) return;
    target.translationHidden = !target.translationHidden;
    setSong({ ...song, lyrics: [...song.lyrics] });
    await saveSong(song);
  };

  const handleDeleteLine = async () => {
    if (!song || !selectedLine) return;
    if (!confirm("确认删除这句歌词？")) return;
    const deletedLineId = selectedLine.id;
    song.lyrics = song.lyrics.filter((l) => l.id !== deletedLineId);
    await saveSong(song);
    // 删除收藏夹中该歌词的所有引用
    await deleteFavoritesByLineId(song.id, deletedLineId);
    await loadFavorites();
    setSong({ ...song });
    updateAudioSong(song);
    setShowActions(false);
    setSelectedLine(null);
  };

  const handleAddLine = async () => {
    if (!song || !newLineText.trim()) return;
    const lines = newLineText.split("\n").filter(l => l.trim());
    if (lines.length === 0) return;

    const newLines: LyricLine[] = lines.map(text => ({
      id: generateId(),
      text: text.trim(),
    }));

    song.lyrics.push(...newLines);
    await saveSong(song);
    setSong({ ...song });
    updateAudioSong(song);
    setNewLineText("");
    setShowAddLine(false);
  };

  const getLineClipStatus = (line: LyricLine) => {
    if (clippingLineId === line.id) return "clipping";
    if (line.clipStart !== undefined && line.clipEnd !== undefined) return "clipped";
    if (line.clipStart !== undefined) return "started";
    return "none";
  };

  // 监听当前播放时间，高亮对应歌词行
  useEffect(() => {
    if (!song) return;

    // 如果处于独立播放状态，不根据主时间轴高亮任何歌词
    if (isStandalonePlay) return;

    const currentTimeMs = state.currentTime * 1000;

    // 找到所有当前时间重合的歌词行
    const activeLineIds: string[] = [];
    song.lyrics.forEach((line) => {
      if (line.clipStart === undefined) return;
      const endTime = line.clipEnd ?? line.clipStart + 5000;
      if (currentTimeMs >= line.clipStart && currentTimeMs <= endTime) {
        activeLineIds.push(line.id);
      }
    });

    // 如果有重合的歌词，设置所有重合的行ID
    // 注意：这里只设置 activeLineId（高亮），selectedLine（选中）不受影响
    if (activeLineIds.length > 0) {
      setActiveLineId(activeLineIds.join(','));
    } else {
      setActiveLineId(null);
    }
  }, [state.currentTime, song, isStandalonePlay]);

  // 空格键控制播放/暂停，左右箭头调整进度，J键开始/完成截取，上下键切换歌词行
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 编辑模式下允许来自edit form内元素的键盘事件
      const isInEditForm = editingLineId && (e.target as HTMLElement)?.closest?.('.edit-form');
      if (!isInEditForm && e.target !== document.body && e.target !== document.documentElement) return;
      if (e.code === "KeyJ" && selectedLine && !editingLineId) {
        e.preventDefault();
        if (clippingLineId === selectedLine.id) {
          // 选中的行正在截取 → 完成截取
          finishClipping();
        } else if (clippingLineId && clippingLineId !== selectedLine.id) {
          // 其他行正在截取 → 完成那行，开始选中的行的截取
          const prevLine = song?.lyrics.find((l) => l.id === clippingLineId);
          if (prevLine && prevLine.clipStart !== undefined) {
            // 校验：截取终点必须严格晚于起点
            if (state.currentTime * 1000 <= prevLine.clipStart) {
              alert("截取终点必须晚于起点，请将进度调整到起点之后的位置");
              return;
            }
            prevLine.clipEnd = state.currentTime * 1000;
          }
          selectedLine.clipEnd = undefined;
          setClippingLineId(selectedLine.id);
          selectedLine.clipStart = state.currentTime * 1000;
          if (song) {
            const nextSong = { ...song, lyrics: [...song.lyrics] };
            setSong(nextSong);
            updateAudioSong(nextSong);
            saveSong(nextSong);
          }
        } else {
          // 没有截取 → 开始截取
          selectedLine.clipEnd = undefined;
          setClippingLineId(selectedLine.id);
          selectedLine.clipStart = state.currentTime * 1000;
          if (song) {
            const nextSong = { ...song, lyrics: [...song.lyrics] };
            setSong(nextSong);
            updateAudioSong(nextSong);
            saveSong(nextSong);
          }
        }
      }
      // 上下键切换歌词行
      if ((e.code === "ArrowUp" || e.code === "ArrowDown") && !editingLineId) {
        e.preventDefault();
        if (!song?.lyrics || song.lyrics.length === 0) return;
        const lyrics = song.lyrics;
        if (!selectedLine) {
          // 没有选中行时，按上键选最后一行，下键选第一行
          setSelectedLine(e.code === "ArrowUp" ? lyrics[lyrics.length - 1] : lyrics[0]);
        } else {
          const currentIndex = lyrics.findIndex(l => l.id === selectedLine.id);
          if (currentIndex === -1) return;
          const newIndex = e.code === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
          if (newIndex >= 0 && newIndex < lyrics.length) {
            setSelectedLine(lyrics[newIndex]);
          }
        }
      }
      // P键控制单独播放/取消
      if (e.code === "KeyP" && selectedLine && !editingLineId) {
        e.preventDefault();
        if (isStandalonePlay) {
          if (playingClipLineId === selectedLine.id) {
            // 如果对正在单独播放的歌词按P，只取消单独播放
            handleCancelStandalone();
          } else {
            // 如果选中其他行，取消当前行的单独播放，开始新选中行的单独播放
            handleCancelStandalone();
            handlePlayLineStandalone();
          }
        } else {
          // 开始单独播放
          handlePlayLineStandalone();
        }
      }
      // 主时间轴的左右箭头调整（编辑模式下禁用）
      if (!editingLineId && (e.code === "ArrowLeft" || e.code === "ArrowRight")) {
        e.preventDefault();
        const delta = e.code === "ArrowLeft" ? -seekDuration : seekDuration;
        handleMainSeek(state.currentTime + delta);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.currentTime, state.duration, song, selectedLine, clippingLineId, editingLineId, seekDuration]);

  // 关闭使用指南：隐藏 + 持久化
  const handleCloseGuide = () => {
    setShowGuide(false);
    localStorage.setItem('guide-closed', 'true');
  };

  return (
    <div className="lyrics-page" onClick={() => { setShowActions(false); }}>
      <header className="header">
        <img src="/logo.png" alt="Opener" className="header-logo" />
        <button className="back-btn" onClick={() => navigate(-1)} aria-label="返回">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="11 18 5 12 11 6" />
          </svg>
        </button>
        <div className="header-actions">
          <button className="btn-text" onClick={() => setShowGuide(true)}>
            如何使用
          </button>
          <button className="settings-btn" onClick={() => setShowSettings(true)}>
            <Settings size={24} />
          </button>
        </div>
      </header>

      <div className="song-info-center">
        <h1 className="song-title">{song?.name || "Loading..."}</h1>
      </div>

      <div className="lyrics-header">
        <div className="lyrics-header-actions">
          <button className="btn-text" onClick={() => setShowAddLine(true)}>添加歌词</button>
          <button
            className="btn-text"
            onClick={handleTranslateAll}
            disabled={isTranslating}
          >
            {isTranslating ? "翻译中..." : "一键翻译"}
          </button>
          {!isSelectMode ? (
            <button className="btn-text" onClick={toggleSelectMode}>批量操作</button>
          ) : (
            <>
              <button
                className="btn-text"
                onClick={handleBatchDelete}
                disabled={selectedLines.size === 0}
              >
                删除 {selectedLines.size > 0 ? `(${selectedLines.size})` : ""}
              </button>
              <button
                className="btn-text active"
                onClick={handleBatchFavorite}
                disabled={selectedLines.size === 0}
              >
                收藏 {selectedLines.size > 0 ? `(${selectedLines.size})` : ""}
              </button>
              <button className="btn-text" onClick={toggleSelectMode}>取消</button>
            </>
          )}
        </div>
      </div>

      {showAddLine && (
        <div className="add-line-form">
          <textarea
            className="add-line-textarea"
            value={newLineText}
            onChange={(e) => setNewLineText(e.target.value)}
            placeholder="输入歌词，每行一句"
            rows={4}
          />
          <div className="add-line-form-actions">
            <button className="btn-text" onClick={handleAddLine}>添加</button>
            <button className="btn-text" onClick={() => { setShowAddLine(false); setNewLineText(""); }}>取消</button>
          </div>
        </div>
      )}

      {song?.audioBlob && (
        <div className="player">
          <div className="player-controls">
            <button
              className="transparent-play-btn"
              onClick={handleSkipBack}
              aria-label="后退2秒"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="19,5 5,12 19,19" />
              </svg>
            </button>
            <button
              className="transparent-play-btn"
              onClick={handleMainToggle}
              aria-label={state.isPlaying ? "暂停" : "播放"}
            >
              <PlayPauseIcon isPlaying={state.isPlaying} size={24} />
            </button>
            <button
              className="transparent-play-btn"
              onClick={handleSkipForward}
              aria-label="前进2秒"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="5,5 19,12 5,19" />
              </svg>
            </button>
          </div>
          <div className="progress-volume-wrapper">
            <div className="progress-container progress-bar">
              <span>{formatTime(state.currentTime)}</span>
              <input
                type="range"
                min="0"
                max={state.duration || 100}
                value={state.currentTime}
                onChange={(e) => handleMainSeek(Number(e.target.value))}
              />
              <span>{formatTime(state.duration)}</span>
            </div>
            <div className="volume-container volume">
              <Volume2 size={20} />
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={state.volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      )}

      <div className="lyrics-list">
        {showGuide && (
          <div className="guide-card">
            <button className="guide-close-btn" onClick={handleCloseGuide} aria-label="关闭使用指南">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <h3 className="guide-title">如何高效使用本工具</h3>
            <div className="guide-section">
              <h4 className="guide-section-title">1. 截取时间</h4>
              <p className="guide-section-text">
                每句歌词都可以根据自己的需求截取时间，让歌词与对应的音频匹配。
                你可以使用歌词行的剪刀图标，也可以在电脑上使用快捷键 J（选中句子之后）。
                在一句话开始的时候开始截取，在结束时结束截取。
              </p>
            </div>
            <div className="guide-section">
              <h4 className="guide-section-title">2. 反复练习</h4>
              <p className="guide-section-text">
                截取时间是为了方便对单句歌词反复练习。
                不仅可以定制时间戳，还可以选择播放速度与循环次数。
                这很有必要，有些歌词确实需要你反复听细节。
              </p>
            </div>
            <div className="guide-section">
              <h4 className="guide-section-title">3. 记得收藏歌词</h4>
              <p className="guide-section-text">
                像错题本一样，收藏重要的歌词。
                你可以在收藏夹练习，也可以在听写模式中听写已收藏的句子。
                当然，别忘记截取时间。
              </p>
            </div>
            <div className="guide-section">
              <h4 className="guide-section-title">4. 关于翻译功能与操作方式</h4>
              <p className="guide-section-text">
                目前翻译功能受限（资金有限），在确定需求之后一定会补齐这个功能。
                双击歌词行可以看到操作面板，可以编辑时间戳和歌词、删除歌词等。
              </p>
            </div>
          </div>
        )}
        {song?.lyrics.map((line, index) => {
          const clipStatus = getLineClipStatus(line);
          const isEditing = editingLineId === line.id;

          if (isEditing) {
            return (
              <motion.div
                key={line.id}
                className="lyric-item editing"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <div className="edit-form">
                  <textarea
                    className="edit-text"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={2}
                  />
                  <div className="edit-timestamps">
                    <div className="timestamp-input">
                      <label>起点</label>
                      <input
                        type="text"
                        value={editingStart}
                        onChange={(e) => setEditingStart(e.target.value)}
                        placeholder="0:00"
                      />
                    </div>
                    <div className="timestamp-input">
                      <label>终点</label>
                      <input
                        type="text"
                        value={editingEnd}
                        onChange={(e) => setEditingEnd(e.target.value)}
                        placeholder="0:00"
                      />
                    </div>
                  </div>
                  <div className="edit-timeline-inline">
                    <div
                      ref={timelineRef}
                      className="edit-timeline-editor"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="timeline-track" />
                      <div
                        className="timeline-range"
                        style={{ left: `${rangeLeft}%`, width: `${rangeWidth}%` }}
                        onMouseDown={handleRangeDragStart}
                      />
                      <div
                        className="timeline-handle start"
                        style={{ left: `${rangeLeft}%` }}
                        onMouseDown={handleStartDragStart}
                        title="拖动调整起点"
                      />
                      <div
                        className="timeline-handle end"
                        style={{ left: `${rangeLeft + rangeWidth}%` }}
                        onMouseDown={handleEndDragStart}
                        title="拖动调整终点"
                      />
                    </div>
                  </div>
                  <div className="edit-actions">
                    <button className="btn-text active" onClick={handleSaveEdit}>保存</button>
                    <button className="btn-text" onClick={handleCancelEdit}><X size={16} /></button>
                  </div>
                </div>
              </motion.div>
            );
          }

          const isSelected = selectedLine?.id === line.id;
          const isActive = activeLineId?.split(',').includes(line.id);
          const isFav = isLineFavorited(line.id);
          const isThisStandalonePlaying = playingClipLineId === line.id && isStandalonePlay;
          return (
            <Fragment key={line.id}>
              <motion.div
                className={`lyric-item ${isSelected ? "selected" : ""} ${clipStatus} ${isSelectMode ? "selectable" : ""} ${selectedLines.has(line.id) ? "selected-line" : ""} ${isActive ? "active" : ""}`}
                onClick={(e) => { e.stopPropagation(); handleCancelEdit(); isSelectMode ? toggleLineSelection(line.id) : handleLineClick(line); }}
                onDoubleClick={() => { handleCancelEdit(); handleLineDoubleClick(line); }}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                {isSelectMode ? (
                  <span
                    className={`select-checkbox ${selectedLines.has(line.id) ? "checked" : ""}`}
                    onClick={(e) => { e.stopPropagation(); toggleLineSelection(line.id); }}
                  >
                    {selectedLines.has(line.id) ? "✓" : ""}
                  </span>
                ) : (
                  <>
                    <button
                      className="favorite-btn"
                      onClick={(e) => { e.stopPropagation(); toggleLineFavorite(line); }}
                      aria-label={isFav ? "取消收藏" : "加入收藏"}
                    >
                      {isFav ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#111" stroke="none">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                      )}
                    </button>
                    <button
                      className={`clip-btn ${clippingLineId === line.id ? "clipping" : ""}`}
                      onClick={(e) => { e.stopPropagation(); handleClipButtonClick(line); }}
                      aria-label={clippingLineId === line.id ? "完成截取" : "截取这句"}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 6 L18 18 M18 6 L6 18" />
                        <circle cx="6" cy="6" r="2" />
                        <circle cx="6" cy="18" r="2" />
                      </svg>
                    </button>
                  </>
                )}
                <span className="line-text">{line.text}</span>
                {line.annotation && <span className="has-note">📝</span>}
                {clipStatus === "clipped" && (
                  <span className="clip-badge clipped">
                    {formatMs(line.clipStart!)}-{formatMs(line.clipEnd!)}
                  </span>
                )}
                {clipStatus === "clipping" && (
                  <span className="clip-badge clipping">
                    <span className="clipping-text">
                      <Circle size={8} fill="var(--warning)" /> 截取中...
                    </span>
                    <button
                      className="clipping-complete-btn"
                      onClick={(e) => { e.stopPropagation(); finishClipping(); }}
                    >
                      ✓ 完成
                    </button>
                  </span>
                )}
              </motion.div>
              {line.translation && (() => {
                const isEditingTranslation = editingTranslationLineId === line.id;
                const isTranslationHidden = !!line.translationHidden;
                return (
                  <div className={`translation-row ${isEditingTranslation ? "editing" : ""} ${isTranslationHidden ? "hidden" : ""}`}>
                    {isEditingTranslation ? (
                      <div className="translation-edit">
                        <textarea
                          className="translation-edit-textarea"
                          value={editingTranslationText}
                          onChange={(e) => setEditingTranslationText(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onFocus={(e) => e.stopPropagation()}
                          rows={2}
                          autoFocus
                        />
                        <div className="translation-edit-actions" onClick={(e) => e.stopPropagation()}>
                          <button className="btn-text active" onClick={() => handleSaveTranslationEdit(line)}>保存</button>
                          <button className="btn-text" onClick={handleCancelTranslationEdit}>取消</button>
                        </div>
                      </div>
                    ) : isTranslationHidden ? (
                      <div
                        className="translation-mask"
                        onClick={(e) => e.stopPropagation()}
                      >
                        翻译已隐藏
                      </div>
                    ) : (
                      <span className="line-text">{line.translation}</span>
                    )}
                    {!isEditingTranslation && (
                      <div className="translation-row-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="translation-row-btn"
                          onClick={() => handleToggleTranslationHidden(line)}
                          aria-label={isTranslationHidden ? "显示翻译" : "隐藏翻译"}
                        >
                          {isTranslationHidden ? "查看" : "隐藏"}
                        </button>
                        <button
                          className="translation-row-btn"
                          onClick={() => handleStartEditTranslation(line)}
                          aria-label="编辑翻译"
                        >
                          编辑
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
              {isThisStandalonePlaying && (
                <div className="inline-progress" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-progress-row">
                    <button
                      className="transparent-play-btn"
                      onClick={toggleStandalonePlay}
                      aria-label={state.isPlaying ? "暂停" : "播放"}
                    >
                      {state.isPlaying ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                          <line x1="7" y1="5" x2="7" y2="19" />
                          <line x1="17" y1="5" x2="17" y2="19" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="6,4 20,12 6,20" />
                        </svg>
                      )}
                    </button>
                    <span className="time-current">{formatMs(Math.max(0, (state.currentTime - (line.clipStart || 0) / 1000) * 1000))}</span>
                    <input
                      type="range"
                      min={0}
                      max={(line.clipEnd ?? (line.clipStart || 0) + 5000) - (line.clipStart || 0)}
                      value={Math.max(0, (state.currentTime - (line.clipStart || 0) / 1000) * 1000)}
                      onChange={(e) => {
                        e.stopPropagation();
                        if (line.clipStart !== undefined) {
                          seek(line.clipStart / 1000 + Number(e.target.value) / 1000);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="time-total">{formatMs((line.clipEnd ?? (line.clipStart || 0) + 5000) - (line.clipStart || 0))}</span>
                  </div>
                  <div className="inline-loop-control" onClick={(e) => e.stopPropagation()}>
                    <span>循环</span>
                    <div className="loop-buttons-inline">
                      {[0, 1, 3, 5, 10].map((n) => (
                        <button
                          key={n}
                          className={standaloneLoopCount === n ? "active" : ""}
                          onClick={(e) => { e.stopPropagation(); setStandaloneLoopCount(n); }}
                        >
                          {n === 0 ? "∞" : n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      <AnimatePresence>
        {showSettings && (
          <motion.div
            className="action-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              className="action-sheet"
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="action-line">⚙️ 设置</div>
              <div className="settings-item">
                <span>进度调整幅度</span>
                <select
                  value={seekDuration}
                  onChange={(e) => setSeekDuration(Number(e.target.value))}
                >
                  <option value={1}>1 秒</option>
                  <option value={2}>2 秒</option>
                  <option value={3}>3 秒</option>
                  <option value={5}>5 秒</option>
                </select>
              </div>
              <button className="btn-text" onClick={() => setShowSettings(false)}>
                关闭
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showActions && selectedLine && (
          <motion.div
            className="action-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowActions(false)}
          >
            <motion.div
              className="action-sheet"
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="action-line">{selectedLine.text}</div>
              {clippingLineId && clippingLineId !== selectedLine.id ? (
                // 有其他行正在截取，取消那个截取并开始新的截取
                <button className="btn-text" onClick={handleCancelClipThenStart}>
                  替换截取（取消之前的）
                </button>
              ) : clippingLineId === selectedLine.id ? (
                <>
                  <button className="btn-text" onClick={handleCancelClip}>
                    放弃截取
                  </button>
                  {isLineFavorited(selectedLine.id) ? (
                    <button className="btn-text" onClick={handleUnfavorite}>
                      取消收藏
                    </button>
                  ) : (
                    <button className="btn-text" onClick={handleFavorite}>
                      加入收藏
                    </button>
                  )}
                  <button className="btn-text" onClick={handleDeleteLine}>
                    删除此句
                  </button>
                  {!selectedLine.translation && (
                    <button className="btn-text" onClick={handleTranslate}>
                      翻译
                    </button>
                  )}
                </>
              ) : selectedLine.clipStart !== undefined ? (
                <>
                  {playingClipLineId !== selectedLine.id && !isStandalonePlay && (
                    <button className="btn-text" onClick={handlePlayLineStandalone}>
                      单独播放
                    </button>
                  )}
                  {isLineFavorited(selectedLine.id) ? (
                    <>
                      <button className="btn-text" onClick={handleEnterPractice}>
                        进入练习模式
                      </button>
                      <button className="btn-text" onClick={handleUnfavorite}>
                        取消收藏
                      </button>
                    </>
                  ) : (
                    <button className="btn-text" onClick={handleFavorite}>
                      加入收藏
                    </button>
                  )}
                  <button className="btn-text" onClick={handleDeleteLine}>
                    删除此句
                  </button>
                  <button className="btn-text" onClick={() => {
                    setEditingLineId(selectedLine.id);
                    setEditingText(selectedLine.text);
                    setEditingStart(selectedLine.clipStart !== undefined ? formatMs(selectedLine.clipStart) : "");
                    setEditingEnd(selectedLine.clipEnd !== undefined ? formatMs(selectedLine.clipEnd) : "");
                    setShowActions(false);
                  }}>
                    编辑歌词与时间戳
                  </button>
                  {!selectedLine.translation && (
                    <button className="btn-text" onClick={handleTranslate}>
                      翻译
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button className="btn-text" onClick={handlePlayLine}>
                    设置起点
                  </button>
                  {isLineFavorited(selectedLine.id) ? (
                    <>
                      <button className="btn-text" onClick={handleEnterPractice}>
                        进入练习模式
                      </button>
                      <button className="btn-text" onClick={handleUnfavorite}>
                        取消收藏
                      </button>
                    </>
                  ) : (
                    <button className="btn-text" onClick={handleFavorite}>
                      加入收藏
                    </button>
                  )}
                  <button className="btn-text" onClick={handleDeleteLine}>
                    删除此句
                  </button>
                  <button className="btn-text" onClick={() => {
                    setEditingLineId(selectedLine.id);
                    setEditingText(selectedLine.text);
                    setEditingStart(selectedLine.clipStart !== undefined ? formatMs(selectedLine.clipStart) : "");
                    setEditingEnd(selectedLine.clipEnd !== undefined ? formatMs(selectedLine.clipEnd) : "");
                    setShowActions(false);
                  }}>
                    编辑歌词与时间戳
                  </button>
                  {!selectedLine.translation && (
                    <button className="btn-text" onClick={handleTranslate}>
                      翻译
                    </button>
                  )}
                </>
              )}
              <button className="btn-text" onClick={() => setShowActions(false)}>
                取消
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {folderPickerOpen && (
          <FolderPickerModal
            scope="favorites"
            selectedFolderId={undefined}
            onClose={() => {
              setFolderPickerOpen(false);
              setLinePendingFavorite(null);
            }}
            onConfirm={(folderId) => {
              setFolderPickerOpen(false);
              performFavorite(folderId);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}