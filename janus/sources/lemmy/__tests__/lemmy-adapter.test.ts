import { LemmyAdapter, type FetchJson } from "../lemmy-adapter";
import {
  lemmyListFixture,
  lemmyPostFixture,
  lemmyCommentsFixture,
} from "../__fixtures__/lemmySamples";
import { lid } from "../mappers";
import { buildCommentTree, countComments } from "../../../core/comment-tree";
import { Vote } from "../../../core/vote";

function fixtureAdapter(jwt?: string) {
  const urls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    urls.push(url);
    if (url.includes("/post/list")) return lemmyListFixture;
    if (url.includes("/post?")) return lemmyPostFixture;
    if (url.includes("/comment/list")) return lemmyCommentsFixture;
    if (url.includes("/resolve_object"))
      return { community: { community: { id: 3 } } };
    throw new Error(`unexpected url ${url}`);
  };
  return {
    adapter: new LemmyAdapter({ instance: "lemmy.world", fetchJson, jwt }),
    urls,
  };
}

/** Adapter that records every POST (url + parsed body) and returns canned JSON. */
function writeAdapter(routes: Record<string, any>, jwt = "JWT") {
  const calls: { url: string; body?: any; method?: string }[] = [];
  const fetchJson: FetchJson = async (url, init) => {
    calls.push({
      url,
      body: init?.body ? JSON.parse(init.body) : undefined,
      method: init?.method,
    });
    for (const [frag, res] of Object.entries(routes)) {
      if (url.includes(frag)) return res;
    }
    throw new Error(`unexpected url ${url}`);
  };
  return {
    adapter: new LemmyAdapter({ instance: "lemmy.world", fetchJson, jwt }),
    calls,
  };
}

