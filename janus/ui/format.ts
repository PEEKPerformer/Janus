/** Small pure formatters. `relativeTime` takes `now` for deterministic tests. */

export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  // Use the "m" unit once we'd otherwise round up to 1000k (e.g. 999,999 -> "1m").
  if (abs < 999_500) {
    const v = n / 1000;
    return `${v.toFixed(Math.abs(v) < 10 ? 1 : 0).replace(/\.0$/, "")}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export function relativeTime(timestampMs: number, now: number = Date.now()): string {
  if (!timestampMs) return "";
  const secs = Math.max(0, Math.floor((now - timestampMs) / 1000));
  if (secs < 45) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w`;
  // Never emit "0y": anything past the weeks range is at least a year.
  return `${Math.max(1, Math.floor(days / 365))}y`;
}
