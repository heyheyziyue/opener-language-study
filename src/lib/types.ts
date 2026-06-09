export interface Song {
  id: string;
  name: string;
  audioBlob?: Blob;
  lyrics: LyricLine[];
  createdAt: string;
  folderId?: string;   // 所属文件夹 ID;undefined = "未分类"
  order?: number;      // 文件夹内手动排序序号;undefined = 用 createdAt 排序
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
  translationHidden?: boolean; // 翻译是否被用户隐藏（仅 UI 展示控制，不删除数据）
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
  folderId?: string;  // 所属文件夹 ID;undefined = "未分类"
  order?: number;     // 文件夹内手动排序序号;undefined = 用 createdAt 排序
}

export type FolderScope = "songs" | "favorites";

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  scope: FolderScope;   // 区分"歌曲夹"(LibraryPage) vs "收藏夹"(FavoritesPage)
}

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: string;
}