describe("LemmyAdapter", () => {
  it("advertises Lemmy capabilities (federation yes, multireddits no)", () => {
    const { adapter } = fixtureAdapter();
    expect(adapter.source).toBe("lemmy");
    expect(adapter.capabilities.supportsFederationResolve).toBe(true);
    expect(adapter.capabilities.supportsMultireddits).toBe(false);
    expect(adapter.capabilities.topRequiresTimeWindow).toBe(true);
    expect(adapter.account.isGuest).toBe(true);
  });

  it("getFeed maps posts and threads the page cursor", async () => {
    const { adapter, urls } = fixtureAdapter();
    const page = await adapter.getFeed(
      { sort: "top", timeWindow: "week", listingType: "All" },
      { limit: 25 },
    );
    expect(urls[0]).toContain("/post/list");
    expect(urls[0]).toContain("sort=TopWeek"); // top + week -> TopWeek
    expect(urls[0]).toContain("type_=All");
    expect(page.items).toHaveLength(2);
    expect(page.items[0].title).toBe("A local image post");
    expect(page.nextCursor).toBe("PAGECURSOR2");
  });

  it("getComments returns a flat list that the CORE tree builder nests", async () => {
    const { adapter } = fixtureAdapter();
    const postId = lid("lemmy.world", "post", 1001);
    const page = await adapter.getComments(postId, {});
    expect(page.items).toHaveLength(3);

    // Same builder Reddit uses — proves the unified comment path.
    const forest = buildCommentTree(page.items);
    expect(forest).toHaveLength(2); // c10 (with child c11) + c12
    expect(forest[0].replies).toHaveLength(1);
    expect(forest[0].replies[0].comment.dedupKey).toBe(
      "https://lemmy.world/comment/11",
    );
    expect(countComments(forest)).toBe(3);
  });

  it("getPost maps the post_view", async () => {
    const { adapter, urls } = fixtureAdapter();
    const post = await adapter.getPost(lid("lemmy.world", "post", 1001));
    expect(urls[0]).toContain("/post?id=1001");
    expect(post.commentCount).toBe(12);
  });

  it("vote without a JWT throws a typed NotAuthenticatedError", async () => {
    const { adapter } = fixtureAdapter();
    await expect(
      adapter.vote(lid("lemmy.world", "post", 1001), Vote.Up),
    ).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });
  });

  it("resolveRemoteUrl works (Lemmy federation)", async () => {
    const { adapter } = fixtureAdapter();
    const resolved = await adapter.resolveRemoteUrl(
      "https://beehaw.org/c/news",
    );
    expect(resolved).toEqual({
      kind: "community",
      id: lid("lemmy.world", "community", 3),
    });
  });

  describe("login", () => {
    const siteRes = {
      my_user: {
        local_user_view: {
          person: {
            id: 42,
            name: "alice",
            display_name: "Alice",
            avatar: "https://lemmy.world/a.png",
          },
        },
      },
    };

    function loginAdapter(loginRes: any) {
      const bodies: any[] = [];
      const fetchJson: FetchJson = async (url, init) => {
        if (url.includes("/user/login")) {
          bodies.push(JSON.parse(init!.body!));
          if (loginRes instanceof Error) throw loginRes;
          return loginRes;
        }
        if (url.includes("/site")) return siteRes;
        throw new Error(`unexpected url ${url}`);
      };
      return {
        adapter: new LemmyAdapter({ instance: "lemmy.world", fetchJson }),
        bodies,
      };
    }

    it("exchanges credentials for a JWT and loads identity from /site", async () => {
      const { adapter, bodies } = loginAdapter({ jwt: "JWT123" });
      const { account, secret } = await adapter.completeLogin({
        mode: "credentials",
        usernameOrEmail: "  alice ",
        password: "pw",
      });
      expect(bodies[0]).toEqual({
        username_or_email: "alice",
        password: "pw",
        totp_2fa_token: undefined,
      });
      expect(secret).toEqual({ source: "lemmy", jwt: "JWT123" });
      expect(account.isGuest).toBe(false);
      expect(account.username).toBe("alice");
      expect(account.displayName).toBe("Alice");
      expect(account.id).toBe(lid("lemmy.world", "user", 42));
      expect(adapter.account.username).toBe("alice");
    });

    it("passes the TOTP token through when provided", async () => {
      const { adapter, bodies } = loginAdapter({ jwt: "J" });
      await adapter.completeLogin({
        mode: "credentials",
        usernameOrEmail: "a",
        password: "p",
        totp: "654321",
      });
      expect(bodies[0].totp_2fa_token).toBe("654321");
    });

    it("maps a missing-2FA error to a friendly NotAuthenticated message", async () => {
      const { adapter } = loginAdapter(new Error("Lemmy: missing_totp_token"));
      await expect(
        adapter.completeLogin({
          mode: "credentials",
          usernameOrEmail: "a",
          password: "p",
        }),
      ).rejects.toMatchObject({
        code: "NOT_AUTHENTICATED",
        message: expect.stringMatching(/2FA/i),
      });
    });

    it("maps incorrect credentials to a friendly NotAuthenticated message", async () => {
      const { adapter } = loginAdapter(new Error("Lemmy: incorrect_login"));
      await expect(
        adapter.completeLogin({
          mode: "credentials",
          usernameOrEmail: "a",
          password: "p",
        }),
      ).rejects.toMatchObject({
        code: "NOT_AUTHENTICATED",
        message: expect.stringMatching(/incorrect/i),
      });
    });

    it("treats a response with no jwt as a failed login", async () => {
      const { adapter } = loginAdapter({ jwt: null });
      await expect(
        adapter.completeLogin({
          mode: "credentials",
          usernameOrEmail: "a",
          password: "p",
        }),
      ).rejects.toMatchObject({
        code: "NOT_AUTHENTICATED",
      });
    });

    it("restore() rehydrates identity from a stored JWT", async () => {
      const { adapter } = loginAdapter({ jwt: "ignored" });
      const account = await adapter.restore({ source: "lemmy", jwt: "STORED" });
      expect(account.isGuest).toBe(false);
      expect(account.username).toBe("alice");
    });

    it("restore() falls back to guest when the JWT is stale", async () => {
      const fetchJson: FetchJson = async (url) => {
        if (url.includes("/site")) throw new Error("Lemmy: not_logged_in");
        throw new Error(`unexpected url ${url}`);
      };
      const adapter = new LemmyAdapter({ instance: "lemmy.world", fetchJson });
      const account = await adapter.restore({ source: "lemmy", jwt: "STALE" });
      expect(account.isGuest).toBe(true);
    });

    it("logout() returns to a guest account", async () => {
      const { adapter } = loginAdapter({ jwt: "J" });
      await adapter.completeLogin({
        mode: "credentials",
        usernameOrEmail: "a",
        password: "p",
      });
      await adapter.logout();
      expect(adapter.account.isGuest).toBe(true);
    });
  });

  describe("writes (require JWT)", () => {
    it("save posts to /post/save and comments to /comment/save", async () => {
      const { adapter, calls } = writeAdapter({
        "/post/save": {},
        "/comment/save": {},
      });
      await adapter.save(lid("lemmy.world", "post", 1001), true);
      await adapter.save(lid("lemmy.world", "comment", 11), false);
      expect(calls[0]).toMatchObject({
        method: "POST",
        body: { post_id: 1001, save: true },
      });
      expect(calls[0].url).toContain("/post/save");
      expect(calls[1]).toMatchObject({ body: { comment_id: 11, save: false } });
    });

    it("save without a JWT throws NotAuthenticated", async () => {
      const adapter = new LemmyAdapter({
        instance: "lemmy.world",
        fetchJson: async () => ({}),
      });
      await expect(
        adapter.save(lid("lemmy.world", "post", 1), true),
      ).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    });

    it("submitComment posts top-level (no parent_id) vs reply (parent_id)", async () => {
      const cv = lemmyCommentsFixture.comments[0];
      const { adapter, calls } = writeAdapter({
        "/comment": { comment_view: cv },
      });
      await adapter.submitComment({
        postId: lid("lemmy.world", "post", 1001),
        parentId: lid("lemmy.world", "post", 1001),
        markdown: "hi",
      });
      expect(calls[0].body).toEqual({ content: "hi", post_id: 1001 });
      await adapter.submitComment({
        postId: lid("lemmy.world", "post", 1001),
        parentId: lid("lemmy.world", "comment", 10),
        markdown: "re",
      });
      expect(calls[1].body).toEqual({
        content: "re",
        post_id: 1001,
        parent_id: 10,
      });
    });

    it("setSubscription follows/unfollows and returns the updated community", async () => {
      const cv = {
        community: {
          id: 7,
          name: "tech",
          local: true,
          actor_id: "https://lemmy.world/c/tech",
        },
        counts: { subscribers: 5 },
        subscribed: "Subscribed",
      };
      const { adapter, calls } = writeAdapter({
        "/community/follow": { community_view: cv },
      });
      const c = await adapter.setSubscription(
        lid("lemmy.world", "community", 7),
        true,
      );
      expect(calls[0].body).toEqual({ community_id: 7, follow: true });
      expect(c.name).toBe("tech");
    });

    it("getSubscriptions lists the Subscribed communities", async () => {
      const communities = [
        {
          community: {
            id: 7,
            name: "tech",
            local: true,
            actor_id: "https://lemmy.world/c/tech",
          },
          counts: { subscribers: 5 },
        },
      ];
      const { adapter, calls } = writeAdapter({
        "/community/list": { communities },
      });
      const list = await adapter.getSubscriptions();
      expect(calls[0].url).toContain("type_=Subscribed");
      expect(list).toHaveLength(1);
      expect(list[0].handle).toBe("tech");
    });

    it("getUserContent maps posts and comments and paginates by page number", async () => {
      const res = {
        posts: lemmyListFixture.posts,
        comments: lemmyCommentsFixture.comments,
      };
      const { adapter, calls } = writeAdapter({ "/user": res });
      const page = await adapter.getUserContent(
        lid("lemmy.world", "user", 42),
        "overview",
        { limit: 25 },
      );
      expect(calls[0].url).toContain("person_id=42");
      expect(page.items.length).toBe(
        lemmyListFixture.posts.length + lemmyCommentsFixture.comments.length,
      );
      expect(page.nextCursor).toBe(2);
    });

    it("search posts hits /search with the right type", async () => {
      const { adapter, calls } = writeAdapter({
        "/search": { posts: lemmyListFixture.posts },
      });
      const page = await adapter.search("cats", "posts", { limit: 25 });
      expect(calls[0].url).toContain("type_=Posts");
      expect(page.items).toHaveLength(2);
    });

    it("editContent PUTs a comment edit", async () => {
      const cv = lemmyCommentsFixture.comments[0];
      const { adapter, calls } = writeAdapter({
        "/comment": { comment_view: cv },
      });
      await adapter.editContent(
        lid("lemmy.world", "comment", 10),
        "edited body",
      );
      expect(calls[0].method).toBe("PUT");
      expect(calls[0].body).toEqual({ comment_id: 10, content: "edited body" });
    });

    it("editContent PUTs a post body edit", async () => {
      const pv = lemmyListFixture.posts[0];
      const { adapter, calls } = writeAdapter({ "/post": { post_view: pv } });
      await adapter.editContent(lid("lemmy.world", "post", 1001), "new body");
      expect(calls[0].method).toBe("PUT");
      expect(calls[0].body).toEqual({ post_id: 1001, body: "new body" });
    });

    it("deleteContent marks a comment deleted", async () => {
      const { adapter, calls } = writeAdapter({ "/comment/delete": {} });
      await adapter.deleteContent(lid("lemmy.world", "comment", 10));
      expect(calls[0].body).toEqual({ comment_id: 10, deleted: true });
    });

    it("getUnreadCount sums replies, mentions and messages", async () => {
      const { adapter } = writeAdapter({
        "/user/unread_count": { replies: 2, mentions: 1, private_messages: 3 },
      });
      expect(await adapter.getUnreadCount()).toBe(6);
    });

    it("getInbox maps comment replies", async () => {
      const replies = [
        {
          comment_reply: { id: 1, read: false },
          comment: {
            content: "nice post",
            published: "2024-01-01T00:00:00Z",
            ap_id: "https://lemmy.world/comment/1",
          },
          creator: {
            id: 2,
            name: "bob",
            local: true,
            actor_id: "https://lemmy.world/u/bob",
          },
          post: { id: 9, name: "The Post" },
        },
      ];
      const { adapter, calls } = writeAdapter({ "/user/replies": { replies } });
      const page = await adapter.getInbox("replies", { limit: 25 });
      expect(calls[0].url).toContain("/user/replies");
      expect(page.items).toHaveLength(1);
      expect(page.items[0].kind).toBe("commentReply");
      expect(page.items[0].read).toBe(false);
      expect(page.items[0].author?.handle).toBe("bob");
      expect(page.items[0].id).toBe(lid("lemmy.world", "message", "reply:1"));
    });

    it("markRead routes by the encoded notification type", async () => {
      const { adapter, calls } = writeAdapter({
        "/comment/mark_as_read": {},
        "/private_message/mark_as_read": {},
      });
      await adapter.markRead(lid("lemmy.world", "message", "reply:1"), true);
      expect(calls[0].url).toContain("/comment/mark_as_read");
      expect(calls[0].body).toEqual({ comment_reply_id: 1, read: true });
      await adapter.markRead(lid("lemmy.world", "message", "pm:5"), true);
      expect(calls[1].url).toContain("/private_message/mark_as_read");
      expect(calls[1].body).toEqual({ private_message_id: 5, read: true });
    });

    it("sendMessage posts a private message to the recipient", async () => {
      const { adapter, calls } = writeAdapter({ "/private_message": {} });
      await adapter.sendMessage({
        to: lid("lemmy.world", "user", 42),
        markdown: "hello",
      });
      expect(calls[0].body).toEqual({ content: "hello", recipient_id: 42 });
    });

    it("blockUser posts a block", async () => {
      const { adapter, calls } = writeAdapter({ "/user/block": {} });
      await adapter.blockUser(lid("lemmy.world", "user", 42), true);
      expect(calls[0].body).toEqual({ person_id: 42, block: true });
    });
  });
});
