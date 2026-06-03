/**
 * LemmyAdapter — implements the unified SourceAdapter over Lemmy's v3 REST API.
 * The browse path (feed / post / comments) + community lookup + federation
 * resolve are fully implemented and work anonymously. Writes (vote/save/etc.)
 * require a JWT and throw a typed NotAuthenticatedError until accounts land.
 *
 * Hits the documented v3 API directly via an injectable `fetchJson` (pure +
 * testable). Behind the SourceAdapter boundary this is swappable for the
 * `threadiverse` client later (for Lemmy v0/v1/PieFed) with no UI changes.
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
import { parseId, buildId, dedupKey, type JanusId } from "../../core/ids";
import {
  CapabilityError,
  NetworkError,
  NotAuthenticatedError,
  NotFoundError,
} from "../../core/errors";
import { LEMMY_CAPABILITIES } from "./capabilities";
import {
  mapLemmyPost,
  mapLemmyComment,
  mapLemmyCommunity,
  mapLemmyPerson,
  lid,
  handle,
  lemmyTime,
  markdown,
  LEMMY_SOURCE,
} from "./mappers";

/** Public URL for a pict-rs upload result. */
export function pictrsUrl(instance: string, file: string): string {
  return `https://${instance}/pictrs/image/${file}`;
}

/** Minimal multipart-capable fetch (global fetch by default; injectable for tests). */
export type UploadFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData },
) => Promise<{ json: () => Promise<any> }>;

export interface FetchJsonInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export type FetchJson = (url: string, init?: FetchJsonInit) => Promise<any>;

export interface LemmyAdapterDeps {
  instance: string; // e.g. "lemmy.world"
  fetchJson: FetchJson;
  account?: AccountRef;
  jwt?: string;
  /** Multipart upload fetch (defaults to global fetch); injectable for tests. */
  uploadFetch?: UploadFetch;
}

/** unified feed sort id (+ time window) -> Lemmy SortType. */
function lemmySort(sort?: string, timeWindow?: string): string {
  switch (sort) {
    case "hot":
      return "Hot";
    case "new":
      return "New";
    case "mostcomments":
      return "MostComments";
    case "controversial":
      return "Controversial";
    case "scaled":
      return "Scaled";
    case "top": {
      const map: Record<string, string> = {
        hour: "TopHour",
        day: "TopDay",
        week: "TopWeek",
        month: "TopMonth",
        year: "TopYear",
        all: "TopAll",
      };
      return map[timeWindow ?? "day"] ?? "TopDay";
    }
    default:
      return "Active";
  }
}

function guestAccount(instance: string): AccountRef {
  return {
    id: buildId({
      source: "lemmy",
      instance,
      kind: "user",
      nativeId: "__guest__",
    }),
    source: "lemmy",
    instance,
    username: "Guest",
    isGuest: true,
  };
}

export class LemmyAdapter implements SourceAdapter {
  readonly source = "lemmy" as const;
  readonly instance: string;
  readonly capabilities = LEMMY_CAPABILITIES;
  account: AccountRef;

  private readonly fetchJson: FetchJson;
  private readonly uploadFetch: UploadFetch;
  private jwt?: string;
  private readonly base: string;
  private downvotesEnabled?: boolean; // cached from /site
  private customEmojis?: import("../../core/model").CustomEmoji[]; // cached from /site

  constructor(deps: LemmyAdapterDeps) {
    this.instance = deps.instance;
    this.fetchJson = deps.fetchJson;
    this.uploadFetch =
      deps.uploadFetch ??
      ((url, init) =>
        fetch(url, init) as Promise<{ json: () => Promise<any> }>);
    this.jwt = deps.jwt;
    this.account = deps.account ?? guestAccount(deps.instance);
    this.base = `https://${deps.instance}/api/v3`;
  }

