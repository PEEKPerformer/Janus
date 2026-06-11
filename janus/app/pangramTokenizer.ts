/**
 * Byte-level BPE tokenizer (GPT-2/RoBERTa flavor) in plain TypeScript.
 *
 * Open Pangram rides on roberta-large, whose tokenizer is exactly GPT-2's:
 * pre-tokenize with the GPT-2 regex, map raw bytes through the printable
 * byte<->unicode table, then merge by rank from merges.txt and look ids up
 * in vocab.json. ~120 lines is cheaper than dragging a native tokenizer
 * library into the build, and it runs in Jest, so encoding is fully tested.
 *
 * The model's context is 512 positions; RoBERTa reserves <s> and </s>, so
 * text is windowed into chunks of up to 510 content tokens.
 */

export interface PangramTokenizer {
  /** Encode to ids, unbounded length, no specials. */
  encode(text: string): number[];
  /** Split into model-ready windows: each `<s> …≤510 ids… </s>`. */
  encodeWindows(text: string, maxLen?: number): number[][];
  bosId: number;
  eosId: number;
  padId: number;
}

export const PANGRAM_CONTEXT = 512;

// GPT-2 pre-tokenization pattern (contractions, words, numbers, punctuation,
// trailing/other whitespace), unicode-aware.
const PRETOKEN =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

/** GPT-2's bijective byte -> printable-unicode map. */
function byteToUnicode(): string[] {
  const bs: number[] = [];
  for (let b = 0x21; b <= 0x7e; b++) bs.push(b);
  for (let b = 0xa1; b <= 0xac; b++) bs.push(b);
  for (let b = 0xae; b <= 0xff; b++) bs.push(b);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const table = new Array<string>(256);
  bs.forEach((b, i) => (table[b] = String.fromCharCode(cs[i])));
  return table;
}

const BYTE_TO_UNI = byteToUnicode();

function toByteChars(piece: string): string[] {
  // UTF-8 encode, then map each byte through the table.
  const out: string[] = [];
  for (const ch of piece) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(BYTE_TO_UNI[cp]);
    else if (cp < 0x800) {
      out.push(BYTE_TO_UNI[0xc0 | (cp >> 6)], BYTE_TO_UNI[0x80 | (cp & 0x3f)]);
    } else if (cp < 0x10000) {
      out.push(
        BYTE_TO_UNI[0xe0 | (cp >> 12)],
        BYTE_TO_UNI[0x80 | ((cp >> 6) & 0x3f)],
        BYTE_TO_UNI[0x80 | (cp & 0x3f)],
      );
    } else {
      out.push(
        BYTE_TO_UNI[0xf0 | (cp >> 18)],
        BYTE_TO_UNI[0x80 | ((cp >> 12) & 0x3f)],
        BYTE_TO_UNI[0x80 | ((cp >> 6) & 0x3f)],
        BYTE_TO_UNI[0x80 | (cp & 0x3f)],
      );
    }
  }
  return out;
}

/**
 * Build a tokenizer from the repo's vocab.json text and merges.txt text.
 * Throws if the special tokens RoBERTa requires aren't in the vocab.
 */
export function createTokenizer(
  vocabJson: string,
  mergesTxt: string,
): PangramTokenizer {
  const vocab = JSON.parse(vocabJson) as Record<string, number>;
  const ranks = new Map<string, number>();
  mergesTxt.split("\n").forEach((line, i) => {
    if (!line || line.startsWith("#version")) return;
    ranks.set(line.trimEnd(), i);
  });
  for (const special of ["<s>", "</s>", "<pad>", "<unk>"])
    if (vocab[special] === undefined)
      throw new Error(`tokenizer vocab is missing ${special}`);
  const unkId = vocab["<unk>"];
  const cache = new Map<string, number[]>();

  const bpe = (piece: string): number[] => {
    const hit = cache.get(piece);
    if (hit) return hit;
    let parts = toByteChars(piece);
    while (parts.length > 1) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const rank = ranks.get(`${parts[i]} ${parts[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          best = i;
        }
      }
      if (best < 0) break;
      parts = [
        ...parts.slice(0, best),
        parts[best] + parts[best + 1],
        ...parts.slice(best + 2),
      ];
    }
    const ids = parts.map((p) => vocab[p] ?? unkId);
    if (cache.size < 20_000) cache.set(piece, ids);
    return ids;
  };

  const encode = (text: string): number[] => {
    const ids: number[] = [];
    for (const match of text.matchAll(PRETOKEN)) ids.push(...bpe(match[0]));
    return ids;
  };

  const bosId = vocab["<s>"];
  const eosId = vocab["</s>"];
  return {
    encode,
    encodeWindows(text, maxLen = PANGRAM_CONTEXT) {
      const body = maxLen - 2;
      const ids = encode(text);
      if (ids.length === 0) return [];
      const windows: number[][] = [];
      for (let i = 0; i < ids.length; i += body)
        windows.push([bosId, ...ids.slice(i, i + body), eosId]);
      return windows;
    },
    bosId,
    eosId,
    padId: vocab["<pad>"],
  };
}
