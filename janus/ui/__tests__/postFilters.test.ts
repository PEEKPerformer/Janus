import { filterPosts, isFiltered } from "../postFilters";
import type { Post } from "../../core/model";
import type { JanusId } from "../../core/ids";

function post(opts: {
  id: string;
  title?: string;
  body?: string;
  community?: string;
  author?: string;
  nsfw?: boolean;
}): Post {
  return {
    id: opts.id,
    title: opts.title ?? opts.id,
    body: { text: opts.body },
    community: { id: (opts.community ?? "c1") as JanusId },
    author: { id: (opts.author ?? "u1") as JanusId },
    isNSFW: opts.nsfw ?? false,
  } as unknown as Post;
}

const NO_FILTERS = {
  filters: { keywords: [], mutedCommunities: [], mutedUsers: [] },
  hideNsfw: false,
};

describe("isFiltered", () => {
  it("keeps everything when no filters are set", () => {
    expect(isFiltered(post({ id: "p" }), NO_FILTERS)).toBe(false);
  });

  it("matches keywords case-insensitively in title and body", () => {
    const opts = {
      ...NO_FILTERS,
      filters: { ...NO_FILTERS.filters, keywords: ["Spoiler"] },
    };
    expect(
      isFiltered(post({ id: "p", title: "Big SPOILER ahead" }), opts),
    ).toBe(true);
    expect(
      isFiltered(
        post({ id: "p", title: "clean", body: "a spoiler here" }),
        opts,
      ),
    ).toBe(true);
    expect(isFiltered(post({ id: "p", title: "clean" }), opts)).toBe(false);
  });

  it("hides muted communities and users", () => {
    const opts = {
      ...NO_FILTERS,
      filters: {
        keywords: [],
        mutedCommunities: ["badcomm" as JanusId],
        mutedUsers: ["baduser" as JanusId],
      },
    };
    expect(isFiltered(post({ id: "p", community: "badcomm" }), opts)).toBe(
      true,
    );
    expect(isFiltered(post({ id: "p", author: "baduser" }), opts)).toBe(true);
    expect(isFiltered(post({ id: "p", community: "okc" }), opts)).toBe(false);
  });

  it("hides NSFW only when hideNsfw is on", () => {
    const nsfw = post({ id: "p", nsfw: true });
    expect(isFiltered(nsfw, NO_FILTERS)).toBe(false);
    expect(isFiltered(nsfw, { ...NO_FILTERS, hideNsfw: true })).toBe(true);
  });

  it("ignores blank/whitespace keywords", () => {
    const opts = {
      ...NO_FILTERS,
      filters: { ...NO_FILTERS.filters, keywords: ["  ", ""] },
    };
    expect(isFiltered(post({ id: "p", title: "anything" }), opts)).toBe(false);
  });
});

describe("filterPosts", () => {
  it("drops filtered posts and preserves order", () => {
    const posts = [
      post({ id: "a", title: "keep" }),
      post({ id: "b", title: "buy crypto now" }),
      post({ id: "c", title: "also keep" }),
    ];
    const result = filterPosts(posts, {
      ...NO_FILTERS,
      filters: { ...NO_FILTERS.filters, keywords: ["crypto"] },
    });
    expect(result.map((p) => p.id)).toEqual(["a", "c"]);
  });
});
