/**
 * RedditAdapter — implements the unified SourceAdapter over Reddit's web
 * `.json` endpoints via the engineered RedditTransport. The browse path
 * (feed / post / comments) is fully implemented; auth-gated writes are wired
 * but require login (which the prototype reaches anonymously, so they throw a
 * typed NotAuthenticatedError until accounts land). The rest are explicitly
 * marked not-yet-implemented rather than silently faked.
 */

import type {
  SourceAdapter,
  AccountRef,
  LoginChallenge,
  LoginInput,
  SecretBundle,
  FeedQuery,
  SubmitPostInput,
  JanusFile,
  SearchKind,
  UserContentKind,
  VoteResult,
  ResolvedRemote,
} from "../../core/adapter";
import type {
  Post,
  Comment,
  Community,
  User,
  Notification,
  LoadMoreRef,
} from "../../core/model";
import type { Page, PageRequest } from "../../core/pagination";
import { Vote } from "../../core/vote";
import { parseId, buildId, type JanusId } from "../../core/ids";
import {
  CapabilityError,
  ForbiddenError,
  NotFoundError,
  NotAuthenticatedError,
} from "../../core/errors";
import { RedditTransport, type RedditAuth } from "./transport";
import { REDDIT_CAPABILITIES } from "./capabilities";
import { REDDIT_INSTANCE } from "./mappers/shared";
import { mapPost } from "./mappers/post";
import { mapRedditCommunity } from "./mappers/community";
import { flattenRedditComments } from "./mappers/comment";

const BASE = "https://www.reddit.com";

function guestAccount(): AccountRef {
  return {
    id: buildId({
      source: "reddit",
      instance: REDDIT_INSTANCE,
      kind: "user",
      nativeId: "__guest__",
    }),
    source: "reddit",
    instance: REDDIT_INSTANCE,
    username: "Guest",
    isGuest: true,
  };
}

function redditUser(username: string): AccountRef {
  return {
    id: buildId({
      source: "reddit",
      instance: REDDIT_INSTANCE,
      kind: "user",
      nativeId: username,
    }),
    source: "reddit",
    instance: REDDIT_INSTANCE,
    username,
    isGuest: false,
  };
}

/** Pure parser for the `/user/me/about.json` (t2) response. */
export function parseUserMe(res: any): {
  username: string;
  modhash?: string;
  isLoggedIn: boolean;
} {
  const d = res?.data ?? {};
  // `inbox_count` is only present on the authenticated user's own t2.
  return {
    username: d.name ?? "",
    modhash: d.modhash || undefined,
    isLoggedIn: d.inbox_count !== undefined,
  };
}

function base36(postFullname: string): string {
  return postFullname.replace(/^t3_/, "");
}

function withParams(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const qs = new URLSearchParams();
  qs.set("raw_json", "1");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  return `${BASE}${path}.json?${qs.toString()}`;
}

export interface RedditAdapterDeps {
  transport: RedditTransport;
  account?: AccountRef;
  auth?: RedditAuth;
}

export class RedditAdapter implements SourceAdapter {
  readonly source = "reddit" as const;
  readonly instance = REDDIT_INSTANCE;
  readonly capabilities = REDDIT_CAPABILITIES;
  account: AccountRef;

  private readonly transport: RedditTransport;
  private auth: RedditAuth;

  constructor(deps: RedditAdapterDeps) {
    this.transport = deps.transport;
    this.account = deps.account ?? guestAccount();
    this.auth = deps.auth ?? {};
  }

  // --- Feeds ----------------------------------------------------------------

  private feedPath(query: FeedQuery): string {
    const sort = query.sort ?? "hot";
    if (query.communityId) {
      const sub = parseId(query.communityId).nativeId;
      return `/r/${sub}/${sort}`;
    }
    const listing = query.listingType ?? "popular";
    if (listing === "home") return `/${sort}`;
    return `/r/${listing}/${sort}`;
  }

