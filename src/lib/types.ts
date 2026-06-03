export interface Song {
  id: string;
  name: string;
  audioBlob?: Blob;
  lyrics: LyricLine[];
  createdAt: string;
}

export interface LyricLine {
  id: string;
  text: string;
  timestamp?: number;      // 开始时间（毫秒）
  clipStart?: number;     // 截取片段开始时间（毫秒）
  clipEnd?: number;      // 截取片段结束时间（毫秒）
  annotation?: string;
  highlightColor?: string;
  translation?: string;   // 翻译文本
}

export interface FavoriteLine {
  id: string;
  songId: string;
  songName: string;
  line: LyricLine;
  practiceCount: number;
  speed: number;
  createdAt: string;
  note?: string;  // 用户批注
}

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: string;
}