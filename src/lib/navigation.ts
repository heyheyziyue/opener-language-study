// 记录从哪个歌词页进入练习页
export function setPracticeSourceSongId(songId: string) {
  sessionStorage.setItem("practiceSourceSongId", songId);
}

export function getPracticeSourceSongId(): string | null {
  return sessionStorage.getItem("practiceSourceSongId");
}