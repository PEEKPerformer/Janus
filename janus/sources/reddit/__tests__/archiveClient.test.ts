import {
  archiveAuthorContent,
  archiveCommentsByIds,
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
      if (url.includes("arctic-shift"))
        return { status: 500, json: async () => ({}) };
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

describe("archiveCommentsByIds", () => {
  it("looks comments up by base36 id (fullnames stripped), Arctic Shift first", async () => {
    let calledUrl = "";
    const fetchImpl: ArchiveFetch = async (url) => {
      calledUrl = url;
      return json([comment("c1", 1000)]);
    };
    const res = await archiveCommentsByIds(["t1_c1", "c2"], fetchImpl);
    expect(calledUrl).toContain("/api/comments/ids?ids=c1,c2"); // prefixes stripped
    expect(res.provider).toBe("arctic-shift");
    expect(res.items[0].fullname).toBe("t1_c1");
  });

  it("falls back to PullPush's ?ids= on an Arctic Shift error", async () => {
    const urls: string[] = [];
    const fetchImpl: ArchiveFetch = async (url) => {
      urls.push(url);
      if (url.includes("arctic-shift"))
        return { status: 500, json: async () => ({}) };
      return json([comment("c1", 1000)]);
    };
    const res = await archiveCommentsByIds(["t1_c1"], fetchImpl);
    expect(urls[1]).toContain("/reddit/search/comment/?ids=c1");
    expect(res.provider).toBe("pullpush");
  });

  it("does NOT fall back on an empty result (empty = not archived, valid)", async () => {
    const urls: string[] = [];
    const fetchImpl: ArchiveFetch = async (url) => {
      urls.push(url);
      return json([]);
    };
    const res = await archiveCommentsByIds(["t1_x"], fetchImpl);
    expect(urls).toHaveLength(1); // only the primary was tried
    expect(res.items).toEqual([]);
  });

  it("chunks large id batches (100 per request)", async () => {
    let calls = 0;
    const fetchImpl: ArchiveFetch = async () => {
      calls++;
      return json([]);
    };
    const ids = Array.from({ length: 250 }, (_, i) => `t1_c${i}`);
    await archiveCommentsByIds(ids, fetchImpl);
    expect(calls).toBe(3); // 100 + 100 + 50
  });

  it("makes no request for an empty id list", async () => {
    let calls = 0;
    const fetchImpl: ArchiveFetch = async () => {
      calls++;
      return json([]);
    };
    expect((await archiveCommentsByIds([], fetchImpl)).items).toEqual([]);
    expect(calls).toBe(0);
  });
});
