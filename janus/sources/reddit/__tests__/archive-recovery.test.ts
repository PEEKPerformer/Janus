import { RedditAdapter } from "../reddit-adapter";
import type { RedditTransport } from "../transport";
import type { ArchiveFetch } from "../archiveClient";
import { rid } from "../mappers/shared";
import type { Comment } from "../../../core/model";
import samples from "../__fixtures__/archiveSamples.json";

/** Build an adapter whose archive fetch returns scripted JSON per URL match. */
function withArchive(route: (url: string) => unknown[]) {
  const urls: string[] = [];
  const archiveFetch: ArchiveFetch = async (url) => {
    urls.push(url);
    return { status: 200, json: async () => ({ data: route(url) }) };
  };
  const transport = { request: async () => ({}) } as unknown as RedditTransport;
  return { adapter: new RedditAdapter({ transport, archiveFetch }), urls };
}

const rec = (over: object) => ({
  author: "alice",
  created_utc: 1000,
  subreddit: "churning",
  ...over,
});

describe("recoverUserContent", () => {
  it("reconstructs hidden posts, stamped with archive provenance", async () => {
    const { adapter } = withArchive(() => [
      rec({ id: "p1", title: "hello", created_utc: 2000 }),
    ]);
    const page = await adapter.recoverUserContent(
      rid("user", "alice"),
      "posts",
      {},
    );
    expect(page.items).toHaveLength(1);
    const post = page.items[0];
    expect(post.ext).toMatchObject({
      source: "reddit",
      archived: { source: "arctic-shift", reason: "hidden" },
    });
    expect((post as { title: string }).title).toBe("hello");
  });

  it("interleaves posts and comments newest-first for overview", async () => {
    const { adapter, urls } = withArchive((url) =>
      url.includes("/posts/")
        ? [rec({ id: "p1", title: "post", created_utc: 1000 })]
        : [
            rec({
              id: "c1",
              body: "comment",
              link_id: "t3_x",
              created_utc: 5000,
            }),
          ],
    );
    const page = await adapter.recoverUserContent(
      rid("user", "alice"),
      "overview",
      {},
    );
    // Comment (t=5000) is newer than the post (t=1000) → comes first.
    expect(page.items.map((i) => i.id)).toEqual([
      rid("comment", "t1_c1"),
      rid("post", "t3_p1"),
    ]);
    expect(urls.some((u) => u.includes("/posts/"))).toBe(true);
    expect(urls.some((u) => u.includes("/comments/"))).toBe(true);
  });

  it("never tries to recover the private saved list", async () => {
    const { adapter, urls } = withArchive(() => []);
    const page = await adapter.recoverUserContent(
      rid("user", "alice"),
      "saved",
      {},
    );
    expect(page.items).toEqual([]);
    expect(urls).toEqual([]); // no network at all
  });
});

describe("recoverRemovedComments", () => {
  const live = (id: string, body: string, author = "bob"): Comment =>
    ({
      id: rid("comment", `t1_${id}`),
      postId: rid("post", "t3_thread"),
      author: {
        id: rid("user", author),
        username: author,
        handle: `u/${author}`,
      },
      body: { text: body },
      createdAt: 1,
      score: 0,
      scoreHidden: false,
      userVote: 0,
      saved: false,
      isOP: false,
      isStickied: false,
      distinguished: null,
      depth: 0,
      childCount: 0,
      source: "reddit",
      instance: "www.reddit.com",
      dedupKey: `t1_${id}` as Comment["dedupKey"],
      permalinkRoute: { kind: "post", params: {} },
      ext: { source: "reddit" },
    }) as Comment;

  it("does nothing (no request) when no comment is removed", async () => {
    const { adapter, urls } = withArchive(() => []);
    const map = await adapter.recoverRemovedComments(rid("post", "t3_thread"), [
      live("a", "a normal comment"),
    ]);
    expect(map.size).toBe(0);
    expect(urls).toEqual([]);
  });

  it("recovers a mod-removed body and labels it moderator-removed", async () => {
    const { adapter, urls } = withArchive(() => [
      rec({ id: "x", body: "the real text", link_id: "t3_thread" }),
    ]);
    const map = await adapter.recoverRemovedComments(rid("post", "t3_thread"), [
      live("x", "[removed]", "stillvisible"),
    ]);
    const got = map.get(rid("comment", "t1_x"));
    expect(got?.text).toBe("the real text");
    expect(got?.provenance.reason).toBe("moderator-removed");
    expect(got?.author).toBeUndefined(); // author was never hidden
    expect(urls[0]).toContain("ids=x"); // looked up by exact id, not thread scrape
  });

  it("recovers a user-deleted body and restores the original author", async () => {
    const { adapter } = withArchive(() => [
      rec({
        id: "y",
        author: "ghostwriter",
        body: "deleted words",
        link_id: "t3_thread",
      }),
    ]);
    const map = await adapter.recoverRemovedComments(rid("post", "t3_thread"), [
      live("y", "[deleted]", "[deleted]"),
    ]);
    const got = map.get(rid("comment", "t1_y"));
    expect(got?.text).toBe("deleted words");
    expect(got?.provenance.reason).toBe("user-deleted");
    expect(got?.author).toBe("ghostwriter");
  });

  it("skips when the archive's copy is itself stripped", async () => {
    const { adapter } = withArchive(() => [
      rec({ id: "z", body: "[removed]", link_id: "t3_thread" }),
    ]);
    const map = await adapter.recoverRemovedComments(rid("post", "t3_thread"), [
      live("z", "[removed]"),
    ]);
    expect(map.size).toBe(0);
  });

  // These two run REAL archive records (captured live, see archiveSamples.json)
  // through the adapter, simulating how Reddit displays the now-gone comment.
  it("recovers a REAL user-deleted comment and restores its original author", async () => {
    const real = samples.real_user_deleted_comment; // archive author preserved
    const { adapter } = withArchive(() => [real]);
    // Reddit shows this as [deleted] with a [deleted] author.
    const map = await adapter.recoverRemovedComments(
      rid("post", real.link_id ?? "t3_x"),
      [live(real.id, "[deleted]", "[deleted]")],
    );
    const got = map.get(rid("comment", `t1_${real.id}`));
    expect(got?.provenance.reason).toBe("user-deleted");
    expect(got?.author).toBe(real.author); // "IthrowAwayYourAdvice"
    expect(got?.text?.length).toBeGreaterThan(0);
    expect(got?.text).not.toBe("[deleted]");
  });

  it("recovers a REAL mod-removed comment (author was never hidden)", async () => {
    const real = samples.real_mod_removed_comment;
    const { adapter } = withArchive(() => [real]);
    const map = await adapter.recoverRemovedComments(
      rid("post", real.link_id ?? "t3_x"),
      [live(real.id, "[removed]", real.author)],
    );
    const got = map.get(rid("comment", `t1_${real.id}`));
    expect(got?.provenance.reason).toBe("moderator-removed");
    expect(got?.author).toBeUndefined(); // visible author → no restoration needed
    expect(got?.text?.length).toBeGreaterThan(0);
  });
});
