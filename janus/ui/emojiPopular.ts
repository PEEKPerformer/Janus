/**
 * Data-derived "most used" emoji shortcodes per instance, surfaced as the
 * Popular tab of the emoji picker. Rankings come from sampling recent comments
 * on each instance — a best-effort head, not exhaustive; the picker falls back
 * to alphabetical-within-category for everything else.
 *
 * hexbear.net: ranked from a crawl of the 33 most-active threads (4,639
 * comments, 1,030 emoji occurrences, 491 distinct) on 2026-06-03, kept where
 * count >= 2. Refresh periodically.
 */
const POPULAR_BY_INSTANCE: Record<string, string[]> = {
  "hexbear.net": [
    "crush", "screm", "lea-think", "comfy", "hyperflush", "bridget-vibe",
    "lets-fucking-go", "cat-trans", "transshork-happy", "meow-melt",
    "madeline-sadeline", "thonk", "aubrey-happy", "aubrey-pain", "lea-breakdown",
    "trans-sad", "agony-shivering", "kitty-birthday-sad", "thonk-trans",
    "bridget-pride", "reddit-logo", "lea-sad", "sicko-fem", "lea-happy",
    "madeline-bruh", "hexbear-pan", "meow-tableflip", "michael-laugh",
    "trans-heart", "meow-hug", "sicko-wistful", "us-foreign-policy", "blob-sleep",
    "vivian-shrug", "omori-afraid", "aubrey-cry-1", "ohnoes", "kitty-cri",
    "leslie-shining", "aubrey-cry-2", "makima-think", "lea-blush", "yes-honey-left",
    "sadness", "germany-cool", "data-laughing", "lea-pout", "aubrey-rage-cry",
    "ooooooooooooooh", "angery", "doomer", "waow-based", "sad-boi", "lea-tired",
    "niko-concern", "hexbear-non-binary", "negative", "meow-coffee",
    "blob-no-thoughts", "sicko-lea", "comfy-cool", "soypoint-2", "theory-gary",
    "undyne-joy", "i-cant", "butt", "niko-wonderous", "hexbear-pride",
    "im-doing-my-part", "cereal2", "tails-what", "yea", "soypoint-1",
    "anti-cracker-aktion", "amerikkka", "thurston", "bocchi-cry", "bocchi-glitch",
    "kiryu-pain", "madeline-scared",
  ],
};

export function popularEmojiFor(instance: string): string[] {
  return POPULAR_BY_INSTANCE[instance.toLowerCase()] ?? [];
}
