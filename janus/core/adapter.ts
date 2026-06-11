/**
 * SourceAdapter — the single contract every backend implements. RedditAdapter
 * (wrapping Hydra) and LemmyAdapter (porting Voyager) both implement this. The
 * UI shell and state layer NEVER import Reddit/Lemmy clients directly — only this.
 *
 * Account model (decided after the Phase-0 spike): an adapter instance is bound
 * to a SOURCE with at most one ACTIVE account. iOS cannot reliably set
 * per-request Cookie headers, so two live Reddit sessions can't coexist; Reddit
 * account switches are a serial swap handled by the AccountManager. Cross-source
 * concurrency (one Reddit + one Lemmy active at once) IS supported because they
 * use different hosts/transports.
 */

import type {
  Post,
  Comment,
  Community,
  User,
  Notification,
  Conversation,
  DirectMessage,
  Multireddit,
  Route,
  LoadMoreRef,
  CustomEmoji,
  CommunityRule,
  WikiPage,
  PostFlairChoice,
} from "./model";
import type { JanusId, SourceKind } from "./ids";
import type { Page, PageRequest } from "./pagination";
import type { Vote } from "./vote";
import type {
  SourceCapabilities,
  TimeWindow,
  SubscribedState,
} from "./capabilities";

// ---------------------------------------------------------------------------
// Auth / accounts
// ---------------------------------------------------------------------------

export interface AccountRef {
  id: JanusId; // "reddit:www.reddit.com:user:alice"
  source: SourceKind;
  instance: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  isGuest: boolean;
}

/** Opaque secret bundle, persisted to the device Keychain by the shell. */
export type SecretBundle =
  | { source: "reddit"; sessionCookie: string; modhash?: string }
  | { source: "lemmy"; jwt: string };

/** Reddit needs a WebView; Lemmy completes inline. */
export type LoginChallenge =
  | { mode: "webview"; url: string; successCookieName: string }
  | { mode: "credentials"; needsTotp: boolean };

export type LoginInput =
  | { mode: "webview"; capturedCookie: string }
  | {
      mode: "credentials";
      usernameOrEmail: string;
      password: string;
      totp?: string;
    };

// ---------------------------------------------------------------------------
// Query / write inputs
// ---------------------------------------------------------------------------

export interface FeedQuery {
  /** Capability-validated listing id (Reddit home/popular/all; Lemmy All/Local/Subscribed). */
  listingType?: string;
  /** Capability-validated sort id. */
  sort?: string;
  /** Only when the chosen sort.needsTimeWindow. */
  timeWindow?: TimeWindow;
  communityId?: JanusId;
  /** Reddit-only; ignored by Lemmy. */
  multiId?: JanusId;
  searchQuery?: string;
}

export type SubmitKind = "self" | "link" | "image";

export interface SubmitPostInput {
  communityId: JanusId;
  title: string;
  kind: SubmitKind;
  markdown?: string;
  url?: string;
  /** Result of a prior uploadImage. */
  imageRef?: string;
  nsfw?: boolean;
  flairId?: string;
}

/** React Native file descriptor — NOT a DOM File (which doesn't exist in Hermes). */
export interface JanusFile {
  uri: string;
  mimeType: string;
  name: string;
}

export type SearchKind = "posts" | "comments" | "communities" | "users" | "all";
export type UserContentKind = "overview" | "posts" | "comments" | "saved";

/** A removed/deleted comment body recovered from a public archive. */
export interface RecoveredComment {
  /** The original comment text the archive preserved. */
  text: string;
  /** Original author, when the live comment showed `[deleted]`. */
  author?: string;
  provenance: import("./model").ArchiveProvenance;
}

export interface VoteResult {
  score: number;
  userVote: Vote;
}

export interface ResolvedRemote {
  kind: "post" | "comment" | "community" | "user";
  id: JanusId;
}

/**
 * A moderator action on a post or comment. Adapters translate each to the
 * source's native endpoint (Reddit /api/remove etc.; Lemmy /post/remove etc.).
 * Pin/lock/markNsfw apply to posts; distinguish applies to comments; remove and
 * approve apply to both.
 */
