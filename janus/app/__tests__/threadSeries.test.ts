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

  it("matches across a drifting trailing qualifier (nba Finals→Playoffs), the one real false negative", () => {
    const finals = "Daily Discussion Thread + Game Thread Index | Finals";
    const playoffs = "Daily Discussion Thread + Game Thread Index | Playoffs";
    // Followed during one phase, still matches the next phase's edition.
    expect(titleMatchesSeries(playoffs, seriesKeyForTitle(finals))).toBe(true);
    expect(titleMatchesSeries(finals, seriesKeyForTitle(playoffs))).toBe(true);
  });

  it("the stem floor still keeps distinct series apart (no false positives)", () => {
    // Real harvested titles from a variety of subs — none of these should match
    // each other's series, despite some shared words.
    const distinct = [
      "Question Thread - June 09, 2026", // r/churning
      "News and Updates Thread - June 09, 2026", // r/churning
      "Bank Bonus Weekly Thread - Week of June 09, 2026", // r/churning
      "Daily Discussion Thread for June 9, 2026", // r/wallstreetbets
      "Weekend Discussion Thread for the Weekend of June 05, 2026", // r/wallstreetbets
      "Game Thread: San Antonio Spurs vs New York Knicks", // r/nba
      "Match Thread: Saudi Arabia vs Senegal", // r/soccer
      "Match Thread: Hungary vs Kazakhstan", // r/soccer
      "2026 Monaco Grand Prix - Race Discussion", // r/formula1
      "2026 Monaco Grand Prix - Post-Race Discussion", // r/formula1
    ];
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        expect(titleMatchesSeries(distinct[j], seriesKeyForTitle(distinct[i]))).toBe(
          false,
        );
      }
    }
  });

  it("different matchups/events never collapse (the critical false-positive guard)", () => {
    const k = seriesKeyForTitle("Game Thread: San Antonio Spurs vs New York Knicks");
    expect(
      titleMatchesSeries("Game Thread: Boston Celtics vs Miami Heat", k),
    ).toBe(false);
    const f1 = seriesKeyForTitle("2026 Monaco Grand Prix - Race Discussion");
    expect(
      titleMatchesSeries("2026 Spanish Grand Prix - Race Discussion", f1),
    ).toBe(false);
  });

  it("handles r/churning's real recurring threads (live fixtures, 2026-06-09)", () => {
    // Dailies collapse across days…
    expect(seriesKeyForTitle("Question Thread - June 09, 2026")).toBe(
      seriesKeyForTitle("Question Thread - June 06, 2026"),
    );
    expect(seriesKeyForTitle("News and Updates Thread - June 09, 2026")).toBe(
      seriesKeyForTitle("News and Updates Thread - June 07, 2026"),
    );
    // …weeklies collapse across weeks…
    expect(
      seriesKeyForTitle("Bank Bonus Weekly Thread - Week of June 09, 2026"),
    ).toBe(seriesKeyForTitle("Bank Bonus Weekly Thread - Week of May 26, 2026"));
    expect(
      seriesKeyForTitle(
        "Trip Report and Churning Success Story Weekly Thread - Week of June 07, 2026",
      ),
    ).toBe(
      seriesKeyForTitle(
        "Trip Report and Churning Success Story Weekly Thread - Week of June 14, 2026",
      ),
    );
    // …and the sub's distinct series stay distinct from each other.
    const keys = [
      "Question Thread - June 09, 2026",
      "News and Updates Thread - June 09, 2026",
      "Bank Bonus Weekly Thread - Week of June 09, 2026",
      "Weekly Off Topic Thread - Week of June 08, 2026",
      "Manufactured Spending Weekly Thread - Week of June 06, 2026",
      "Trip Report and Churning Success Story Weekly Thread - Week of June 07, 2026",
    ].map(seriesKeyForTitle);
    expect(new Set(keys).size).toBe(keys.length);
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
