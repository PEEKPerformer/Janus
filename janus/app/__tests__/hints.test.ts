import {
  hasSeenHint,
  markHintSeen,
  isSeriesSuggestionDismissed,
  dismissSeriesSuggestion,
  suggestSeriesFromHistory,
} from "../hints";
import type { ThreadVisit } from "../threadVisits";

const visit = (
  nativeId: string,
  title: string,
  over: Partial<ThreadVisit> = {},
): ThreadVisit => ({
  id: `reddit:www.reddit.com:post:${nativeId}`,
  lastVisit: 1,
  commentCount: 10,
  visitedAt: 1,
  title,
  community: "r/churning",
  source: "reddit",
  communityId: "reddit:www.reddit.com:community:churning",
  ...over,
});

const notFollowed = { isFollowed: () => false };

describe("hint store", () => {
  it("one-time hints stick once marked", () => {
    expect(hasSeenHint("feed.longPress")).toBe(false);
    markHintSeen("feed.longPress");
    expect(hasSeenHint("feed.longPress")).toBe(true);
    expect(hasSeenHint("watch.bell")).toBe(false); // independent ids
  });

  it("series dismissals stick per community+series", () => {
    dismissSeriesSuggestion("c1", "daily question thread");
    expect(isSeriesSuggestionDismissed("c1", "daily question thread")).toBe(
      true,
    );
    expect(isSeriesSuggestionDismissed("c2", "daily question thread")).toBe(
      false,
    );
  });
});

describe("suggestSeriesFromHistory (teach from habits)", () => {
  it("two distinct editions of the same series → a suggestion", () => {
    const out = suggestSeriesFromHistory(
      [
        visit("a", "Daily Question Thread - June 09, 2026", { visitedAt: 1 }),
        visit("b", "Daily Question Thread - June 10, 2026", { visitedAt: 2 }),
      ],
      notFollowed,
    );
    expect(out).toHaveLength(1);
    expect(out[0].seriesKey).toBe("daily question thread");
    expect(out[0].editionsSeen).toBe(2);
    expect(out[0].sampleTitle).toBe("Daily Question Thread - June 10, 2026"); // newest
  });

  it("re-reading ONE edition twice is not a habit", () => {
    const out = suggestSeriesFromHistory(
      [
        visit("a", "Daily Question Thread - June 09, 2026"),
        visit("a", "Daily Question Thread - June 09, 2026"),
      ],
      notFollowed,
    );
    expect(out).toHaveLength(0);
  });

  it("already-followed and dismissed series stay quiet", () => {
    const history = [
      visit("a", "Daily Question Thread - June 09, 2026"),
      visit("b", "Daily Question Thread - June 10, 2026"),
    ];
    expect(
      suggestSeriesFromHistory(history, { isFollowed: () => true }),
    ).toHaveLength(0);
    dismissSeriesSuggestion(
      "reddit:www.reddit.com:community:churning",
      "daily question thread",
    );
    expect(suggestSeriesFromHistory(history, notFollowed)).toHaveLength(0);
  });

  it("pre-upgrade visits (no communityId) and one-token titles are skipped", () => {
    const out = suggestSeriesFromHistory(
      [
        visit("a", "Daily Question Thread - June 09", {
          communityId: undefined,
        }),
        visit("b", "Daily Question Thread - June 10", {
          communityId: undefined,
        }),
        visit("c", "Rant - June 09, 2026"),
        visit("d", "Rant - June 10, 2026"),
      ],
      notFollowed,
    );
    expect(out).toHaveLength(0); // "rant" is one token; others lack ids
  });

  it("sorts by habit strength (editions seen)", () => {
    const out = suggestSeriesFromHistory(
      [
        visit("a", "Weekly Trip Report - June 02, 2026"),
        visit("b", "Weekly Trip Report - June 09, 2026"),
        visit("c", "Daily Question Thread - June 08, 2026"),
        visit("d", "Daily Question Thread - June 09, 2026"),
        visit("e", "Daily Question Thread - June 10, 2026"),
      ],
      notFollowed,
    );
    expect(out.map((s) => s.seriesKey)).toEqual([
      "daily question thread",
      "weekly trip report",
    ]);
  });
});
