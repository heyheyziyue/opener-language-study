interface PlayPauseIconProps {
  isPlaying: boolean;
  size?: number;
  strokeWidth?: number;
}

export default function PlayPauseIcon({
  isPlaying,
  size = 22,
  strokeWidth = 2.8,
}: PlayPauseIconProps) {
  if (isPlaying) {
    // 暂停:两条竖线
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      >
        <line x1="7" y1="5" x2="7" y2="19" />
        <line x1="17" y1="5" x2="17" y2="19" />
      </svg>
    );
  }
  // 播放:三角形
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="6,4 20,12 6,20" />
    </svg>
  );
}