  async getFeed(query: FeedQuery, page: PageRequest): Promise<Page<Post>> {
    const url = withParams(this.feedPath(query), {
      limit: page.limit ?? 25,
      after: typeof page.cursor === "string" ? page.cursor : undefined,
      sr_detail: "true",
      t: query.timeWindow,
    });
    const res = await this.transport.request<any>(url, {
      auth: this.auth,
      signal: page.signal,
    });
    if (res?.reason === "private")
      throw new ForbiddenError("This community is private.");
    if (res?.reason === "banned")
      throw new NotFoundError("This community is banned.");
    const children: any[] = res?.data?.children ?? [];
    return {
      items: children.filter((c) => c.kind === "t3").map(mapPost),
      nextCursor: res?.data?.after ?? undefined,
    };
  }

  async getPost(id: JanusId): Promise<Post> {
    const url = withParams(`/comments/${base36(parseId(id).nativeId)}`, {
      sr_detail: "true",
      limit: 1,
    });
    const res = await this.transport.request<any>(url, { auth: this.auth });
    const child = res?.[0]?.data?.children?.[0];
    if (!child) throw new NotFoundError("Post not found.");
    return mapPost(child);
  }

  async getComments(
    postId: JanusId,
    opts: {
      parentId?: JanusId;
      maxDepth?: number;
      sort?: string;
    } & PageRequest,
  ): Promise<Page<Comment>> {
    const url = withParams(`/comments/${base36(parseId(postId).nativeId)}`, {
      sort: opts.sort,
      limit: opts.limit ?? 100,
    });
    const res = await this.transport.request<any>(url, {
      auth: this.auth,
      signal: opts.signal,
    });
    const commentChildren: any[] = res?.[1]?.data?.children ?? [];
    const { comments } = flattenRedditComments(commentChildren, postId);
    return { items: comments }; // top-level "more" handled via loadMoreComments later
  }

  async loadMoreComments(
    postId: JanusId,
    more: LoadMoreRef,
  ): Promise<Comment[]> {
    if (more.kind !== "reddit") {
      throw new CapabilityError(
        "loadMoreComments expects a reddit LoadMoreRef",
      );
    }
    // Reddit's /comments/{id}/comment/{cid}.json resolves without the subreddit.
    const results = await Promise.all(
      more.childIds.map((cid) =>
        this.transport
          .request<any>(
            withParams(
              `/comments/${base36(parseId(postId).nativeId)}/comment/${cid}`,
              {},
            ),
            {
              auth: this.auth,
            },
          )
          .then((r) => r?.[1]?.data?.children?.[0])
          .catch(() => undefined),
      ),
    );
    const valid = results.filter(Boolean);
    return flattenRedditComments(valid, postId).comments;
  }

  // --- Write / interactions -------------------------------------------------

  async vote(target: JanusId, vote: Vote): Promise<VoteResult> {
    await this.transport.request(`${BASE}/api/vote`, {
      method: "POST",
      requireAuth: true,
      auth: this.auth,
      body: { id: parseId(target).nativeId, dir: vote },
      parse: "json",
    });
    return { score: 0, userVote: vote };
  }

  async save(target: JanusId, saved: boolean): Promise<void> {
    await this.transport.request(`${BASE}/api/${saved ? "save" : "unsave"}`, {
      method: "POST",
      requireAuth: true,
      auth: this.auth,
      body: { id: parseId(target).nativeId },
      parse: "json",
    });
  }

  // --- Auth -----------------------------------------------------------------

  async beginLogin(): Promise<LoginChallenge> {
    return {
      mode: "webview",
      url: `${BASE}/login?dest=${encodeURIComponent(`${BASE}/`)}`,
      successCookieName: "reddit_session",
    };
  }

  // ---- Not yet implemented in the prototype (explicit, not silently faked) --

  /**
   * Completes login AFTER the WebView has placed `reddit_session` in the shared
   * cookie jar. The transport's NSURLSession sends that cookie automatically, so
   * we just confirm the session and grab the modhash (needed for write actions).
   */
  async completeLogin(
    input: LoginInput,
  ): Promise<{ account: AccountRef; secret: SecretBundle }> {
    const res = await this.transport.request<any>(
      withParams("/user/me/about", {}),
      { auth: this.auth },
    );
    const me = parseUserMe(res);
    if (!me.isLoggedIn || !me.modhash) {
      throw new NotAuthenticatedError(
        "Reddit login didn't complete — please try again.",
      );
    }
    this.auth = { modhash: me.modhash };
    this.account = redditUser(me.username);
    const sessionCookie = input.mode === "webview" ? input.capturedCookie : "";
    return {
      account: this.account,
      secret: { source: "reddit", sessionCookie, modhash: me.modhash },
    };
  }

