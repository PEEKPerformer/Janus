import {
  normalizeContentUrl,
  contentKey,
  collapseCrossposts,
} from "../crosspostCollapse";
import type { Post, MediaItem } from "../../core/model";

function mkPost(over: {
  id: string;
  community: string;
  source?: "reddit" | "lemmy";
  link?: string;
  media?: MediaItem[];
  comments?: number;
}): Post {
  return {
    id: over.id,
    community: {
      id: over.community,
      name: over.community,
      handle: over.community,
    },
    source: over.source ?? "reddit",
    instance: over.source === "lemmy" ? "lemmy.world" : "www.reddit.com",
    commentCount: over.comments ?? 0,
    externalLink: over.link,
    media: over.media ?? [],
  } as unknown as Post;
}

const img = (url: string): MediaItem => ({
  kind: "image",
  url,
  isNSFW: false,
});

describe("normalizeContentUrl", () => {
  it("strips protocol, www, trailing slash", () => {
    expect(normalizeContentUrl("https://www.Example.com/a/b/")).toBe(
      "example.com/a/b",
    );
  });
  it("drops tracking params but keeps meaningful ones (sorted)", () => {
    expect(
      normalizeContentUrl("https://x.com/p?utm_source=reddit&v=5&id=2"),
    ).toBe("x.com/p?id=2&v=5");
  });
  it("drops the query entirely for media CDNs (signing tokens)", () => {
    expect(normalizeContentUrl("https://i.redd.it/abc.jpg?s=token")).toBe(
      "i.redd.it/abc.jpg",
    );
  });
});

describe("contentKey", () => {
  it("keys link posts and image posts, but not text posts", () => {
    expect(
      contentKey(
        mkPost({ id: "1", community: "news", link: "https://e.com/x" }),
      ),
    ).toBe("e.com/x");
    expect(
      contentKey(
        mkPost({
          id: "2",
          community: "pics",
          media: [img("https://i.redd.it/p.jpg")],
        }),
      ),
    ).toBe("i.redd.it/p.jpg");
    expect(contentKey(mkPost({ id: "3", community: "ask" }))).toBeNull();
  });
});

describe("collapseCrossposts", () => {
  it("folds the same link across communities + networks into companions", () => {
    const posts = [
      mkPost({
        id: "a",
        community: "news",
        link: "https://e.com/story",
        comments: 10,
      }),
      mkPost({
        id: "b",
        community: "worldnews",
        source: "lemmy",
        link: "https://e.com/story",
        comments: 40,
      }),
      mkPost({
        id: "c",
        community: "tech",
        link: "https://e.com/story",
        comments: 5,
      }),
      mkPost({ id: "d", community: "ask" }), // text — untouched
    ];
    const entries = collapseCrossposts(posts);
    expect(entries.map((e) => e.post.id)).toEqual(["a", "d"]);
    const lead = entries[0];
    // companions sorted most-discussed first
    expect(lead.companions.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("de-dupes exact same-community reposts without listing them as companions", () => {
    const posts = [
      mkPost({ id: "a", community: "news", link: "https://e.com/x" }),
      mkPost({ id: "a2", community: "news", link: "https://e.com/x" }),
    ];
    const entries = collapseCrossposts(posts);
    expect(entries).toHaveLength(1);
    expect(entries[0].companions).toHaveLength(0);
  });

  it("leaves unrelated posts as singletons", () => {
    const posts = [
      mkPost({ id: "a", community: "news", link: "https://e.com/1" }),
      mkPost({ id: "b", community: "news", link: "https://e.com/2" }),
    ];
    expect(collapseCrossposts(posts).map((e) => e.companions.length)).toEqual([
      0, 0,
    ]);
  });
});
