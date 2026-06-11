import {
  archiveAuthorContent,
  archiveThreadComments,
  type ArchiveFetch,
} from "../archiveClient";

const post = (id: string, t: number, extra: object = {}) => ({
  id,
  author: "alice",
  created_utc: t,
  subreddit: "churning",
  title: `post ${id}`,
  permalink: `/r/churning/comments/${id}/`,
  score: 5,
  ...extra,
});
const comment = (id: string, t: number, extra: object = {}) => ({
  id,
  author: "alice",
  created_utc: t,
  subreddit: "churning",
  body: `comment ${id}`,
  link_id: "t3_abc",
  ...extra,
});

const json = (data: unknown[]) => ({
  status: 200,
  json: async () => ({ data }),
});

describe("archiveAuthorContent", () => {
  it("normalizes Arctic Shift posts, newest-first, fullname from id", async () => {
    const fetchImpl: ArchiveFetch = async () =>
      json([post("aaa", 1000), post("bbb", 3000)]);
    const res = await archiveAuthorContent(
      "posts",
      "alice",
      { limit: 50 },
      fetchImpl,
    );
    expect(res.provider).toBe("arctic-shift");
    expect(res.items.map((i) => i.fullname)).toEqual(["t3_bbb", "t3_aaa"]);
    expect(res.items[0].createdAt).toBe(3_000_000); // seconds → ms
    expect(res.items[0].title).toBe("post bbb");
  });

  it("hits the comments endpoint for comments and carries link_id", async () => {
    let calledUrl = "";
    const fetchImpl: ArchiveFetch = async (url) => {
      calledUrl = url;
      return json([comment("c1", 2000)]);
    };
    const res = await archiveAuthorContent(
      "comments",
      "alice",
      { limit: 50 },
      fetchImpl,
    );
    expect(calledUrl).toContain("/comments/search");
    expect(calledUrl).toContain("author=alice");
    expect(res.items[0].fullname).toBe("t1_c1");
    expect(res.items[0].linkId).toBe("t3_abc");
  });

  it("returns a before-cursor only when the page is full", async () => {
    const items = Array.from({ length: 3 }, (_, i) => post(`p${i}`, 1000 + i));
    const full: ArchiveFetch = async () => json(items);
    expect(
      (await archiveAuthorContent("posts", "a", { limit: 3 }, full)).nextBefore,
    ).toBe(1_000_000); // oldest of the full page
    const short: ArchiveFetch = async () => json(items);
    expect(
      (await archiveAuthorContent("posts", "a", { limit: 10 }, short))
        .nextBefore,
    ).toBeUndefined();
  });

  it("passes before= as epoch SECONDS", async () => {
    let url = "";
    const fetchImpl: ArchiveFetch = async (u) => {
      url = u;
      return json([]);
    };
    await archiveAuthorContent(
      "posts",
      "alice",
      { limit: 50, before: 5_000_000 },
      fetchImpl,
    );
    // 5_000_000 ms → 5000 s; (PullPush fallback after empty primary also carries it)
    expect(url).toContain("before=5000");
  });

  it("falls back to PullPush when Arctic Shift errors", async () => {
    const fetchImpl: ArchiveFetch = async (url) => {
      if (url.includes("arctic-shift")) return { status: 500, json: async () => ({}) };
      return json([post("z", 9000)]);
    };
    const res = await archiveAuthorContent(
      "posts",
      "alice",
      { limit: 50 },
      fetchImpl,
    );
    expect(res.provider).toBe("pullpush");
    expect(res.items[0].fullname).toBe("t3_z");
  });

  it("falls back to PullPush when Arctic Shift is up but empty", async () => {
    const calls: string[] = [];
    const fetchImpl: ArchiveFetch = async (url) => {
      calls.push(url.includes("arctic-shift") ? "arctic" : "pull");
      if (url.includes("arctic-shift")) return json([]);
      return json([comment("c", 100)]);
    };
    const res = await archiveAuthorContent(
      "comments",
      "alice",
      { limit: 50 },
      fetchImpl,
    );
    expect(calls).toEqual(["arctic", "pull"]);
    expect(res.provider).toBe("pullpush");
  });

  it("returns an empty page (not a throw) when BOTH providers are empty", async () => {
    const fetchImpl: ArchiveFetch = async () => json([]);
    const res = await archiveAuthorContent(
      "posts",
      "ghost",
      { limit: 50 },
      fetchImpl,
    );
    expect(res.items).toEqual([]);
  });

  it("throws only when every provider errors", async () => {
    const fetchImpl: ArchiveFetch = async () => ({
      status: 503,
      json: async () => ({}),
    });
    await expect(
      archiveAuthorContent("posts", "alice", { limit: 50 }, fetchImpl),
    ).rejects.toThrow();
  });

  it("drops records missing author or timestamp", async () => {
    const fetchImpl: ArchiveFetch = async () =>
      json([
        post("ok", 1000),
        { id: "bad1", created_utc: 1000 }, // no author
        { id: "bad2", author: "x" }, // no time
      ]);
    const res = await archiveAuthorContent(
      "posts",
      "alice",
      { limit: 50 },
      fetchImpl,
    );
    expect(res.items.map((i) => i.id)).toEqual(["ok"]);
  });
});

describe("archiveThreadComments", () => {
  it("queries by link_id and strips the t3_ prefix for PullPush", async () => {
    const urls: string[] = [];
    const fetchImpl: ArchiveFetch = async (url) => {
      urls.push(url);
      if (url.includes("arctic-shift")) return { status: 502, json: async () => ({}) };
      return json([comment("c1", 1000)]);
    };
    const res = await archiveThreadComments("t3_abc", {}, fetchImpl);
    expect(urls[0]).toContain("link_id=t3_abc"); // arctic shift keeps prefix
    expect(urls[1]).toContain("link_id=abc"); // pullpush wants base36
    expect(res.items[0].fullname).toBe("t1_c1");
  });
});
