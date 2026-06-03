import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { saveSong, generateId, createLyricLine } from "../lib/storage";
import type { Song } from "../lib/types";
import "./UploadPage.css";

export default function UploadPage() {
  const navigate = useNavigate();
  const [songName, setSongName] = useState("");
  const [lyricsText, setLyricsText] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioFile(file);
      if (!songName) {
        setSongName(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const handleSubmit = async () => {
    if (!songName.trim() || !lyricsText.trim()) return;

    setIsUploading(true);

    const lines = lyricsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((text) => createLyricLine(text));

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

          <div className="form-group">
            <label>歌词 / Lyrics</label>
            <textarea
              value={lyricsText}
              onChange={(e) => setLyricsText(e.target.value)}
              placeholder="粘贴歌词，一句一行..."
              rows={8}
            />
          </div>

          <button
            className="start-btn btn-text active"
            onClick={handleSubmit}
            disabled={!songName.trim() || !lyricsText.trim() || isUploading}
          >
            {isUploading ? "处理中..." : "上传"}
          </button>
        </motion.div>
      </main>
    </div>
  );
}