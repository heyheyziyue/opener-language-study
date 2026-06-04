import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { saveSong, generateId, createLyricLine } from "../lib/storage";
import { parseLrc, buildClipSuggestions, type ParsedLrcLine } from "../lib/lrcParser";
import type { Song, LyricLine } from "../lib/types";
import "./UploadPage.css";

type LyricsMode = "text" | "lrc";

export default function UploadPage() {
  const navigate = useNavigate();
  const [songName, setSongName] = useState("");
  const [lyricsMode, setLyricsMode] = useState<LyricsMode>("text");
  const [lyricsText, setLyricsText] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lrcFileInputRef = useRef<HTMLInputElement>(null);

  // LRC 模式状态
  const [lrcRaw, setLrcRaw] = useState("");
  const [lrcParsed, setLrcParsed] = useState<ParsedLrcLine[]>([]);
  const [lrcMeta, setLrcMeta] = useState<{ title?: string; artist?: string }>({});
  const [lrcError, setLrcError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioFile(file);
      if (!songName) {
        setSongName(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const handleLrcFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setLrcRaw(text);
    applyLrcText(text);
    // 同填歌名（若 LRC 含 [ti:]）
  };

  const applyLrcText = (text: string) => {
    if (!text.trim()) {
      setLrcParsed([]);
      setLrcMeta({});
      setLrcError(null);
      return;
    }
    const parsed = parseLrc(text);
    if (parsed.lines.length === 0) {
      setLrcError("未识别到任何时间戳。请检查 LRC 格式（每行需形如 [mm:ss.xx]歌词）。");
      setLrcParsed([]);
      setLrcMeta({});
      return;
    }
    setLrcError(null);
    setLrcParsed(parsed.lines);
    setLrcMeta({ title: parsed.title, artist: parsed.artist });
    // 自动填歌名（优先级：LRC [ti:] > 已有值）
    if (parsed.title && !songName.trim()) {
      setSongName(parsed.title);
    }
  };

  const handleSubmit = async () => {
    if (!songName.trim()) return;

    setIsUploading(true);

    let lines: LyricLine[];

    if (lyricsMode === "lrc" && lrcParsed.length > 0) {
      // LRC 模式：自动带 timestamp + 自动 clip 推荐
      const suggestions = buildClipSuggestions(lrcParsed);
      lines = lrcParsed.map((p) => {
        const sug = suggestions.get(p.id);
        return {
          id: generateId(),
          text: p.text,
          timestamp: p.timestamp,
          clipStart: sug?.clipStart,
          clipEnd: sug?.clipEnd,
        };
      });
    } else if (lyricsText.trim()) {
      // 纯文本模式：保持原行为（每行一句，无时间戳）
      lines = lyricsText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((text) => createLyricLine(text));
    } else {
      setIsUploading(false);
      return;
    }

    const song: Song = {
      id: generateId(),
      name: songName.trim(),
      audioBlob: audioFile || undefined,
      lyrics: lines,
      createdAt: new Date().toISOString(),
    };

    await saveSong(song);
    setIsUploading(false);
    navigate(`/lyrics/${song.id}`);
  };

  const switchMode = (mode: LyricsMode) => {
    setLyricsMode(mode);
    setLrcError(null);
  };

  const lrcPreviewLines = lrcParsed.filter((l) => l.text).slice(0, 8);
  const lrcTotal = lrcParsed.filter((l) => l.text).length;

  const canSubmit =
    !!songName.trim() &&
    !isUploading &&
    ((lyricsMode === "text" && !!lyricsText.trim()) ||
      (lyricsMode === "lrc" && lrcParsed.length > 0));

  return (
    <div className="upload-page">
      <header className="header">
        <img src="/logo.png" alt="Opener" className="header-logo" />
        <button className="back-btn" onClick={() => navigate(-1)} aria-label="返回">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="11 18 5 12 11 6" />
          </svg>
        </button>
        <h1>上传歌曲</h1>
      </header>

      <main className="content">
        <motion.div
          className="upload-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div
            className={`drop-zone ${audioFile ? "has-file" : ""}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/m4a,audio/x-m4a"
              onChange={handleFileSelect}
              hidden
            />
            {audioFile ? (
              <div className="file-selected">
                <span>{audioFile.name}</span>
                <button
                  className="change-btn btn-text"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  更换
                </button>
              </div>
            ) : (
              <div className="drop-zone-content">
                <p>点击上传音频文件</p>
                <span>支持 mp3, wav, m4a 格式</span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>歌曲名称 / Song Name</label>
            <input
              type="text"
              value={songName}
              onChange={(e) => setSongName(e.target.value)}
              placeholder="输入歌曲名称..."
            />
          </div>

          {/* 歌词模式切换 */}
          <div className="lyrics-mode-tabs">
            <button
              className={`lyrics-mode-tab ${lyricsMode === "text" ? "active" : ""}`}
              onClick={() => switchMode("text")}
              type="button"
            >
              纯文本
            </button>
            <button
              className={`lyrics-mode-tab ${lyricsMode === "lrc" ? "active" : ""}`}
              onClick={() => switchMode("lrc")}
              type="button"
            >
              LRC 歌词（带时间戳）
            </button>
          </div>

          {lyricsMode === "text" ? (
            <div className="form-group">
              <label>歌词 / Lyrics</label>
              <textarea
                value={lyricsText}
                onChange={(e) => setLyricsText(e.target.value)}
                placeholder="粘贴歌词，一句一行..."
                rows={8}
              />
              <p className="form-hint">每行一句歌词。上传后可在歌词页用 ✂ 按钮手动添加时间戳。</p>
            </div>
          ) : (
            <div className="form-group">
              <label>歌词 / Lyrics</label>
              <div className="lrc-toolbar">
                <button
                  className="btn-text lrc-upload-btn"
                  type="button"
                  onClick={() => lrcFileInputRef.current?.click()}
                >
                  选择 .lrc 文件
                </button>
                <input
                  ref={lrcFileInputRef}
                  type="file"
                  accept=".lrc,text/plain"
                  onChange={handleLrcFileSelect}
                  hidden
                />
                <span className="lrc-hint">或粘贴 LRC 文本到下方</span>
              </div>
              <textarea
                value={lrcRaw}
                onChange={(e) => {
                  setLrcRaw(e.target.value);
                  applyLrcText(e.target.value);
                }}
                placeholder={`[00:01.23]第一句歌词\n[00:05.67]第二句歌词\n[00:10.00]第三句`}
                rows={6}
                className="lrc-textarea"
              />
              {lrcError && <p className="lrc-error">{lrcError}</p>}
              {lrcParsed.length > 0 && (
                <div className="lrc-preview">
                  <div className="lrc-preview-header">
                    <span>
                      ✓ 解析到 {lrcTotal} 句带时间戳的歌词
                      {lrcMeta.title && <span className="lrc-meta"> · 歌名: {lrcMeta.title}</span>}
                      {lrcMeta.artist && <span className="lrc-meta"> · 艺人: {lrcMeta.artist}</span>}
                    </span>
                    <span className="lrc-preview-tip">clip 范围将自动填入</span>
                  </div>
                  <ul className="lrc-preview-list">
                    {lrcPreviewLines.map((line) => (
                      <li key={line.id}>
                        <span className="lrc-ts">
                          {formatTimestamp(line.timestamp)}
                        </span>
                        <span className="lrc-text">{line.text}</span>
                      </li>
                    ))}
                    {lrcTotal > 8 && (
                      <li className="lrc-preview-more">… 还有 {lrcTotal - 8} 行</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          <button
            className="start-btn btn-text active"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isUploading ? "处理中..." : "上传"}
          </button>
        </motion.div>
      </main>
    </div>
  );
}

function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