  private url(
    path: string,
    params: Record<string, string | number | undefined>,
  ): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    const q = qs.toString();
    return `${this.base}${path}${q ? `?${q}` : ""}`;
  }

  private authHeaders(): Record<string, string> {
    return this.jwt ? { Authorization: `Bearer ${this.jwt}` } : {};
  }

  private requireJwt(): string {
    if (!this.jwt)
      throw new NotAuthenticatedError("Log in to a Lemmy account to do that.");
    return this.jwt;
  }

  /** Authenticated POST of a JSON body to a v3 endpoint. */
  private async authedPost(path: string, body: object): Promise<any> {
    this.requireJwt();
    return this.fetchJson(`${this.base}${path}`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // --- Feeds ----------------------------------------------------------------

  async getFeed(query: FeedQuery, page: PageRequest): Promise<Page<Post>> {
    const params: Record<string, string | number | undefined> = {
      sort: lemmySort(query.sort, query.timeWindow),
      type_: query.listingType ?? "All",
      limit: page.limit ?? 25,
      page_cursor: typeof page.cursor === "string" ? page.cursor : undefined,
    };
    if (query.communityId)
      params.community_id = parseId(query.communityId).nativeId;
    const res = await this.fetchJson(this.url("/post/list", params), {
      headers: this.authHeaders(),
      signal: page.signal,
    });
    const posts: any[] = res?.posts ?? [];
    return {
      items: posts.map((pv) => mapLemmyPost(pv, this.instance)),
      nextCursor: res?.next_page ?? undefined,
    };
  }

  async getPost(id: JanusId): Promise<Post> {
    const res = await this.fetchJson(
      this.url("/post", { id: parseId(id).nativeId }),
      {
        headers: this.authHeaders(),
      },
    );
    if (!res?.post_view) throw new NotFoundError("Post not found.");
    return mapLemmyPost(res.post_view, this.instance);
  }

  async getComments(
    postId: JanusId,
    opts: {
      parentId?: JanusId;
      maxDepth?: number;
      sort?: string;
    } & PageRequest,
  ): Promise<Page<Comment>> {
    const res = await this.fetchJson(
      this.url("/comment/list", {
        post_id: parseId(postId).nativeId,
        max_depth: opts.maxDepth ?? 8,
        sort: opts.sort ?? "Hot",
        type_: "All",
        limit: opts.limit ?? 50,
      }),
      { headers: this.authHeaders(), signal: opts.signal },
    );
    const comments: any[] = res?.comments ?? [];
    // Already flat with `path`; the mapper derives parentId/depth and the core
    // CommentTree builder nests them — same path as Reddit.
    return {
      items: comments.map((cv) => mapLemmyComment(cv, postId, this.instance)),
    };
  }

  async loadMoreComments(
    postId: JanusId,
    more: LoadMoreRef,
  ): Promise<Comment[]> {
    if (more.kind !== "lemmy-subtree") {
      throw new CapabilityError("loadMoreComments expects a lemmy LoadMoreRef");
    }
    const res = await this.fetchJson(
      this.url("/comment/list", {
        post_id: parseId(postId).nativeId,
        parent_id: more.parentId,
        max_depth: 8,
        type_: "All",
      }),
      { headers: this.authHeaders() },
    );
    const comments: any[] = res?.comments ?? [];
    return comments.map((cv) => mapLemmyComment(cv, postId, this.instance));
  }

  // --- Communities ----------------------------------------------------------

  async getCommunity(id: JanusId): Promise<Community> {
    const res = await this.fetchJson(
      this.url("/community", { id: parseId(id).nativeId }),
      {
        headers: this.authHeaders(),
      },
    );
    if (!res?.community_view) throw new NotFoundError("Community not found.");
    return mapLemmyCommunity(res.community_view, this.instance);
  }

  async searchCommunities(
    q: string,
    page: PageRequest,
  ): Promise<Page<Community>> {
    const res = await this.fetchJson(
      this.url("/search", { q, type_: "Communities", limit: page.limit ?? 25 }),
      { headers: this.authHeaders(), signal: page.signal },
    );
    const communities: any[] = res?.communities ?? [];
    return {
      items: communities.map((cv) => mapLemmyCommunity(cv, this.instance)),
    };
  }

  async getUser(id: JanusId): Promise<User> {
    const res = await this.fetchJson(
      this.url("/user", { person_id: parseId(id).nativeId }),
      {
        headers: this.authHeaders(),
      },
    );
    if (!res?.person_view) throw new NotFoundError("User not found.");
    return mapLemmyPerson(res.person_view, this.instance);
  }

  // --- Federation -----------------------------------------------------------

  async resolveRemoteUrl(url: string): Promise<ResolvedRemote> {
    const res = await this.fetchJson(this.url("/resolve_object", { q: url }), {
      headers: this.authHeaders(),
    });
    if (res?.post)
      return { kind: "post", id: lid(this.instance, "post", res.post.post.id) };
    if (res?.comment)
      return {
        kind: "comment",
        id: lid(this.instance, "comment", res.comment.comment.id),
      };
    if (res?.community)
      return {
        kind: "community",
        id: lid(this.instance, "community", res.community.community.id),
      };
    if (res?.person)
      return {
        kind: "user",
        id: lid(this.instance, "user", res.person.person.id),
      };
    throw new NotFoundError("Could not resolve that URL.");
  }

  // --- Write (require JWT) --------------------------------------------------

  async vote(target: JanusId, vote: Vote): Promise<VoteResult> {
    this.requireJwt();
    const { kind, nativeId } = parseId(target);
    const path = kind === "comment" ? "/comment/like" : "/post/like";
    const body =
      kind === "comment"
        ? { comment_id: Number(nativeId), score: vote }
        : { post_id: Number(nativeId), score: vote };
    const res = await this.fetchJson(`${this.base}${path}`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const view = res?.post_view ?? res?.comment_view;
    return { score: view?.counts?.score ?? 0, userVote: vote };
  }

  async save(target: JanusId, saved: boolean): Promise<void> {
    const { kind, nativeId } = parseId(target);
    if (kind === "comment") {
      await this.authedPost("/comment/save", {
        comment_id: Number(nativeId),
        save: saved,
      });
    } else {
      await this.authedPost("/post/save", {
        post_id: Number(nativeId),
        save: saved,
      });
    }
  }
  async beginLogin(opts: { instance: string }): Promise<LoginChallenge> {
    void opts;
    // TOTP is optional and only known to be required after a first attempt
    // fails (Lemmy doesn't advertise it up front), so the modal always shows
    // the field as optional — same UX as Voyager.
    return { mode: "credentials", needsTotp: false };
  }

  /**
   * Username/email + password (+ optional TOTP) -> JWT, the Voyager flow.
   * Lemmy's POST /user/login returns `{ jwt }` on success. A missing jwt means
   * the credentials were rejected or a 2FA token is required; we surface that
   * as a typed error the modal can show. With the JWT in hand we hit /site to
   * learn who we are and build the AccountRef.
   */
  async completeLogin(
    input: LoginInput,
  ): Promise<{ account: AccountRef; secret: SecretBundle }> {
    if (input.mode !== "credentials") {
      throw new CapabilityError("Lemmy login expects username and password.");
    }
    let res: any;
    try {
      res = await this.fetchJson(`${this.base}/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username_or_email: input.usernameOrEmail.trim(),
          password: input.password,
          totp_2fa_token: input.totp || undefined,
        }),
      });
    } catch (e) {
      // Lemmy returns 400 with { error: "missing_totp_token" | "incorrect_login" | ... }
      const msg = e instanceof Error ? e.message : "";
      if (/totp/i.test(msg))
        throw new NotAuthenticatedError("Enter your 2FA code to continue.");
      if (/incorrect_login|password|not_found/i.test(msg))
        throw new NotAuthenticatedError("Incorrect username or password.");
      throw e;
    }
    const jwt: string | undefined = res?.jwt;
    if (!jwt) {
      if (res?.error && /totp/i.test(String(res.error)))
        throw new NotAuthenticatedError("Enter your 2FA code to continue.");
      throw new NotAuthenticatedError("Incorrect username or password.");
    }
    this.jwt = jwt;
    this.account = await this.fetchIdentity(jwt);
    return { account: this.account, secret: { source: "lemmy", jwt } };
  }

  async restore(secret: SecretBundle): Promise<AccountRef> {
    if (secret.source !== "lemmy")
      throw new CapabilityError("Wrong secret bundle for Lemmy.");
    this.jwt = secret.jwt;
    try {
      this.account = await this.fetchIdentity(secret.jwt);
    } catch {
      // Stale/expired JWT — fall back to guest rather than wedging startup.
      this.jwt = undefined;
      this.account = guestAccount(this.instance);
    }
    return this.account;
  }

  /** GET /site with the JWT -> my_user identity, mapped to an AccountRef. */
  private async fetchIdentity(jwt: string): Promise<AccountRef> {
    const site = await this.fetchJson(this.url("/site", {}), {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    this.downvotesEnabled =
      site?.site_view?.local_site?.enable_downvotes !== false;
    const person = site?.my_user?.local_user_view?.person;
    if (!person?.name)
      throw new NotAuthenticatedError("Could not load your Lemmy account.");
    return {
      id: lid(this.instance, "user", person.id),
      source: "lemmy",
      instance: this.instance,
      username: person.name,
      displayName: person.display_name || undefined,
      avatarUrl: person.avatar || undefined,
      isGuest: false,
    };
  }

  /** Instance custom emoji for the composer picker (cached). */
  async getCustomEmojis(): Promise<import("../../core/model").CustomEmoji[]> {
    if (!this.customEmojis) {
      const site = await this.fetchJson(this.url("/site", {}), {
        headers: this.authHeaders(),
      });
      const raw: any[] = site?.custom_emojis ?? [];
      this.customEmojis = raw.map((row) => {
        const e = row.custom_emoji ?? row;
        const shortcode: string = e.shortcode ?? "";
        const url: string = e.image_url ?? "";
        const keywords: string[] = Array.isArray(row.keywords)
          ? row.keywords
              .map((k: any) => (typeof k === "string" ? k : k.keyword))
              .filter(Boolean)
          : [];
        return {
          shortcode,
          url,
          category: e.category || undefined,
          altText: e.alt_text || undefined,
          keywords,
          markdown: `![${shortcode}](${url} "emoji ${shortcode}")`,
        };
      });
    }
    return this.customEmojis;
  }

  /** Hexbear and some others disable downvotes site-wide; cached from /site. */
  async getDownvotesEnabled(): Promise<boolean> {
    if (this.downvotesEnabled === undefined) {
      try {
        const site = await this.fetchJson(this.url("/site", {}), {
          headers: this.authHeaders(),
        });
        this.downvotesEnabled =
          site?.site_view?.local_site?.enable_downvotes !== false;
      } catch {
        this.downvotesEnabled = true; // fail open
      }
    }
    return this.downvotesEnabled;
  }
  async logout(): Promise<void> {
    this.jwt = undefined;
    this.account = guestAccount(this.instance);
  }
  async getSubscriptions(): Promise<Community[]> {
    this.requireJwt();
    const res = await this.fetchJson(
      this.url("/community/list", {
        type_: "Subscribed",
        limit: 50,
        sort: "TopAll",
      }),
      { headers: this.authHeaders() },
    );
    const communities: any[] = res?.communities ?? [];
    return communities.map((cv) => mapLemmyCommunity(cv, this.instance));
  }

  async setSubscription(id: JanusId, subscribed: boolean): Promise<Community> {
    const res = await this.authedPost("/community/follow", {
      community_id: Number(parseId(id).nativeId),
      follow: subscribed,
    });
    if (!res?.community_view) throw new NotFoundError("Community not found.");
    return mapLemmyCommunity(res.community_view, this.instance);
  }

  async getTrendingCommunities(): Promise<Community[]> {
    const res = await this.fetchJson(
      this.url("/community/list", {
        type_: "Local",
        sort: "ActiveMonthly",
        limit: 20,
      }),
      { headers: this.authHeaders() },
    );
    const communities: any[] = res?.communities ?? [];
    return communities.map((cv) => mapLemmyCommunity(cv, this.instance));
  }

  async submitPost(input: SubmitPostInput): Promise<Post> {
    const body: Record<string, unknown> = {
      name: input.title,
      community_id: Number(parseId(input.communityId).nativeId),
      nsfw: input.nsfw ?? false,
    };
    if (input.markdown) body.body = input.markdown;
    if (input.url) body.url = input.url;
    const res = await this.authedPost("/post", body);
    if (!res?.post_view) throw new NotFoundError("Post was not created.");
    return mapLemmyPost(res.post_view, this.instance);
  }

  async submitComment(input: {
    parentId: JanusId;
    postId: JanusId;
    markdown: string;
  }): Promise<Comment> {
    const parent = parseId(input.parentId);
    const body: Record<string, unknown> = {
      content: input.markdown,
      post_id: Number(parseId(input.postId).nativeId),
    };
    // parentId === the post means a top-level comment; a comment means a reply.
    if (parent.kind === "comment") body.parent_id = Number(parent.nativeId);
    const res = await this.authedPost("/comment", body);
    if (!res?.comment_view) throw new NotFoundError("Comment was not created.");
    return mapLemmyComment(res.comment_view, input.postId, this.instance);
  }
  async editContent(id: JanusId, markdown: string): Promise<Post | Comment> {
    this.requireJwt();
    const { kind, nativeId } = parseId(id);
    if (kind === "comment") {
      const res = await this.fetchJson(`${this.base}/comment`, {
        method: "PUT",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          comment_id: Number(nativeId),
          content: markdown,
        }),
      });
      if (!res?.comment_view) throw new NotFoundError("Comment not found.");
      const postId = lid(
        this.instance,
        "post",
        res.comment_view?.post?.id ?? 0,
      );
      return mapLemmyComment(res.comment_view, postId, this.instance);
    }
    const res = await this.fetchJson(`${this.base}/post`, {
      method: "PUT",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: Number(nativeId), body: markdown }),
    });
    if (!res?.post_view) throw new NotFoundError("Post not found.");
    return mapLemmyPost(res.post_view, this.instance);
  }

  async deleteContent(id: JanusId): Promise<void> {
    const { kind, nativeId } = parseId(id);
    if (kind === "comment") {
      await this.authedPost("/comment/delete", {
        comment_id: Number(nativeId),
        deleted: true,
      });
    } else {
      await this.authedPost("/post/delete", {
        post_id: Number(nativeId),
        deleted: true,
      });
    }
  }
  /**
   * Uploads to the instance's pict-rs store (the Voyager flow). Multipart can't
   * go through the JSON `fetchJson`, so this uses the injected `uploadFetch`
   * (defaults to global fetch) with the bearer token.
   */
  async uploadImage(
    file: JanusFile,
  ): Promise<{ url: string; deleteToken?: string }> {
    const jwt = this.requireJwt();
    const form = new FormData();
    // RN FormData accepts a {uri,name,type} file descriptor (not a DOM File).
    form.append("images[]", {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as unknown as Blob);
    const res = await this.uploadFetch(
      `https://${this.instance}/pictrs/image`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
      },
    );
    const data = await res.json();
    const f = data?.files?.[0];
    if (!f?.file) throw new NetworkError("Image upload failed.");
    return {
      url: pictrsUrl(this.instance, f.file),
      deleteToken: f.delete_token,
    };
  }
  async getUserContent(
    id: JanusId,
    kind: UserContentKind,
    page: PageRequest,
  ): Promise<Page<Post | Comment>> {
    const params: Record<string, string | number | undefined> = {
      person_id: parseId(id).nativeId,
      sort: "New",
      limit: page.limit ?? 25,
      page: typeof page.cursor === "number" ? page.cursor : 1,
    };
    if (kind === "saved") {
      this.requireJwt();
      params.saved_only = "true";
    }
    const res = await this.fetchJson(this.url("/user", params), {
      headers: this.authHeaders(),
      signal: page.signal,
    });
    const posts: any[] = res?.posts ?? [];
    const comments: any[] = res?.comments ?? [];
    const mappedPosts = posts.map((pv) => mapLemmyPost(pv, this.instance));
    const mappedComments = comments.map((cv) =>
      mapLemmyComment(
        cv,
        lid(this.instance, "post", cv?.post?.id ?? 0),
        this.instance,
      ),
    );
    let items: (Post | Comment)[];
    if (kind === "posts") items = mappedPosts;
    else if (kind === "comments") items = mappedComments;
    else items = [...mappedPosts, ...mappedComments]; // overview / saved
    const nextPage = (typeof page.cursor === "number" ? page.cursor : 1) + 1;
    const hasMore = mappedPosts.length > 0 || mappedComments.length > 0;
    return { items, nextCursor: hasMore ? nextPage : undefined };
  }
  async blockUser(id: JanusId, blocked: boolean): Promise<void> {
    await this.authedPost("/user/block", {
      person_id: Number(parseId(id).nativeId),
      block: blocked,
    });
  }

  async getUnreadCount(): Promise<number> {
    if (!this.jwt) return 0;
    try {
      const res = await this.fetchJson(this.url("/user/unread_count", {}), {
        headers: this.authHeaders(),
      });
      return (
        (res?.replies ?? 0) +
        (res?.mentions ?? 0) +
        (res?.private_messages ?? 0)
      );
    } catch {
      return 0;
    }
  }

  async getInbox(
    filter: "all" | "replies" | "mentions" | "messages",
    page: PageRequest,
  ): Promise<Page<Notification>> {
    this.requireJwt();
    const pageNum = typeof page.cursor === "number" ? page.cursor : 1;
    const limit = page.limit ?? 25;
    const items: Notification[] = [];
    const want = (k: typeof filter) => filter === "all" || filter === k;

    if (want("replies")) {
      const res = await this.fetchJson(
        this.url("/user/replies", {
          sort: "New",
          unread_only: "false",
          page: pageNum,
          limit,
        }),
        { headers: this.authHeaders(), signal: page.signal },
      );
      for (const r of res?.replies ?? []) items.push(this.mapReply(r));
    }
    if (want("mentions")) {
      const res = await this.fetchJson(
        this.url("/user/mention", {
          sort: "New",
          unread_only: "false",
          page: pageNum,
          limit,
        }),
        { headers: this.authHeaders(), signal: page.signal },
      );
      for (const m of res?.mentions ?? []) items.push(this.mapMention(m));
    }
    if (want("messages")) {
      const res = await this.fetchJson(
        this.url("/private_message/list", {
          unread_only: "false",
          page: pageNum,
          limit,
        }),
        { headers: this.authHeaders(), signal: page.signal },
      );
      for (const pm of res?.private_messages ?? []) items.push(this.mapPm(pm));
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    return {
      items,
      nextCursor: items.length >= limit ? pageNum + 1 : undefined,
    };
  }

  private mapReply(r: any): Notification {
    const c = r.comment ?? {};
    return {
      id: lid(this.instance, "message", `reply:${r.comment_reply?.id}`),
      dedupKey: dedupKey(c.ap_id ?? `reply:${r.comment_reply?.id}`),
      source: "lemmy",
      instance: this.instance,
      kind: "commentReply",
      read: !!r.comment_reply?.read,
      createdAt: lemmyTime(c.published),
      author: r.creator
        ? {
            id: lid(this.instance, "user", r.creator.id),
            username: r.creator.name,
            handle: handle(
              r.creator.name,
              !!r.creator.local,
              r.creator.actor_id ?? "",
            ),
          }
        : undefined,
      subject: r.post?.name,
      body: markdown(c.content),
      contextRoute: {
        source: LEMMY_SOURCE,
        instance: this.instance,
        kind: "post",
        params: { id: String(r.post?.id ?? "") },
      },
      ext: { source: "lemmy", apId: c.ap_id, local: !!c.local },
    };
  }

  private mapMention(m: any): Notification {
    const c = m.comment ?? {};
    return {
      id: lid(this.instance, "message", `mention:${m.person_mention?.id}`),
      dedupKey: dedupKey(c.ap_id ?? `mention:${m.person_mention?.id}`),
      source: "lemmy",
      instance: this.instance,
      kind: "mention",
      read: !!m.person_mention?.read,
      createdAt: lemmyTime(c.published),
      author: m.creator
        ? {
            id: lid(this.instance, "user", m.creator.id),
            username: m.creator.name,
            handle: handle(
              m.creator.name,
              !!m.creator.local,
              m.creator.actor_id ?? "",
            ),
          }
        : undefined,
      subject: m.post?.name,
      body: markdown(c.content),
      ext: { source: "lemmy", apId: c.ap_id, local: !!c.local },
    };
  }

  private mapPm(pm: any): Notification {
    const m = pm.private_message ?? {};
    return {
      id: lid(this.instance, "message", `pm:${m.id}`),
      dedupKey: dedupKey(m.ap_id ?? `pm:${m.id}`),
      source: "lemmy",
      instance: this.instance,
      kind: "privateMessage",
      read: !!m.read,
      createdAt: lemmyTime(m.published),
      author: pm.creator
        ? {
            id: lid(this.instance, "user", pm.creator.id),
            username: pm.creator.name,
            handle: handle(
              pm.creator.name,
              !!pm.creator.local,
              pm.creator.actor_id ?? "",
            ),
          }
        : undefined,
      body: markdown(m.content),
      ext: { source: "lemmy", apId: m.ap_id, local: true },
    };
  }

  async markRead(id: JanusId, read: boolean): Promise<void> {
    const raw = parseId(id).nativeId; // "reply:N" | "mention:N" | "pm:N"
    const [type, num] = raw.split(":");
    const n = Number(num);
    if (type === "reply")
      await this.authedPost("/comment/mark_as_read", {
        comment_reply_id: n,
        read,
      });
    else if (type === "mention")
      await this.authedPost("/user/mention/mark_as_read", {
        person_mention_id: n,
        read,
      });
    else if (type === "pm")
      await this.authedPost("/private_message/mark_as_read", {
        private_message_id: n,
        read,
      });
  }

  async markAllRead(): Promise<void> {
    await this.authedPost("/user/mark_all_as_read", {});
  }

  async sendMessage(input: { to: JanusId; markdown: string }): Promise<void> {
    await this.authedPost("/private_message", {
      content: input.markdown,
      recipient_id: Number(parseId(input.to).nativeId),
    });
  }
  async search(
    q: string,
    kind: SearchKind,
    opts: { sort?: string } & PageRequest,
  ): Promise<Page<any>> {
    const typeMap: Record<SearchKind, string> = {
      posts: "Posts",
      comments: "Comments",
      communities: "Communities",
      users: "Users",
      all: "All",
    };
    const res = await this.fetchJson(
      this.url("/search", {
        q,
        type_: typeMap[kind] ?? "Posts",
        sort: lemmySort(opts.sort),
        listing_type: "All",
        limit: opts.limit ?? 25,
        page: typeof opts.cursor === "number" ? opts.cursor : 1,
      }),
      { headers: this.authHeaders(), signal: opts.signal },
    );
    const posts: any[] = res?.posts ?? [];
    const comments: any[] = res?.comments ?? [];
    const communities: any[] = res?.communities ?? [];
    let items: any[];
    if (kind === "comments")
      items = comments.map((cv) =>
        mapLemmyComment(
          cv,
          lid(this.instance, "post", cv?.post?.id ?? 0),
          this.instance,
        ),
      );
    else if (kind === "communities")
      items = communities.map((cv) => mapLemmyCommunity(cv, this.instance));
    else items = posts.map((pv) => mapLemmyPost(pv, this.instance));
    const cur = typeof opts.cursor === "number" ? opts.cursor : 1;
    return { items, nextCursor: items.length > 0 ? cur + 1 : undefined };
  }
}

function notYet(method: string): Promise<never> {
  return Promise.reject(
    new Error(
      `LemmyAdapter.${method} is not implemented in the prototype yet.`,
    ),
  );
}