export type ModAction =
  | { kind: "remove" }
  | { kind: "approve" }
  | { kind: "lock"; locked: boolean }
  | { kind: "pin"; pinned: boolean }
  | { kind: "distinguish"; distinguished: boolean }
  | { kind: "markNsfw"; nsfw: boolean };

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export interface SourceAdapter {
  readonly source: SourceKind;
  readonly instance: string;
  readonly account: AccountRef; // current identity (may be guest)
  readonly capabilities: SourceCapabilities;

  /**
   * Whether downvotes are allowed on this instance right now (some Lemmy
   * instances, e.g. Hexbear, disable them site-wide). Runtime + per-instance, so
   * it's a method rather than a static capability. Optional — callers default to
   * allowing downvotes when absent.
   */
  getDownvotesEnabled?(): Promise<boolean>;

  /** Instance custom emoji for the composer picker (Lemmy/Hexbear). Optional. */
  getCustomEmojis?(): Promise<CustomEmoji[]>;

  // --- Auth -----------------------------------------------------------------
  beginLogin(opts: { instance: string }): Promise<LoginChallenge>;
  completeLogin(
    input: LoginInput,
  ): Promise<{ account: AccountRef; secret: SecretBundle }>;
  /** Rehydrate from a Keychain-stored secret on launch / account switch. */
  restore(secret: SecretBundle): Promise<AccountRef>;
  logout(): Promise<void>;

  // --- Feeds ----------------------------------------------------------------
  getFeed(query: FeedQuery, page: PageRequest): Promise<Page<Post>>;
  getPost(id: JanusId): Promise<Post>;
  /** Returns FLAT comments; the core CommentTree builder nests them. */
  getComments(
    postId: JanusId,
    opts: {
      parentId?: JanusId;
      maxDepth?: number;
      sort?: string;
    } & PageRequest,
  ): Promise<Page<Comment>>;
  loadMoreComments(postId: JanusId, more: LoadMoreRef): Promise<Comment[]>;

  // --- Communities ----------------------------------------------------------
  getCommunity(id: JanusId): Promise<Community>;
  getSubscriptions(): Promise<Community[]>;
  setSubscription(id: JanusId, subscribed: boolean): Promise<Community>;
  searchCommunities(q: string, page: PageRequest): Promise<Page<Community>>;
  getTrendingCommunities(): Promise<Community[]>;
  /** Reddit custom multireddits; only when capabilities.supportsMultireddits. */
  getMultireddits?(): Promise<Multireddit[]>;
  /** Create a new (empty) multireddit. Reddit-only. */
  createMultireddit?(name: string): Promise<Multireddit>;
  /** Delete a multireddit. Reddit-only. */
  deleteMultireddit?(id: JanusId): Promise<void>;
  /** Add a community to a multireddit. Reddit-only. */
  addToMultireddit?(id: JanusId, communityId: JanusId): Promise<void>;
  /** Remove a community from a multireddit. Reddit-only. */
  removeFromMultireddit?(id: JanusId, communityId: JanusId): Promise<void>;
  /** A community's rules; only when capabilities.supportsRules (Reddit). */
  getCommunityRules?(id: JanusId): Promise<CommunityRule[]>;
  /**
   * Selectable post flairs for composing in a community (Reddit link flair).
   * Returns [] when the community has none; absent on sources without flair.
   */
  getPostFlairs?(id: JanusId): Promise<PostFlairChoice[]>;
  /**
   * Accept a quarantine/gated subreddit interstitial so its feed loads. Called
   * by the shell after the user accepts a {@link GatedContentError}. Reddit-only.
   */
  optInToCommunity?(id: JanusId, kind: "quarantine" | "gated"): Promise<void>;
  /**
   * A community wiki page; only when capabilities.supportsWiki (Reddit).
   * `page` defaults to the wiki index. Throws NotFoundError when the page or the
   * community's wiki doesn't exist.
   */
  getWikiPage?(id: JanusId, page?: string): Promise<WikiPage>;

  // --- Write / interactions -------------------------------------------------
  vote(target: JanusId, vote: Vote): Promise<VoteResult>;
  save(target: JanusId, saved: boolean): Promise<void>;
  /**
   * Report a post or comment to the moderators with a free-text reason. Both
   * sources support this (Reddit /api/report; Lemmy /post|comment/report).
   * Optional so a source without reporting just hides the action.
   */
  reportContent?(target: JanusId, reason: string): Promise<void>;
  submitPost(input: SubmitPostInput): Promise<Post>;
  submitComment(input: {
    parentId: JanusId;
    postId: JanusId;
    markdown: string;
  }): Promise<Comment>;
  editContent(id: JanusId, markdown: string): Promise<Post | Comment>;
  deleteContent(id: JanusId): Promise<void>;
  uploadImage(file: JanusFile): Promise<{ url: string; deleteToken?: string }>;

  // --- Users ----------------------------------------------------------------
  /**
   * Apply a moderator action to a post or comment. Only meaningful when
   * capabilities.supportsModeration and the signed-in user moderates the target's
   * community (Post.canModerate). Optional — absent on sources without mod tools.
   */
  moderate?(target: JanusId, action: ModAction): Promise<void>;

  getUser(id: JanusId): Promise<User>;
  getUserContent(
    id: JanusId,
    kind: UserContentKind,
    page: PageRequest,
  ): Promise<Page<Post | Comment>>;
  blockUser(id: JanusId, blocked: boolean): Promise<void>;

  /**
   * Reconstruct a user's posts/comments from a public archive when their live
   * history is hidden (the listing 403s). Optional — present only on sources
   * with an archive (Reddit); the UI gates on `recoverUserContent != null` and
   * on the user's opt-in setting. Returned items carry `ext.archived`.
   */
  recoverUserContent?(
    id: JanusId,
    kind: UserContentKind,
    page: PageRequest,
  ): Promise<Page<Post | Comment>>;
  /**
   * Recover the original bodies of `[removed]`/`[deleted]` comments in one
   * thread from a public archive. Pass the live comments; returns a map from
   * comment id to its recovered text + provenance (only for those found).
   * Optional, Reddit-only, opt-in — same gating as recoverUserContent.
   */
  recoverRemovedComments?(
    postId: JanusId,
    comments: Comment[],
  ): Promise<Map<JanusId, RecoveredComment>>;

  // --- Inbox / notifications ------------------------------------------------
  getUnreadCount(): Promise<number>;
  getInbox(
    filter: "all" | "replies" | "mentions" | "messages",
    page: PageRequest,
  ): Promise<Page<Notification>>;
  markRead(id: JanusId, read: boolean): Promise<void>;
  markAllRead(): Promise<void>;
  /** `subject` is used by Reddit (which threads by subject); Lemmy ignores it. */
  sendMessage(input: {
    to: JanusId;
    markdown: string;
    subject?: string;
  }): Promise<void>;

  // --- Direct messages (conversations) --------------------------------------
  /** Private-message threads, grouped by correspondent, newest activity first. */
  getConversations(page: PageRequest): Promise<Page<Conversation>>;
  /** The full back-and-forth with one correspondent, oldest message first. */
  getMessageThread(
    correspondentId: JanusId,
    page: PageRequest,
  ): Promise<Page<DirectMessage>>;

  // --- Search (mixed kinds) -------------------------------------------------
  search(
    q: string,
    kind: SearchKind,
    opts: {
      sort?: string;
      /** Only when the chosen search sort.needsTimeWindow (Top). */
      timeWindow?: TimeWindow;
      /** Restrict a post search to one community (in-community search). */
      communityId?: JanusId;
    } & PageRequest,
  ): Promise<Page<Post | Comment | Community | User>>;

  // --- Federation (Lemmy-only; Reddit throws CapabilityError) ---------------
  resolveRemoteUrl(url: string): Promise<ResolvedRemote>;
}

// Re-exported for convenience at adapter implementation sites.
export type { Route, SubscribedState };
