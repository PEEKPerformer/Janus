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
  Conversation,
  DirectMessage,
  LoadMoreRef,
} from "../../core/model";
import type { Page, PageRequest } from "../../core/pagination";
import { Vote } from "../../core/vote";
import { parseId, buildId, type JanusId } from "../../core/ids";
import {
  CapabilityError,
  ForbiddenError,
  NetworkError,
  NotFoundError,
  NotAuthenticatedError,
} from "../../core/errors";
import { RedditTransport, type RedditAuth } from "./transport";
import { REDDIT_CAPABILITIES } from "./capabilities";
import { REDDIT_INSTANCE, rid } from "./mappers/shared";
import { mapPost } from "./mappers/post";
import { mapRedditCommunity } from "./mappers/community";
import { mapRedditUser } from "./mappers/user";
import { mapRedditNotification } from "./mappers/notification";
import {
  flattenRedditMessages,
  mapRedditMessage,
  groupConversations,
  threadWith,
} from "./mappers/message";
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

/** Multipart-capable fetch for the S3 media upload (injectable for tests). */
export type RedditUploadFetch = (
  url: string,
  init: { method: string; body: FormData },
) => Promise<{ ok: boolean; status: number }>;

export interface RedditAdapterDeps {
  transport: RedditTransport;
  account?: AccountRef;
  auth?: RedditAuth;
  /** Multipart upload fetch (defaults to global fetch); injectable for tests. */
  uploadFetch?: RedditUploadFetch;
}

export class RedditAdapter implements SourceAdapter {
  readonly source = "reddit" as const;
  readonly instance = REDDIT_INSTANCE;
  readonly capabilities = REDDIT_CAPABILITIES;
  account: AccountRef;

  private readonly transport: RedditTransport;
  private auth: RedditAuth;
  private readonly uploadFetch: RedditUploadFetch;

