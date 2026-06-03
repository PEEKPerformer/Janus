/**
 * Data-derived "most used" emoji shortcodes per instance, surfaced as the
 * Popular tab of the emoji picker. Rankings were produced by sampling recent
 * comments on each instance (see scripts/sample-emoji notes); they're a
 * best-effort head, not exhaustive — the picker falls back to alphabetical
 * within a category for everything else.
 */
const POPULAR_BY_INSTANCE: Record<string, string[]> = {
  // hexbear.net — filled from a live crawl of recent threads.
  "hexbear.net": [],
};

export function popularEmojiFor(instance: string): string[] {
  return POPULAR_BY_INSTANCE[instance.toLowerCase()] ?? [];
}
