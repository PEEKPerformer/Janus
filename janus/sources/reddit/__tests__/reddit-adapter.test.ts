import { RedditAdapter, parseUserMe } from "../reddit-adapter";
import {
  RedditTransport,
  type LowLevelFetch,
  type HttpResponse,
} from "../transport";
import {
  listingFixture,
  postCommentsFixture,
} from "../__fixtures__/redditSamples";
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
    expect(page.items.map((c) => c.dedupKey)).toEqual([
      "t1_c100",
      "t1_c200",
      "t1_c150",
    ]);
    expect(page.items[1].parentId).toBe(page.items[0].id); // c200 under c100
  });

  it("vote without auth throws a typed NotAuthenticatedError (no UI side effect)", async () => {
    const { adapter } = fixtureAdapter();
    await expect(
      adapter.vote(rid("post", "t3_abc100"), Vote.Up),
    ).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });
  });

  it("resolveRemoteUrl throws CapabilityError (Reddit has no federation)", async () => {
    const { adapter } = fixtureAdapter();
    await expect(
      adapter.resolveRemoteUrl("https://lemmy.ml/c/x"),
    ).rejects.toMatchObject({
      code: "CAPABILITY_UNSUPPORTED",
    });
  });

  it("searchCommunities maps t5 subreddits for the community picker", async () => {
    const urls: string[] = [];
    const fetchImpl: LowLevelFetch = async (url) => {
      urls.push(url);
      return jsonRes({
        kind: "Listing",
        data: {
          after: "t5_next",
          children: [
            {
              kind: "t5",
              data: {
                name: "t5_2qh1i",
                display_name: "aww",
                title: "Aww",
                public_description: "cute",
                subscribers: 34000000,
                over18: false,
                icon_img: "https://i.redd.it/aww.png?x=1",
              },
            },
            {
              kind: "t5",
              data: {
                name: "t5_2qh03",
                display_name: "pics",
                title: "Pics",
                subscribers: 30000000,
                over18: false,
              },
            },
          ],
        },
      });
    };
    const transport = new RedditTransport({ fetchImpl, userAgent: "test-ua" });
    const adapter = new RedditAdapter({ transport });
    const page = await adapter.searchCommunities("aw", { limit: 25 });
    expect(urls[0]).toContain("/subreddits/search.json");
    expect(urls[0]).toContain("q=aw");
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      name: "aww",
      handle: "r/aww",
      source: "reddit",
      subscriberCount: 34000000,
    });
    expect(page.items[0].icon).toBe("https://i.redd.it/aww.png"); // query stripped
    expect(page.items[0].id).toBe(rid("community", "aww"));
    expect(page.nextCursor).toBe("t5_next");
  });
});

/** Build an adapter (with modhash auth) that records POST bodies + routes by URL. */
function authedWriteAdapter(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; form: Record<string, string> }[] =
    [];
  const fetchImpl: LowLevelFetch = async (
    url,
    init?: { method?: string; body?: string | null },
  ) => {
    const form: Record<string, string> = {};
    if (init?.body)
      for (const [k, v] of new URLSearchParams(init.body)) form[k] = v;
    calls.push({ url, method: init?.method ?? "GET", form });
    for (const [frag, res] of Object.entries(routes)) {
      if (url.includes(frag)) return jsonRes(res);
    }
    throw new Error(`unexpected url ${url}`);
  };
  const transport = new RedditTransport({ fetchImpl, userAgent: "test-ua" });
  return {
    adapter: new RedditAdapter({ transport, auth: { modhash: "MH" } }),
    calls,
  };
}

