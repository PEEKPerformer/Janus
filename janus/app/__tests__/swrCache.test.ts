import { createSwrCache } from "../swrCache";

const NOW = 1_000_000_000_000;
const HOUR = 60 * 60 * 1000;

describe("swrCache", () => {
  const cache = createSwrCache("janus.test.v1");

  it("round-trips a value with freshness within TTL", () => {
    cache.write("subs:alice", [{ id: "a" }, { id: "b" }], NOW);
    const got = cache.read<{ id: string }[]>("subs:alice", NOW + 1000, HOUR);
    expect(got?.value.map((c) => c.id)).toEqual(["a", "b"]);
    expect(got?.fresh).toBe(true);
  });

  it("reports stale past the TTL but still returns the value", () => {
    cache.write("subs:bob", ["x"], NOW);
    const got = cache.read<string[]>("subs:bob", NOW + 3 * HOUR, HOUR);
    expect(got?.value).toEqual(["x"]);
    expect(got?.fresh).toBe(false);
    expect(got?.ageMs).toBe(3 * HOUR);
  });

  it("misses cleanly for unknown keys", () => {
    expect(cache.read("nope", NOW, HOUR)).toBeNull();
  });

  it("removes an entry", () => {
    cache.write("temp", 1, NOW);
    cache.remove("temp");
    expect(cache.read("temp", NOW, HOUR)).toBeNull();
  });
});
