/**
 * Followed thread series — the megathread-sub feature. The series key
 * normalizer is the heart: every dated edition of the same recurring thread
 * must collapse to one stable key, on both networks' title conventions.
 */
import {
  seriesKeyForTitle,
  seriesLabelForTitle,
  titleMatchesSeries,
  initThreadSeries,
  isFollowedSeries,
  followSeries,
  unfollowSeries,
  seriesForCommunity,
  listAllSeries,
  flushThreadSeries,
  __resetThreadSeries,
} from "../threadSeries";

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

beforeEach(() => {
  mockStore.clear();
  __resetThreadSeries();
});

describe("seriesKeyForTitle", () => {
  it("collapses r/churning-style daily threads across dates", () => {
    const a = seriesKeyForTitle("Daily Question Thread - June 09, 2026");
    const b = seriesKeyForTitle("Daily Question Thread - December 1st, 2025");
    const c = seriesKeyForTitle("Daily Question Thread — Jan 3 2026");
    expect(a).toBe("daily question thread");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("collapses weekday-themed and slash-dated threads", () => {
    expect(seriesKeyForTitle("What Card Wednesday Week of 06/08/2026")).toBe(
      seriesKeyForTitle("What Card Wednesday Week of 12/15/2025"),
    );
    expect(seriesKeyForTitle("Trip Report Tuesday - June 09, 2026")).toBe(
      "trip report",
    );
  });

  it("keeps distinct series distinct", () => {
    expect(
      seriesKeyForTitle("Daily Question Thread - June 09, 2026"),
    ).not.toBe(seriesKeyForTitle("Daily Discussion Thread - June 09, 2026"));
  });

  it("matches via titleMatchesSeries", () => {
    const key = seriesKeyForTitle("Daily Question Thread - June 09, 2026");
    expect(
      titleMatchesSeries("Daily Question Thread - June 10, 2026", key),
    ).toBe(true);
    expect(titleMatchesSeries("Bank Bonus Weekly - June 10, 2026", key)).toBe(
      false,
    );
  });

  it("labels strip the date but keep the casing", () => {
    expect(seriesLabelForTitle("Daily Question Thread - June 09, 2026")).toBe(
      "Daily Question Thread",
    );
  });
});

describe("followed series store", () => {
  const post = {
    title: "Daily Question Thread - June 09, 2026",
    source: "reddit",
    community: { id: "reddit:www.reddit.com:community:churning", handle: "r/churning" },
  };
  const lemmyPost = {
    title: "Daily Chat Thread for June 9, 2026",
    source: "lemmy",
    community: { id: "lemmy:lemmy.world:community:casual", handle: "casual@lemmy.world" },
  };

  it("follows, matches a later edition, and unfollows — both networks", async () => {
    await initThreadSeries();
    expect(followSeries(post, 1000)).not.toBeNull();
    expect(followSeries(lemmyPost, 2000)).not.toBeNull();
    // A future edition of the same series counts as followed.
    expect(
      isFollowedSeries(post.community.id, "Daily Question Thread - July 01, 2026"),
    ).toBe(true);
    expect(
      isFollowedSeries(lemmyPost.community.id, "Daily Chat Thread for July 1, 2026"),
    ).toBe(true);
    expect(seriesForCommunity(post.community.id)).toHaveLength(1);
    expect(listAllSeries()).toHaveLength(2);
    unfollowSeries(post.community.id, post.title);
    expect(isFollowedSeries(post.community.id, post.title)).toBe(false);
  });

  it("persists across a reload", async () => {
    await initThreadSeries();
    followSeries(post, 1000);
    await flushThreadSeries();
    __resetThreadSeries();
    await initThreadSeries();
    expect(isFollowedSeries(post.community.id, post.title)).toBe(true);
    expect(seriesForCommunity(post.community.id)[0].label).toBe(
      "Daily Question Thread",
    );
  });
});