describe("RedditAdapter writes", () => {
  it("submitComment posts to /api/comment and maps the returned t1", async () => {
    const t1 = {
      kind: "t1",
      data: {
        name: "t1_new",
        body: "hello",
        author: "alice",
        ups: 1,
        created: 1000,
        link_id: "t3_abc100",
      },
    };
    const { adapter, calls } = authedWriteAdapter({
      "/api/comment": { json: { errors: [], data: { things: [t1] } } },
    });
    const comment = await adapter.submitComment({
      postId: rid("post", "t3_abc100"),
      parentId: rid("post", "t3_abc100"),
      markdown: "hello",
    });
    expect(calls[0].url).toContain("/api/comment");
    expect(calls[0].form).toMatchObject({
      thing_id: "t3_abc100",
      text: "hello",
      api_type: "json",
    });
    expect(comment.body.text).toBe("hello");
    expect(comment.dedupKey).toBe("t1_new");
  });

  it("submitComment surfaces Reddit's error array as a typed error", async () => {
    const { adapter } = authedWriteAdapter({
      "/api/comment": {
        json: { errors: [["RATELIMIT", "you are doing that too much"]] },
      },
    });
    await expect(
      adapter.submitComment({
        postId: rid("post", "t3_x"),
        parentId: rid("post", "t3_x"),
        markdown: "hi",
      }),
    ).rejects.toThrow(/too much/);
  });

  it("setSubscription subscribes then re-fetches the community", async () => {
    const about = {
      kind: "t5",
      data: {
        name: "t5_1",
        display_name: "aww",
        title: "Aww",
        subscribers: 10,
        user_is_subscriber: true,
      },
    };
    const { adapter, calls } = authedWriteAdapter({
      "/api/subscribe": {},
      "/r/aww/about": about,
    });
    const community = await adapter.setSubscription(
      rid("community", "aww"),
      true,
    );
    expect(calls[0].form).toMatchObject({ action: "sub", sr_name: "aww" });
    expect(community.handle).toBe("r/aww");
    expect(community.subscription).toBe("subscribed");
  });

  it("getSubscriptions lists and alphabetizes the user's subreddits", async () => {
    const listing = {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t5",
            data: { name: "t5_2", display_name: "pics", subscribers: 2 },
          },
          {
            kind: "t5",
            data: { name: "t5_1", display_name: "aww", subscribers: 1 },
          },
        ],
      },
    };
    const { adapter, calls } = authedWriteAdapter({
      "/subreddits/mine/subscriber": listing,
    });
    const subs = await adapter.getSubscriptions();
    expect(calls[0].url).toContain("/subreddits/mine/subscriber.json");
    expect(subs.map((s) => s.name)).toEqual(["aww", "pics"]); // sorted
  });

  it("getSubscriptions pages through the `after` cursor (no truncation)", async () => {
    const page1 = {
      kind: "Listing",
      data: {
        after: "t5_p1",
        children: [
          {
            kind: "t5",
            data: { name: "t5_a", display_name: "alpha", subscribers: 1 },
          },
        ],
      },
    };
    const page2 = {
      kind: "Listing",
      data: {
        after: null,
        children: [
          {
            kind: "t5",
            data: { name: "t5_b", display_name: "bravo", subscribers: 2 },
          },
        ],
      },
    };
    // Routes are matched in insertion order; the 2nd page carries `after=t5_p1`.
    const { adapter, calls } = authedWriteAdapter({
      "after=t5_p1": page2,
      "/subreddits/mine/subscriber": page1,
    });
    const subs = await adapter.getSubscriptions();
    expect(subs.map((s) => s.name)).toEqual(["alpha", "bravo"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("after=t5_p1");
  });

  it("getUser maps a t2 account", async () => {
    const t2 = {
      kind: "t2",
      data: {
        name: "alice",
        id: "abc",
        link_karma: 100,
        comment_karma: 200,
        created_utc: 1000,
      },
    };
    const { adapter } = authedWriteAdapter({ "/user/alice/about": t2 });
    const user = await adapter.getUser(rid("user", "alice"));
    expect(user.username).toBe("alice");
    expect(user.handle).toBe("u/alice");
    expect(user.postScore).toBe(100);
    expect(user.commentScore).toBe(200);
  });

  it("getUserContent maps a mixed overview of posts and comments", async () => {
    const listing = {
      kind: "Listing",
      data: {
        after: "t1_next",
        children: [
          {
            kind: "t3",
            data: {
              name: "t3_p",
              title: "A post",
              author: "alice",
              subreddit: "aww",
              created: 1,
              ups: 5,
            },
          },
          {
            kind: "t1",
            data: {
              name: "t1_c",
              body: "a comment",
              author: "alice",
              link_id: "t3_p",
              created: 2,
              ups: 3,
            },
          },
        ],
      },
    };
    const { adapter, calls } = authedWriteAdapter({
      "/user/alice/overview": listing,
    });
    const page = await adapter.getUserContent(
      rid("user", "alice"),
      "overview",
      { limit: 25 },
    );
    expect(calls[0].url).toContain("/user/alice/overview.json");
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("t1_next");
  });

  it("editContent edits a comment via /api/editusertext", async () => {
    const t1 = {
      kind: "t1",
      data: {
        name: "t1_c",
        body: "edited!",
        author: "me",
        link_id: "t3_p",
        created: 1,
        ups: 2,
      },
    };
    const { adapter, calls } = authedWriteAdapter({
      "/api/editusertext": { json: { errors: [], data: { things: [t1] } } },
    });
    const edited = await adapter.editContent(rid("comment", "t1_c"), "edited!");
    expect(calls[0].form).toMatchObject({ thing_id: "t1_c", text: "edited!" });
    expect((edited as { body: { text?: string } }).body.text).toBe("edited!");
  });

  it("deleteContent posts to /api/del", async () => {
    const { adapter, calls } = authedWriteAdapter({ "/api/del": {} });
    await adapter.deleteContent(rid("post", "t3_p"));
    expect(calls[0].url).toContain("/api/del");
    expect(calls[0].form).toMatchObject({ id: "t3_p" });
  });

  it("getInbox maps t1 replies and t4 messages", async () => {
    const listing = {
      kind: "Listing",
      data: {
        after: "t1_next",
        children: [
          {
            kind: "t1",
            data: {
              name: "t1_a",
              new: true,
              author: "bob",
              body: "reply!",
              subject: "comment reply",
              created_utc: 1,
              context: "/r/x/comments/1/_/a",
            },
          },
          {
            kind: "t4",
            data: {
              name: "t4_b",
              new: false,
              author: "carol",
              body: "hi there",
              subject: "hello",
              created_utc: 2,
            },
          },
        ],
      },
    };
    const { adapter, calls } = authedWriteAdapter({
      "/message/inbox": listing,
    });
    const page = await adapter.getInbox("all", { limit: 25 });
    expect(calls[0].url).toContain("/message/inbox.json");
    expect(page.items[0]).toMatchObject({ kind: "commentReply", read: false });
    expect(page.items[1]).toMatchObject({ kind: "privateMessage", read: true });
    expect(page.nextCursor).toBe("t1_next");
  });

  it("markRead and markAllRead hit the right endpoints", async () => {
    const { adapter, calls } = authedWriteAdapter({
      "/api/read_message": {},
      "/api/read_all_messages": {},
    });
    await adapter.markRead(rid("message", "t1_a"), true);
    expect(calls[0].url).toContain("/api/read_message");
    expect(calls[0].form).toMatchObject({ id: "t1_a" });
    await adapter.markAllRead();
    expect(calls[1].url).toContain("/api/read_all_messages");
  });

  it("sendMessage composes to a user", async () => {
    const { adapter, calls } = authedWriteAdapter({ "/api/compose": {} });
    await adapter.sendMessage({ to: rid("user", "bob"), markdown: "yo" });
    expect(calls[0].form).toMatchObject({ to: "bob", text: "yo" });
  });

  it("search returns posts from /search", async () => {
    const listing = {
      kind: "Listing",
      data: {
        after: "t3_next",
        children: [
          {
            kind: "t3",
            data: {
              name: "t3_a",
              title: "cats",
              author: "bob",
              subreddit: "aww",
              created: 1,
            },
          },
        ],
      },
    };
    const { adapter, calls } = authedWriteAdapter({ "/search": listing });
    const page = await adapter.search("cats", "posts", { limit: 25 });
    expect(calls[0].url).toContain("/search.json");
    expect(calls[0].url).toContain("q=cats");
    expect(page.items[0].title).toBe("cats");
    expect(page.nextCursor).toBe("t3_next");
  });

  it("uploadImage leases an S3 slot then multipart-uploads, returning the public URL", async () => {
    const lease = {
      args: {
        action: "//reddit-uploaded-media.s3-accelerate.amazonaws.com",
        fields: [
          { name: "acl", value: "private" },
          { name: "key", value: "abcd/photo.jpg" },
        ],
      },
      asset: { asset_id: "asset1" },
    };
    const fetchImpl: LowLevelFetch = async (url) =>
      jsonRes(url.includes("/api/media/asset.json") ? lease : {});
    const transport = new RedditTransport({ fetchImpl, userAgent: "test-ua" });
    const uploads: { url: string; method: string; hasBody: boolean }[] = [];
    const adapter = new RedditAdapter({
      transport,
      auth: { modhash: "MH" },
      uploadFetch: async (url, init) => {
        uploads.push({
          url,
          method: init.method,
          hasBody: init.body != null,
        });
        return { ok: true, status: 201 };
      },
    });

    const { url } = await adapter.uploadImage({
      uri: "file:///tmp/photo.jpg",
      name: "photo.jpg",
      mimeType: "image/jpeg",
    });

    expect(uploads[0].method).toBe("POST");
    expect(uploads[0].url).toBe(
      "https://reddit-uploaded-media.s3-accelerate.amazonaws.com",
    );
    expect(uploads[0].hasBody).toBe(true);
    expect(url).toBe(
      "https://reddit-uploaded-media.s3-accelerate.amazonaws.com/abcd/photo.jpg",
    );
  });

  it("moderate routes each action to the right Reddit endpoint", async () => {
    const { adapter, calls } = authedWriteAdapter({ "/api/": { json: {} } });
    const id = rid("post", "t3_xyz");
    await adapter.moderate!(id, { kind: "remove" });
    await adapter.moderate!(id, { kind: "approve" });
    await adapter.moderate!(id, { kind: "lock", locked: true });
    await adapter.moderate!(id, { kind: "pin", pinned: true });
    await adapter.moderate!(rid("comment", "t1_c"), {
      kind: "distinguish",
      distinguished: true,
    });
    expect(calls[0].url).toContain("/api/remove");
    expect(calls[0].form).toMatchObject({ id: "t3_xyz", spam: "false" });
    expect(calls[1].url).toContain("/api/approve");
    expect(calls[2].url).toContain("/api/lock");
    expect(calls[3].url).toContain("/api/set_subreddit_sticky");
    expect(calls[3].form).toMatchObject({ state: "true" });
    expect(calls[4].url).toContain("/api/distinguish");
    expect(calls[4].form).toMatchObject({ how: "yes", id: "t1_c" });
  });

  it("getMultireddits maps /api/multi/mine into Multireddits", async () => {
    const multis = [
      {
        kind: "LabeledMulti",
        data: {
          name: "news",
          display_name: "News",
          path: "/user/alice/m/news/",
          subreddits: [{ name: "worldnews" }, { name: "politics" }],
        },
      },
    ];
    const { adapter, calls } = authedWriteAdapter({
      "/api/multi/mine": multis,
    });
    const result = await adapter.getMultireddits!();
    expect(calls[0].url).toContain("/api/multi/mine.json");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(
      "reddit:www.reddit.com:multireddit:user/alice/m/news",
    );
    expect(result[0].name).toBe("News");
    expect(result[0].communities.map((c) => c.name)).toEqual([
      "worldnews",
      "politics",
    ]);
  });

  it("getFeed scopes to a multireddit path when given a multiId", async () => {
    const listing = { data: { children: [], after: null } };
    const { adapter, calls } = authedWriteAdapter({
      "/user/alice/m/news/": listing,
    });
    await adapter.getFeed(
      { multiId: rid("multireddit", "user/alice/m/news"), sort: "hot" },
      { limit: 25 },
    );
    expect(calls[0].url).toContain("/user/alice/m/news/hot.json");
  });

  it("getTrendingCommunities maps the popular subreddit listing", async () => {
    const listing = {
      data: {
        children: [
          {
            kind: "t5",
            data: {
              display_name: "popular1",
              subscribers: 1000,
              title: "Popular One",
            },
          },
          { kind: "t1", data: {} }, // non-subreddit noise is filtered
        ],
      },
    };
    const { adapter, calls } = authedWriteAdapter({
      "/subreddits/popular": listing,
    });
    const communities = await adapter.getTrendingCommunities();
    expect(calls[0].url).toContain("/subreddits/popular.json");
    expect(communities).toHaveLength(1);
    expect(communities[0].name).toBe("popular1");
  });

  it("uploadImage requires authentication", async () => {
    const fetchImpl: LowLevelFetch = async () => jsonRes({});
    const transport = new RedditTransport({ fetchImpl, userAgent: "test-ua" });
    const adapter = new RedditAdapter({ transport }); // guest, no modhash
    await expect(
      adapter.uploadImage({
        uri: "file:///tmp/x.jpg",
        name: "x.jpg",
        mimeType: "image/jpeg",
      }),
    ).rejects.toThrow();
  });
});

