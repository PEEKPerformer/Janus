/* eslint-disable @typescript-eslint/no-explicit-any */
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
import type { Post, Comment, Community, User, Notification, LoadMoreRef } from "../../core/model";
import type { Page, PageRequest } from "../../core/pagination";
import { Vote } from "../../core/vote";
import { parseId, buildId, type JanusId } from "../../core/ids";
import { CapabilityError, NotAuthenticatedError, NotFoundError } from "../../core/errors";
import { LEMMY_CAPABILITIES } from "./capabilities";
import {
  mapLemmyPost,
  mapLemmyComment,
  mapLemmyCommunity,
  mapLemmyPerson,
  lid,
} from "./mappers";

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
    id: buildId({ source: "lemmy", instance, kind: "user", nativeId: "__guest__" }),
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
  private jwt?: string;
  private readonly base: string;

  constructor(deps: LemmyAdapterDeps) {
    this.instance = deps.instance;
    this.fetchJson = deps.fetchJson;
    this.jwt = deps.jwt;
    this.account = deps.account ?? guestAccount(deps.instance);
    this.base = `https://${deps.instance}/api/v3`;
  }

  private url(path: string, params: Record<string, string | number | undefined>): string {
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
    if (!this.jwt) throw new NotAuthenticatedError("Log in to a Lemmy account to do that.");
    return this.jwt;
  }

  // --- Feeds ----------------------------------------------------------------

  async getFeed(query: FeedQuery, page: PageRequest): Promise<Page<Post>> {
    const params: Record<string, string | number | undefined> = {
      sort: lemmySort(query.sort, query.timeWindow),
      type_: query.listingType ?? "All",
      limit: page.limit ?? 25,
      page_cursor: typeof page.cursor === "string" ? page.cursor : undefined,
    };
    if (query.communityId) params.community_id = parseId(query.communityId).nativeId;
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
    const res = await this.fetchJson(this.url("/post", { id: parseId(id).nativeId }), {
      headers: this.authHeaders(),
    });
    if (!res?.post_view) throw new NotFoundError("Post not found.");
    return mapLemmyPost(res.post_view, this.instance);
  }

  async getComments(
    postId: JanusId,
    opts: { parentId?: JanusId; maxDepth?: number; sort?: string } & PageRequest,
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
    return { items: comments.map((cv) => mapLemmyComment(cv, postId, this.instance)) };
  }

  async loadMoreComments(postId: JanusId, more: LoadMoreRef): Promise<Comment[]> {
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
    const res = await this.fetchJson(this.url("/community", { id: parseId(id).nativeId }), {
      headers: this.authHeaders(),
    });
    if (!res?.community_view) throw new NotFoundError("Community not found.");
    return mapLemmyCommunity(res.community_view, this.instance);
  }

  async searchCommunities(q: string, page: PageRequest): Promise<Page<Community>> {
    const res = await this.fetchJson(
      this.url("/search", { q, type_: "Communities", limit: page.limit ?? 25 }),
      { headers: this.authHeaders(), signal: page.signal },
    );
    const communities: any[] = res?.communities ?? [];
    return { items: communities.map((cv) => mapLemmyCommunity(cv, this.instance)) };
  }

  async getUser(id: JanusId): Promise<User> {
    const res = await this.fetchJson(this.url("/user", { person_id: parseId(id).nativeId }), {
      headers: this.authHeaders(),
    });
    if (!res?.person_view) throw new NotFoundError("User not found.");
    return mapLemmyPerson(res.person_view, this.instance);
  }

  // --- Federation -----------------------------------------------------------

  async resolveRemoteUrl(url: string): Promise<ResolvedRemote> {
    const res = await this.fetchJson(this.url("/resolve_object", { q: url }), {
      headers: this.authHeaders(),
    });
    if (res?.post) return { kind: "post", id: lid(this.instance, "post", res.post.post.id) };
    if (res?.comment) return { kind: "comment", id: lid(this.instance, "comment", res.comment.comment.id) };
    if (res?.community) return { kind: "community", id: lid(this.instance, "community", res.community.community.id) };
    if (res?.person) return { kind: "user", id: lid(this.instance, "user", res.person.person.id) };
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

  // ---- Not yet implemented in the prototype --------------------------------

  save(): Promise<void> {
    return notYet("save");
  }
  async beginLogin(opts: { instance: string }): Promise<LoginChallenge> {
    void opts;
    return { mode: "credentials", needsTotp: false };
  }
  completeLogin(_input: LoginInput): Promise<{ account: AccountRef; secret: SecretBundle }> {
    return notYet("completeLogin");
  }
  restore(_secret: SecretBundle): Promise<AccountRef> {
    return notYet("restore");
  }
  async logout(): Promise<void> {
    this.jwt = undefined;
    this.account = guestAccount(this.instance);
  }
  getSubscriptions(): Promise<Community[]> {
    return notYet("getSubscriptions");
  }
  setSubscription(_id: JanusId, _subscribed: boolean): Promise<Community> {
    return notYet("setSubscription");
  }
  getTrendingCommunities(): Promise<Community[]> {
    return notYet("getTrendingCommunities");
  }
  submitPost(_input: SubmitPostInput): Promise<Post> {
    return notYet("submitPost");
  }
  submitComment(_input: { parentId: JanusId; postId: JanusId; markdown: string }): Promise<Comment> {
    return notYet("submitComment");
  }
  editContent(_id: JanusId, _markdown: string): Promise<Post | Comment> {
    return notYet("editContent");
  }
  deleteContent(_id: JanusId): Promise<void> {
    return notYet("deleteContent");
  }
  uploadImage(_file: JanusFile): Promise<{ url: string; deleteToken?: string }> {
    return notYet("uploadImage");
  }
  getUserContent(_id: JanusId, _kind: UserContentKind, _page: PageRequest): Promise<Page<Post | Comment>> {
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
  search(_q: string, _kind: SearchKind, _opts: { sort?: string } & PageRequest): Promise<Page<any>> {
    return notYet("search");
  }
}

function notYet(method: string): Promise<never> {
  return Promise.reject(new Error(`LemmyAdapter.${method} is not implemented in the prototype yet.`));
}