  constructor(deps: RedditAdapterDeps) {
    this.transport = deps.transport;
    this.account = deps.account ?? guestAccount();
    this.auth = deps.auth ?? {};
    this.uploadFetch =
      deps.uploadFetch ??
      ((url, init) =>
        fetch(url, init) as Promise<{ ok: boolean; status: number }>);
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
  async getCommunity(id: JanusId): Promise<Community> {
    const name = parseId(id).nativeId;
    const res = await this.transport.request<any>(
      withParams(`/r/${name}/about`, {}),
      { auth: this.auth },
    );
    if (!res || res.kind !== "t5")
      throw new NotFoundError("Community not found.");
    return mapRedditCommunity(res);
  }

  async getSubscriptions(): Promise<Community[]> {
    // Reddit caps each page at 100 and returns an `after` cursor; a single
    // request silently truncates users with more subs (the "some show, some
    // don't" bug). Page through until exhausted (bounded so a misbehaving
    // cursor can't loop forever).
    const all: Community[] = [];
    let after: string | undefined;
    for (let i = 0; i < 20; i++) {
      const res = await this.transport.request<any>(
        withParams("/subreddits/mine/subscriber", { limit: 100, after }),
        { requireAuth: true, auth: this.auth },
      );
      const children: any[] = res?.data?.children ?? [];
      for (const c of children) {
        if (c.kind === "t5") all.push(mapRedditCommunity(c));
      }
      after = res?.data?.after ?? undefined;
      if (!after || children.length === 0) break;
    }
    return all.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  }

  async setSubscription(id: JanusId, subscribed: boolean): Promise<Community> {
    const name = parseId(id).nativeId;
    await this.transport.request(`${BASE}/api/subscribe`, {
      method: "POST",
      requireAuth: true,
      auth: this.auth,
      body: { action: subscribed ? "sub" : "unsub", sr_name: name },
      parse: "json",
    });
    return this.getCommunity(id);
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
  async getTrendingCommunities(): Promise<Community[]> {
    const res = await this.transport.request<any>(
      withParams("/subreddits/popular", { limit: 25 }),
      { auth: this.auth },
    );
    const children: any[] = res?.data?.children ?? [];
    return children.filter((c) => c.kind === "t5").map(mapRedditCommunity);
  }
  async submitPost(input: SubmitPostInput): Promise<Post> {
    const sr = parseId(input.communityId).nativeId;
    // Reddit's submit kinds: self / link / image. Image posts carry the
    // uploaded i.redd.it (S3) URL from uploadImage in `url`.
    const kind =
      input.kind === "self" ? "self" : input.kind === "image" ? "image" : "link";
    const res = await this.transport.request<any>(`${BASE}/api/submit`, {
      method: "POST",
      requireAuth: true,
      auth: this.auth,
      body: {
        api_type: "json",
        sr,
        kind,
        title: input.title,
        text: kind === "self" ? (input.markdown ?? "") : undefined,
        url: kind === "self" ? undefined : (input.url ?? input.imageRef),
        nsfw: input.nsfw ? "true" : "false",
        resubmit: "true",
      },
      parse: "json",
    });
    const errs = res?.json?.errors;
    if (Array.isArray(errs) && errs.length) {
      throw new NotFoundError(
        `Reddit rejected the post: ${errs[0]?.[1] ?? "unknown error"}`,
      );
    }
    const fullname: string | undefined = res?.json?.data?.name;
    if (!fullname)
      throw new NotFoundError("Reddit didn't return the new post.");
    return this.getPost(rid("post", fullname));
  }

  async submitComment(input: {
    parentId: JanusId;
    postId: JanusId;
    markdown: string;
  }): Promise<Comment> {
    const res = await this.transport.request<any>(`${BASE}/api/comment`, {
      method: "POST",
      requireAuth: true,
      auth: this.auth,
      body: {
        api_type: "json",
        thing_id: parseId(input.parentId).nativeId,
        text: input.markdown,
      },
      parse: "json",
    });
    const errs = res?.json?.errors;
    if (Array.isArray(errs) && errs.length) {
      throw new NotFoundError(
        `Reddit rejected the comment: ${errs[0]?.[1] ?? "unknown error"}`,
      );
    }
    const thing = res?.json?.data?.things?.[0];
    if (!thing || thing.kind !== "t1")
      throw new NotFoundError("Reddit didn't return the new comment.");
    const { comments } = flattenRedditComments([thing], input.postId);
    if (!comments.length)
      throw new NotFoundError("Could not map the new comment.");
    return comments[0];
  }
  async editContent(id: JanusId, markdown: string): Promise<Post | Comment> {
    const res = await this.transport.request<any>(`${BASE}/api/editusertext`, {
      method: "POST",
      requireAuth: true,
      auth: this.auth,
      body: {
        api_type: "json",
        thing_id: parseId(id).nativeId,
        text: markdown,
      },
      parse: "json",
    });
    const errs = res?.json?.errors;
    if (Array.isArray(errs) && errs.length) {
      throw new NotFoundError(
        `Reddit rejected the edit: ${errs[0]?.[1] ?? "unknown error"}`,
      );
    }
    const thing = res?.json?.data?.things?.[0];
    if (!thing)
      throw new NotFoundError("Reddit didn't return the edited content.");
    if (thing.kind === "t3") return mapPost(thing);
    const postId = rid("post", thing.data?.link_id ?? "t3_unknown");
    const { comments } = flattenRedditComments([thing], postId);
    if (!comments.length)
      throw new NotFoundError("Could not map the edited comment.");
    return comments[0];
  }

  async deleteContent(id: JanusId): Promise<void> {
    await this.transport.request(`${BASE}/api/del`, {
      method: "POST",
      requireAuth: true,
      auth: this.auth,
      body: { id: parseId(id).nativeId },
      parse: "json",
    });
  }
  /**
   * Reddit's two-step media upload: lease an S3 slot via `/api/media/asset.json`
   * (returns a presigned POST policy), then multipart-POST the file to S3. The
   * public i.redd.it-style URL is `<action>/<key>`, which submitPost(kind:image)
   * then posts. Needs an authenticated (modhash) session.
   */
  async uploadImage(
    file: JanusFile,
  ): Promise<{ url: string; deleteToken?: string }> {
    if (!this.auth.modhash) throw new NotAuthenticatedError();
    const lease = await this.transport.request<any>(
      `${BASE}/api/media/asset.json`,
      {
        method: "POST",
        requireAuth: true,
        auth: this.auth,
        body: { filepath: file.name, mimetype: file.mimeType },
        parse: "json",
      },
    );
    const action: string | undefined = lease?.args?.action;
    const fields: { name: string; value: string }[] = lease?.args?.fields ?? [];
    if (!action || fields.length === 0) {
      throw new NetworkError("Reddit didn't grant an upload lease.");
    }
    // `action` is protocol-relative ("//bucket.s3.amazonaws.com").
    const uploadUrl = action.startsWith("http") ? action : `https:${action}`;
    const form = new FormData();
    for (const f of fields) form.append(f.name, f.value);
    form.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as unknown as Blob);
    const res = await this.uploadFetch(uploadUrl, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      throw new NetworkError(`Image upload failed (HTTP ${res.status}).`);
    }
    const key = fields.find((f) => f.name === "key")?.value;
    if (!key) throw new NetworkError("Reddit upload response was missing a key.");
    return { url: `${uploadUrl}/${key}` };
  }
  async getUser(id: JanusId): Promise<User> {
    const name = parseId(id).nativeId;
    const res = await this.transport.request<any>(
      withParams(`/user/${name}/about`, {}),
      { auth: this.auth },
    );
    if (!res || res.kind !== "t2") throw new NotFoundError("User not found.");
    return mapRedditUser(res);
  }

  async getUserContent(
    id: JanusId,
    kind: UserContentKind,
    page: PageRequest,
  ): Promise<Page<Post | Comment>> {
    const name = parseId(id).nativeId;
    const section =
      kind === "posts"
        ? "submitted"
        : kind === "comments"
          ? "comments"
          : kind === "saved"
            ? "saved"
            : "overview";
    const url = withParams(`/user/${name}/${section}`, {
      limit: page.limit ?? 25,
      after: typeof page.cursor === "string" ? page.cursor : undefined,
      sr_detail: "true",
    });
    const res = await this.transport.request<any>(url, {
      auth: this.auth,
      signal: page.signal,
    });
    const children: any[] = res?.data?.children ?? [];
    const items: (Post | Comment)[] = [];
    for (const child of children) {
      if (child.kind === "t3") items.push(mapPost(child));
      else if (child.kind === "t1") {
        const postId = rid("post", child.data?.link_id ?? "t3_unknown");
        const { comments } = flattenRedditComments([child], postId);
        if (comments.length) items.push(comments[0]);
      }
    }
    return { items, nextCursor: res?.data?.after ?? undefined };
  }
  async blockUser(id: JanusId, blocked: boolean): Promise<void> {
    const name = parseId(id).nativeId;
    await this.transport.request(
      `${BASE}/api/${blocked ? "block_user" : "unfriend"}`,
      {
        method: "POST",
        requireAuth: true,
        auth: this.auth,
        body: blocked ? { name } : { name, type: "enemy" },
        parse: "json",
      },
    );
  }

  async getUnreadCount(): Promise<number> {
    if (!this.auth.modhash) return 0;
    try {
      const res = await this.transport.request<any>(
        withParams("/message/unread", { limit: 100 }),
        { auth: this.auth },
      );
      return (res?.data?.children ?? []).length;
    } catch {
      return 0;
    }
  }

  async getInbox(
    filter: "all" | "replies" | "mentions" | "messages",
    page: PageRequest,
  ): Promise<Page<Notification>> {
    const section =
      filter === "replies"
        ? "comments"
        : filter === "mentions"
          ? "mentions"
          : filter === "messages"
            ? "messages"
            : "inbox";
    const url = withParams(`/message/${section}`, {
      limit: page.limit ?? 25,
      after: typeof page.cursor === "string" ? page.cursor : undefined,
    });
    const res = await this.transport.request<any>(url, {
      requireAuth: true,
      auth: this.auth,
      signal: page.signal,
    });
    const children: any[] = res?.data?.children ?? [];
    return {
      items: children.map((c) => mapRedditNotification(c)),
      nextCursor: res?.data?.after ?? undefined,
    };
  }

  async markRead(id: JanusId, read: boolean): Promise<void> {
    await this.transport.request(
      `${BASE}/api/${read ? "read_message" : "unread_message"}`,
      {
        method: "POST",
        requireAuth: true,
        auth: this.auth,
        body: { id: parseId(id).nativeId },
        parse: "json",
      },
    );
  }

  async markAllRead(): Promise<void> {
    await this.transport.request(`${BASE}/api/read_all_messages`, {
      method: "POST",
      requireAuth: true,
      auth: this.auth,
      parse: "json",
    });
  }

  async sendMessage(input: { to: JanusId; markdown: string }): Promise<void> {
    await this.transport.request(`${BASE}/api/compose`, {
      method: "POST",
      requireAuth: true,
      auth: this.auth,
      body: {
        api_type: "json",
        to: parseId(input.to).nativeId,
        subject: "message",
        text: input.markdown,
      },
      parse: "json",
    });
  }
  /** Raw `/message/messages` thread listing → flat, mapped DirectMessage[]. */
  private async fetchMessages(page: PageRequest): Promise<{
    messages: DirectMessage[];
    nextCursor?: string;
  }> {
    const me = this.account.username;
    const url = withParams("/message/messages", {
      limit: page.limit ?? 50,
      after: typeof page.cursor === "string" ? page.cursor : undefined,
    });
    const res = await this.transport.request<any>(url, {
      requireAuth: true,
      auth: this.auth,
      signal: page.signal,
    });
    const children: any[] = res?.data?.children ?? [];
    const messages = flattenRedditMessages(children).map((d) =>
      mapRedditMessage(d, me),
    );
    return { messages, nextCursor: res?.data?.after ?? undefined };
  }

  async getConversations(page: PageRequest): Promise<Page<Conversation>> {
    const { messages, nextCursor } = await this.fetchMessages(page);
    return { items: groupConversations(messages), nextCursor };
  }

  async getMessageThread(
    correspondentId: JanusId,
    page: PageRequest,
  ): Promise<Page<DirectMessage>> {
    const name = parseId(correspondentId).nativeId;
    const { messages, nextCursor } = await this.fetchMessages(page);
    return { items: threadWith(messages, name), nextCursor };
  }

  async search(
    q: string,
    kind: SearchKind,
    opts: { sort?: string } & PageRequest,
  ): Promise<Page<any>> {
    if (kind === "communities") {
      return this.searchCommunities(q, opts);
    }
    if (kind === "users") {
      const url = withParams("/users/search", {
        q,
        limit: opts.limit ?? 25,
        after: typeof opts.cursor === "string" ? opts.cursor : undefined,
      });
      const res = await this.transport.request<any>(url, {
        auth: this.auth,
        signal: opts.signal,
      });
      const children: any[] = res?.data?.children ?? [];
      return {
        items: children
          .filter((c) => c.kind === "t2")
          .map((c) => mapRedditUser(c.data)),
        nextCursor: res?.data?.after ?? undefined,
      };
    }
    const url = withParams("/search", {
      q,
      sort: opts.sort ?? "relevance",
      limit: opts.limit ?? 25,
      after: typeof opts.cursor === "string" ? opts.cursor : undefined,
      type: "link",
      sr_detail: "true",
    });
    const res = await this.transport.request<any>(url, {
      auth: this.auth,
      signal: opts.signal,
    });
    const children: any[] = res?.data?.children ?? [];
    return {
      items: children.filter((c) => c.kind === "t3").map(mapPost),
      nextCursor: res?.data?.after ?? undefined,
    };
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
