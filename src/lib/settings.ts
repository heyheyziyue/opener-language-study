import { useEffect, useState } from "react";

const STORAGE_KEY = "opener-seek-duration";
const DEFAULT_SEEK_DURATION = 2;
const EVENT_NAME = "opener-seek-duration-change";

export function getSeekDuration(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SEEK_DURATION;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SEEK_DURATION;
  } catch {
    return DEFAULT_SEEK_DURATION;
  }
}

export function setSeekDuration(value: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
    window.dispatchEvent(new CustomEvent<number>(EVENT_NAME, { detail: value }));
  } catch {
    /* ignore */
  }
}

/**
 * React hook that reads and writes the global seek-duration setting.
 * All components using this hook stay in sync via a CustomEvent.
 */
export function useSeekDuration(): [number, (value: number) => void] {
  const [value, setValue] = useState<number>(() => getSeekDuration());

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<number>;
      if (typeof ce.detail === "number") {
        setValue(ce.detail);
      } else {
        setValue(getSeekDuration());
      }
    };
    window.addEventListener(EVENT_NAME, handler);
    // 跨 tab 同步
    const storageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setValue(getSeekDuration());
    };
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);

  return [value, setSeekDuration];
}
