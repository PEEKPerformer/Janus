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
  Route,
  LoadMoreRef,
  CustomEmoji,
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

export interface VoteResult {
  score: number;
  userVote: Vote;
}

export interface ResolvedRemote {
  kind: "post" | "comment" | "community" | "user";
  id: JanusId;
}

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

  // --- Write / interactions -------------------------------------------------
  vote(target: JanusId, vote: Vote): Promise<VoteResult>;
  save(target: JanusId, saved: boolean): Promise<void>;
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
  getUser(id: JanusId): Promise<User>;
  getUserContent(
    id: JanusId,
    kind: UserContentKind,
    page: PageRequest,
  ): Promise<Page<Post | Comment>>;
  blockUser(id: JanusId, blocked: boolean): Promise<void>;

  // --- Inbox / notifications ------------------------------------------------
  getUnreadCount(): Promise<number>;
  getInbox(
    filter: "all" | "replies" | "mentions" | "messages",
    page: PageRequest,
  ): Promise<Page<Notification>>;
  markRead(id: JanusId, read: boolean): Promise<void>;
  markAllRead(): Promise<void>;
  sendMessage(input: { to: JanusId; markdown: string }): Promise<void>;

  // --- Search (mixed kinds) -------------------------------------------------
  search(
    q: string,
    kind: SearchKind,
    opts: { sort?: string } & PageRequest,
  ): Promise<Page<Post | Comment | Community | User>>;

  // --- Federation (Lemmy-only; Reddit throws CapabilityError) ---------------
  resolveRemoteUrl(url: string): Promise<ResolvedRemote>;
}

// Re-exported for convenience at adapter implementation sites.
export type { Route, SubscribedState };
