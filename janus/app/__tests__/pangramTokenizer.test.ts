import { createTokenizer } from "../pangramTokenizer";

/**
 * Tiny byte-level BPE vocab. In GPT-2's byte<->unicode table a space (0x20)
 * maps to "Ġ" (U+0120), so " hello" pre-tokenizes to "Ġhello" — the fixture
 * merges build "hello" from characters and leave "Ġ" standalone.
 */
const VOCAB = JSON.stringify({
  "<s>": 0,
  "<pad>": 1,
  "</s>": 2,
  "<unk>": 3,
  h: 4,
  e: 5,
  l: 6,
  o: 7,
  he: 8,
  ll: 9,
  hell: 10,
  hello: 11,
  Ġ: 12, // Ġ (space byte)
  Ġhello: 13,
});
const MERGES = [
  "#version: 0.2",
  "h e",
  "l l",
  "he ll",
  "hell o",
  "Ġ hello",
].join("\n");

describe("createTokenizer (byte-level BPE)", () => {
  const tok = createTokenizer(VOCAB, MERGES);

  it("merges by rank to whole words", () => {
    expect(tok.encode("hello")).toEqual([11]);
  });

  it("carries the leading-space byte into the token (Ġhello)", () => {
    expect(tok.encode("hello hello")).toEqual([11, 13]);
  });

  it("falls back to <unk> for unknown bytes", () => {
    expect(tok.encode("z")).toEqual([3]);
  });

  it("exposes RoBERTa specials from the vocab", () => {
    expect(tok.bosId).toBe(0);
    expect(tok.eosId).toBe(2);
    expect(tok.padId).toBe(1);
  });

  it("windows long text with <s>/</s> per window", () => {
    // maxLen 4 -> 2 content tokens per window.
    const windows = tok.encodeWindows("hello hello hello hello hello", 4);
    expect(windows).toHaveLength(3);
    expect(windows[0]).toEqual([0, 11, 13, 2]);
    expect(windows[1]).toEqual([0, 13, 13, 2]);
    expect(windows[2]).toEqual([0, 13, 2]);
  });

  it("returns no windows for empty text", () => {
    expect(tok.encodeWindows("")).toEqual([]);
  });

  it("requires the special tokens", () => {
    expect(() => createTokenizer(JSON.stringify({ a: 0 }), "")).toThrow(
      /missing <s>/,
    );
  });
});
