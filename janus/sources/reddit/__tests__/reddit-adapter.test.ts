import { RedditAdapter, parseUserMe } from "../reddit-adapter";
import { RedditTransport, type LowLevelFetch, type HttpResponse } from "../transport";
import { listingFixture, postCommentsFixture } from "../__fixtures__/redditSamples";
import { rid } from "../mappers/shared";
import { Vote } from "../../../core/vote";

function jsonRes(body: unknown): HttpResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: "https://www.reddit.com",
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body as never,
  };
}

/** A transport whose fetch routes by URL to the right fixture, recording calls. */
function fixtureAdapter() {
  const urls: string[] = [];
  const fetchImpl: LowLevelFetch = async (url) => {
    urls.push(url);
    if (url.includes("/r/aww/")) return jsonRes(listingFixture);
    if (url.includes("/comments/abc100")) return jsonRes(postCommentsFixture);
    throw new Error(`unexpected url ${url}`);
  };
  const transport = new RedditTransport({ fetchImpl, userAgent: "test-ua" });
  return { adapter: new RedditAdapter({ transport }), urls };
}

describe("RedditAdapter", () => {
  it("is a guest by default and advertises honest capabilities", () => {
    const { adapter } = fixtureAdapter();
    expect(adapter.source).toBe("reddit");
    expect(adapter.account.isGuest).toBe(true);
    expect(adapter.capabilities.supportsAwards).toBe(false);
    expect(adapter.capabilities.supportsPolls).toBe(false);
    expect(adapter.capabilities.supportsFederationResolve).toBe(false);
  });

  it("getFeed maps a community listing to unified Posts with a cursor", async () => {
    const { adapter, urls } = fixtureAdapter();
    const page = await adapter.getFeed(
      { communityId: rid("community", "aww"), sort: "hot" },
      { limit: 25 },
    );
    expect(urls[0]).toContain("/r/aww/hot.json");
    expect(urls[0]).toContain("raw_json=1");
    expect(page.items).toHaveLength(3);
    expect(page.items[0].title).toBe("A self post about & things");
    expect(page.items[0].source).toBe("reddit");
    expect(page.nextCursor).toBe("t3_abc300");
  });

  it("getPost fetches the comments endpoint and maps the post", async () => {
    const { adapter, urls } = fixtureAdapter();
    const post = await adapter.getPost(rid("post", "t3_abc100"));
    expect(urls[0]).toContain("/comments/abc100.json");
    expect(post.id).toBe("reddit:www.reddit.com:post:t3_abc100");
    expect(post.commentCount).toBe(42);
  });

  it("getComments returns a flat, nestable Comment list", async () => {
    const { adapter } = fixtureAdapter();
    const page = await adapter.getComments(rid("post", "t3_abc100"), {});
    expect(page.items.map((c) => c.dedupKey)).toEqual(["t1_c100", "t1_c200", "t1_c150"]);
    expect(page.items[1].parentId).toBe(page.items[0].id); // c200 under c100
  });

  it("vote without auth throws a typed NotAuthenticatedError (no UI side effect)", async () => {
    const { adapter } = fixtureAdapter();
    await expect(adapter.vote(rid("post", "t3_abc100"), Vote.Up)).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });
  });

  it("resolveRemoteUrl throws CapabilityError (Reddit has no federation)", async () => {
    const { adapter } = fixtureAdapter();
    await expect(adapter.resolveRemoteUrl("https://lemmy.ml/c/x")).rejects.toMatchObject({
      code: "CAPABILITY_UNSUPPORTED",
    });
  });
});

describe("Reddit login", () => {
  it("parseUserMe detects the authenticated user via inbox_count", () => {
    expect(parseUserMe({ data: { name: "alice", modhash: "MH", inbox_count: 0 } })).toEqual({
      username: "alice",
      modhash: "MH",
      isLoggedIn: true,
    });
    expect(parseUserMe({ data: { name: "bob" } })).toMatchObject({ isLoggedIn: false });
  });

  it("completeLogin promotes the adapter to a non-guest account with a modhash", async () => {
    const fetchImpl: LowLevelFetch = async () =>
      jsonRes({ kind: "t2", data: { name: "alice", modhash: "MH", inbox_count: 3 } });
    const transport = new RedditTransport({ fetchImpl, userAgent: "test-ua" });
    const adapter = new RedditAdapter({ transport });
    expect(adapter.account.isGuest).toBe(true);

    const { account, secret } = await adapter.completeLogin({ mode: "webview", capturedCookie: "ck" });
    expect(account).toMatchObject({ isGuest: false, username: "alice", source: "reddit" });
    expect(secret).toMatchObject({ source: "reddit", modhash: "MH", sessionCookie: "ck" });
    expect(adapter.account.isGuest).toBe(false);
  });
});
