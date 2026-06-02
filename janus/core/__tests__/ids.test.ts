import { buildId, parseId, sourceOf, instanceOf, dedupKey } from "../ids";

describe("JanusId codec", () => {
  it("round-trips a Reddit post id", () => {
    const id = buildId({
      source: "reddit",
      instance: "www.reddit.com",
      kind: "post",
      nativeId: "t3_abc123",
    });
    expect(id).toBe("reddit:www.reddit.com:post:t3_abc123");
    expect(parseId(id)).toEqual({
      source: "reddit",
      instance: "www.reddit.com",
      kind: "post",
      nativeId: "t3_abc123",
    });
  });

  it("round-trips a Lemmy community id", () => {
    const id = buildId({
      source: "lemmy",
      instance: "lemmy.world",
      kind: "community",
      nativeId: "42",
    });
    expect(parseId(id)).toEqual({
      source: "lemmy",
      instance: "lemmy.world",
      kind: "community",
      nativeId: "42",
    });
  });

  it("preserves a nativeId that itself contains a colon", () => {
    const id = buildId({
      source: "lemmy",
      instance: "lemmy.ml",
      kind: "user",
      nativeId: "weird:id:with:colons",
    });
    expect(parseId(id).nativeId).toBe("weird:id:with:colons");
  });

  it("exposes source/instance accessors without a full parse at call sites", () => {
    const id = buildId({
      source: "reddit",
      instance: "www.reddit.com",
      kind: "user",
      nativeId: "alice",
    });
    expect(sourceOf(id)).toBe("reddit");
    expect(instanceOf(id)).toBe("www.reddit.com");
  });

  it("throws on a malformed id", () => {
    expect(() => parseId("not-an-id" as never)).toThrow(/Malformed JanusId/);
  });

  it("dedupKey is distinct from the canonical id (federation)", () => {
    // The same federated community fetched from two home instances has two
    // canonical ids but ONE dedupKey (its ap_id).
    const viaWorld = buildId({
      source: "lemmy",
      instance: "lemmy.world",
      kind: "community",
      nativeId: "100",
    });
    const viaMl = buildId({
      source: "lemmy",
      instance: "lemmy.ml",
      kind: "community",
      nativeId: "7",
    });
    const key = dedupKey("https://lemmy.ml/c/asklemmy");
    expect(viaWorld).not.toBe(viaMl);
    // Both would carry the same dedupKey on their entity (asserted in mapper tests).
    expect(key).toBe("https://lemmy.ml/c/asklemmy");
  });
});
