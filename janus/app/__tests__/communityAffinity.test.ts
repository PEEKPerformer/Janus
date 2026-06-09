import {
  rankVisits,
  recordCommunityVisit,
  loadFavorites,
  pinCommunity,
  unpinCommunity,
  removeFavorite,
  hideFromFavorites,
  isPinned,
  type CommunityVisit,
  type VisitInput,
} from "../communityAffinity";

const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

const WEEK = 1000 * 60 * 60 * 24 * 7;

function visit(id: string, count: number, lastTs: number): CommunityVisit {
  return {
    id,
    source: "lemmy",
    instance: "lemmy.ml",
    name: id,
    handle: id,
    count,
    lastTs,
  };
}

beforeEach(() => mockStore.clear());

describe("rankVisits", () => {
  it("ranks by frequency when recency is equal", () => {
    const now = 1_000_000;
    const ranked = rankVisits(
      [visit("a", 2, now), visit("b", 5, now), visit("c", 1, now)],
      now,
    );
    expect(ranked.map((v) => v.id)).toEqual(["b", "a", "c"]);
  });

  it("decays stale communities below fresher ones", () => {
    const now = 10 * WEEK;
    // 'old' has more visits but is 3 half-lives stale; 'fresh' is recent.
    const old = visit("old", 6, now - 3 * WEEK); // 6 * 0.125 = 0.75
    const fresh = visit("fresh", 1, now); // 1 * 1 = 1
    const ranked = rankVisits([old, fresh], now);
    expect(ranked[0].id).toBe("fresh");
  });

  it("limits to the top N", () => {
    const now = 0;
    const many = Array.from({ length: 20 }, (_, i) => visit(`c${i}`, i, now));
    expect(rankVisits(many, now, 5)).toHaveLength(5);
  });
});

describe("recordCommunityVisit + loadFavorites", () => {
  it("accumulates counts across visits and surfaces the most-used", async () => {
    const t0 = 1_000_000;
    await recordCommunityVisit(
      {
        id: "x",
        source: "reddit",
        instance: "www.reddit.com",
        name: "privacy",
        handle: "r/privacy",
      },
      t0,
    );
    await recordCommunityVisit(
      {
        id: "x",
        source: "reddit",
        instance: "www.reddit.com",
        name: "privacy",
        handle: "r/privacy",
      },
      t0 + 1000,
    );
    await recordCommunityVisit(
      {
        id: "y",
        source: "lemmy",
        instance: "hexbear.net",
        name: "technology",
        handle: "technology",
      },
      t0 + 2000,
    );

    const favs = await loadFavorites(t0 + 3000);
    expect(favs[0].id).toBe("x"); // 2 visits beats 1
    expect(favs[0].count).toBe(2);
    expect(favs.map((f) => f.id).sort()).toEqual(["x", "y"]);
  });

  it("updates the snapshot (icon/name) on re-visit", async () => {
    await recordCommunityVisit(
      {
        id: "z",
        source: "lemmy",
        instance: "lemmy.ml",
        name: "old",
        handle: "old",
      },
      1,
    );
    await recordCommunityVisit(
      {
        id: "z",
        source: "lemmy",
        instance: "lemmy.ml",
        name: "new",
        handle: "new",
        icon: "http://i/x.png",
      },
      2,
    );
    const favs = await loadFavorites(3);
    expect(favs[0].name).toBe("new");
    expect(favs[0].icon).toBe("http://i/x.png");
    expect(favs[0].count).toBe(2);
  });
});

function input(id: string, source: "reddit" | "lemmy" = "lemmy"): VisitInput {
  return {
    id,
    source,
    instance: source === "reddit" ? "www.reddit.com" : "lemmy.ml",
    name: id,
    handle: id,
  };
}

describe("manual favorites (pin / remove)", () => {
  it("pins a community to the top, ahead of more-used auto picks", async () => {
    const now = 1_000_000;
    // 'busy' has real usage; 'pinned' has none but is manually pinned.
    await recordCommunityVisit(input("busy"), now);
    await recordCommunityVisit(input("busy"), now + 1);
    await pinCommunity(input("pinned", "reddit"), now + 2);

    const favs = await loadFavorites(now + 3);
    expect(favs[0].id).toBe("pinned");
    expect(favs[0].pinned).toBe(true);
    expect(favs.find((f) => f.id === "busy")?.pinned).toBe(false);
    expect(await isPinned("pinned")).toBe(true);
  });

  it("a pinned community appears even with zero visits", async () => {
    await pinCommunity(input("fresh"), 5);
    const favs = await loadFavorites(10);
    expect(favs.map((f) => f.id)).toContain("fresh");
  });

  it("does not duplicate a community that is both visited and pinned", async () => {
    const now = 2_000;
    await recordCommunityVisit(input("dup"), now);
    await pinCommunity(input("dup"), now + 1);
    const favs = await loadFavorites(now + 2);
    expect(favs.filter((f) => f.id === "dup")).toHaveLength(1);
    expect(favs.find((f) => f.id === "dup")?.pinned).toBe(true);
  });

  it("unpin drops the pin but keeps the auto entry if still used", async () => {
    const now = 3_000;
    await recordCommunityVisit(input("keep"), now);
    await pinCommunity(input("keep"), now + 1);
    await unpinCommunity("keep");
    const favs = await loadFavorites(now + 2);
    const entry = favs.find((f) => f.id === "keep");
    expect(entry).toBeDefined();
    expect(entry?.pinned).toBe(false);
    expect(await isPinned("keep")).toBe(false);
  });

  it("removeFavorite hides an auto pick from the list", async () => {
    const now = 4_000;
    await recordCommunityVisit(input("gone"), now);
    expect((await loadFavorites(now + 1)).map((f) => f.id)).toContain("gone");
    await removeFavorite("gone");
    expect((await loadFavorites(now + 2)).map((f) => f.id)).not.toContain(
      "gone",
    );
  });

  it("removeFavorite removes a pinned community too", async () => {
    await pinCommunity(input("byebye"), 1);
    await removeFavorite("byebye");
    const favs = await loadFavorites(2);
    expect(favs.map((f) => f.id)).not.toContain("byebye");
    expect(await isPinned("byebye")).toBe(false);
  });

  it("re-pinning a removed community brings it back (un-hides)", async () => {
    const now = 5_000;
    await recordCommunityVisit(input("back"), now);
    await hideFromFavorites("back");
    expect((await loadFavorites(now + 1)).map((f) => f.id)).not.toContain(
      "back",
    );
    await pinCommunity(input("back"), now + 2);
    const favs = await loadFavorites(now + 3);
    expect(favs.map((f) => f.id)).toContain("back");
    expect(favs.find((f) => f.id === "back")?.pinned).toBe(true);
  });
});