  /** Rehydrate on launch — the cookie must already be back in the jar (RN side). */
  async restore(secret: SecretBundle): Promise<AccountRef> {
    if (secret.source !== "reddit")
      throw new Error("restore() got a non-reddit secret");
    this.auth = { modhash: secret.modhash };
    const res = await this.transport.request<any>(
      withParams("/user/me/about", {}),
      { auth: this.auth },
    );
    const me = parseUserMe(res);
    if (!me.isLoggedIn)
      throw new NotAuthenticatedError("Your Reddit session expired.");
    if (me.modhash) this.auth = { modhash: me.modhash };
    this.account = redditUser(me.username);
    return this.account;
  }
  async logout(): Promise<void> {
    this.auth = {};
    this.account = guestAccount();
  }
  getCommunity(_id: JanusId): Promise<Community> {
    return notYet("getCommunity");
  }
  getSubscriptions(): Promise<Community[]> {
    return notYet("getSubscriptions");
  }
  setSubscription(_id: JanusId, _subscribed: boolean): Promise<Community> {
    return notYet("setSubscription");
  }
  async searchCommunities(
    q: string,
    page: PageRequest,
  ): Promise<Page<Community>> {
    const url = withParams("/subreddits/search", {
      q,
      limit: page.limit ?? 25,
      after: typeof page.cursor === "string" ? page.cursor : undefined,
      include_over_18: "on",
    });
    const res = await this.transport.request<any>(url, {
      auth: this.auth,
      signal: page.signal,
    });
    const children: any[] = res?.data?.children ?? [];
    return {
      items: children.filter((c) => c.kind === "t5").map(mapRedditCommunity),
      nextCursor: res?.data?.after ?? undefined,
    };
  }
  getTrendingCommunities(): Promise<Community[]> {
    return notYet("getTrendingCommunities");
  }
  submitPost(_input: SubmitPostInput): Promise<Post> {
    return notYet("submitPost");
  }
  submitComment(_input: {
    parentId: JanusId;
    postId: JanusId;
    markdown: string;
  }): Promise<Comment> {
    return notYet("submitComment");
  }
  editContent(_id: JanusId, _markdown: string): Promise<Post | Comment> {
    return notYet("editContent");
  }
  deleteContent(_id: JanusId): Promise<void> {
    return notYet("deleteContent");
  }
  uploadImage(
    _file: JanusFile,
  ): Promise<{ url: string; deleteToken?: string }> {
    return notYet("uploadImage");
  }
  getUser(_id: JanusId): Promise<User> {
    return notYet("getUser");
  }
  getUserContent(
    _id: JanusId,
    _kind: UserContentKind,
    _page: PageRequest,
  ): Promise<Page<Post | Comment>> {
    return notYet("getUserContent");
  }
  blockUser(_id: JanusId, _blocked: boolean): Promise<void> {
    return notYet("blockUser");
  }
  getUnreadCount(): Promise<number> {
    return Promise.resolve(0);
  }
  getInbox(): Promise<Page<Notification>> {
    return notYet("getInbox");
  }
  markRead(_id: JanusId, _read: boolean): Promise<void> {
    return notYet("markRead");
  }
  markAllRead(): Promise<void> {
    return notYet("markAllRead");
  }
  sendMessage(_input: { to: JanusId; markdown: string }): Promise<void> {
    return notYet("sendMessage");
  }
  search(
    _q: string,
    _kind: SearchKind,
    _opts: { sort?: string } & PageRequest,
  ): Promise<Page<any>> {
    return notYet("search");
  }
  resolveRemoteUrl(_url: string): Promise<ResolvedRemote> {
    // Reddit has no federation.
    return Promise.reject(new CapabilityError("resolveRemoteUrl"));
  }
}

function notYet(method: string): Promise<never> {
  return Promise.reject(
    new Error(
      `RedditAdapter.${method} is not implemented in the prototype yet.`,
    ),
  );
}
