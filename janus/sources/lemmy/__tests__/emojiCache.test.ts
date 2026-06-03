import { readEmojiCache, writeEmojiCache } from "../emojiCache";
import type { CustomEmoji } from "../../../core/model";

const emoji = (shortcode: string): CustomEmoji => ({
  shortcode,
  url: `https://hexbear.net/e/${shortcode}.png`,
  keywords: [],
  markdown: `![${shortcode}](url "emoji ${shortcode}")`,
});

describe("emojiCache", () => {
  const NOW = 1_000_000_000_000;

  it("round-trips emojis for an instance", () => {
    writeEmojiCache("hexbear.net", [emoji("a"), emoji("b")], NOW);
    const got = readEmojiCache("hexbear.net", NOW + 1000);
    expect(got?.map((e) => e.shortcode)).toEqual(["a", "b"]);
  });

  it("is keyed by instance (case-insensitive)", () => {
    writeEmojiCache("Lemmy.ML", [emoji("z")], NOW);
    expect(readEmojiCache("lemmy.ml", NOW)?.[0].shortcode).toBe("z");
    expect(readEmojiCache("other.instance", NOW)).toBeNull();
  });

  it("expires entries older than the TTL", () => {
    writeEmojiCache("stale.net", [emoji("x")], NOW);
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    expect(readEmojiCache("stale.net", NOW + eightDays)).toBeNull();
  });
});