describe("Reddit login", () => {
  it("parseUserMe detects the authenticated user via inbox_count", () => {
    expect(
      parseUserMe({ data: { name: "alice", modhash: "MH", inbox_count: 0 } }),
    ).toEqual({
      username: "alice",
      modhash: "MH",
      isLoggedIn: true,
    });
    expect(parseUserMe({ data: { name: "bob" } })).toMatchObject({
      isLoggedIn: false,
    });
  });

  it("completeLogin promotes the adapter to a non-guest account with a modhash", async () => {
    const fetchImpl: LowLevelFetch = async () =>
      jsonRes({
        kind: "t2",
        data: { name: "alice", modhash: "MH", inbox_count: 3 },
      });
    const transport = new RedditTransport({ fetchImpl, userAgent: "test-ua" });
    const adapter = new RedditAdapter({ transport });
    expect(adapter.account.isGuest).toBe(true);

    const { account, secret } = await adapter.completeLogin({
      mode: "webview",
      capturedCookie: "ck",
    });
    expect(account).toMatchObject({
      isGuest: false,
      username: "alice",
      source: "reddit",
    });
    expect(secret).toMatchObject({
      source: "reddit",
      modhash: "MH",
      sessionCookie: "ck",
    });
    expect(adapter.account.isGuest).toBe(false);
  });
});
