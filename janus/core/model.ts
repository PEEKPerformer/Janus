/**
 * The unified, source-agnostic domain model. Every UI component renders these
 * shapes and never touches Reddit or Lemmy data directly. Both the RedditAdapter
 * (wrapping Hydra) and the LemmyAdapter (porting Voyager) map their native
 * shapes onto these.
 *
 * Design notes on impedance mismatch:
 *  - Reddit subreddits (single host) vs Lemmy communities (federated,
 *    community@instance) → Community.handle is instance-qualified for remote
 *    Lemmy actors, plain "r/name" for Reddit.
 *  - Federation: every entity carries `dedupKey` (Lemmy ap_id; Reddit fullname)
 *    for cross-instance dedup, distinct from the canonical routing `id`.
 *  - Several "shared" fields are actually source-asymmetric (scoreHidden is
 *    Reddit-only, etc.) — defaulted on the side that lacks them. Genuinely
 *    one-sided concepts (awards, crossposts, federation) live in `ext`.
 */

import type { JanusId, DedupKey, SourceKind } from "./ids";
import type { Vote } from "./vote";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface RichText {
  /** Source markdown, for compose/edit round-trips. */
  markdown?: string;
  /** Rendered HTML (Reddit body_html direct; Lemmy markdown→html in adapter). */
  html?: string;
  /** Plain-text fallback. */
  text?: string;
}

export interface Flair {
  text?: string;
  backgroundColor?: string;
  textColor?: string;
}

/** A selectable post flair template (Reddit link flair) for the composer. */
export interface PostFlairChoice {
  /** Flair template id, passed back as SubmitPostInput.flairId. */
  id: string;
  text: string;
  backgroundColor?: string;
  textColor?: string;
}

export interface AuthorRef {
  id: JanusId;
  username: string;
  /** Instance-qualified ("name@instance") for remote Lemmy actors. */
  handle: string;
  avatarUrl?: string;
  flair?: Flair;
}

export interface CommunityRef {
  id: JanusId;
  name: string;
  /** "r/name" (Reddit) or "name" / "name@instance" (Lemmy local/remote). */
  handle: string;
  icon?: string;
}

export type MediaKind =
  | "image"
  | "gallery"
  | "video"
  | "link"
  | "poll"
  | "crosspost";

export interface MediaVariant {
  uri: string;
  width?: number;
  height?: number;
}

export interface MediaItem {
  kind: MediaKind;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  variants?: MediaVariant[];
  hlsUrl?: string;
  isNSFW: boolean;
}

export interface OpenGraphData {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

/**
 * One community rule (Reddit `/about/rules`). Lemmy has no structured rules
 * concept — instances fold conduct into the community description — so this only
 * populates for sources whose capabilities.supportsRules is true.
 */
export interface CommunityRule {
  /** Short rule name/heading. */
  name: string;
  /** Optional longer explanation. */
  description?: RichText;
}

/**
 * A community wiki page (Reddit `/wiki/{page}`). Source-agnostic shape, but only
 * fetched where capabilities.supportsWiki is true (Reddit). `path` is the page
 * slug ("index", "config/sidebar", …); content is the rendered body.
 */
export interface WikiPage {
  path: string;
  content: RichText;
  /** Epoch ms of the last revision, if known. */
  revisedAt?: number;
  /** Username of the last reviser, if known. */
  revisedBy?: string;
}

export type InteractionStatus = "locked" | "archived" | null;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type RouteKind =
  | "feed"
  | "community"
  | "post"
  | "user"
  | "inbox"
  | "message"
  | "search"
  | "wiki"
  | "sidebar"
  | "gallery"
  | "multireddit"
  | "settings"
  | "accounts"
  | "webview";

/**
 * The canonical cross-source page descriptor that replaces Hydra's
 * reddit.com-URL-string-as-route contract. Internal app screens
 * (settings/accounts) omit the source dimension entirely.
 */
export interface Route {
  source?: SourceKind;
  instance?: string;
  kind: RouteKind;
  params: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Load-more (deep comment paging) — a discriminated union, because the three
// sources express continuation in fundamentally different ways:
//  - Reddit "more" nodes carry a list of child fullname ids.
//  - Lemmy continues a thread by re-fetching a parent_id subtree.
//  - Either may only know a missing COUNT (child_count − present).
// ---------------------------------------------------------------------------

export type LoadMoreRef =
  | { kind: "reddit"; childIds: string[]; depth: number }
  | { kind: "lemmy-subtree"; parentId: number; depth: number }
  | { kind: "count-only"; missingCount: number; depth: number };

// ---------------------------------------------------------------------------
// Source-specific extras (genuinely one-sided concepts)
// ---------------------------------------------------------------------------

export interface RedditExt {
  source: "reddit";
  /** Reddit crossposts are first-class nested posts. */
  crossPost?: Post;
  distinguished?: "moderator" | "admin" | null;
}

export interface LemmyExt {
  source: "lemmy";
  /** Federation actor id; also the dedupKey source. */
  apId: string;
  local: boolean;
  featuredLocal?: boolean;
  featuredCommunity?: boolean;
  /** Lemmy tracks server-side read state on posts. */
  read?: boolean;
}

export type SourceExt = RedditExt | LemmyExt;

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

interface EntityBase {
  id: JanusId;
  /** Federation-stable cross-instance key (Lemmy ap_id; Reddit fullname). */
  dedupKey: DedupKey;
  source: SourceKind;
  instance: string;
}

export interface PollOption {
  id: string;
  text: string;
  /** Absent while the poll is open and you haven't voted (Reddit hides tallies). */
  voteCount?: number;
}

export interface PollData {
  options: PollOption[];
  totalVotes: number;
  /** Epoch ms the poll closes; undefined if unknown. */
  endsAt?: number;
  closed: boolean;
  /** The option id the signed-in user picked, if any. */
  userSelection?: string;
}

export interface Post extends EntityBase {
  title: string;
  author: AuthorRef;
  community: CommunityRef;
  createdAt: number;
  editedAt?: number;
  score: number;
  /** Reddit-only (score_hidden); always false on Lemmy. */
  scoreHidden: boolean;
  userVote: Vote;
  commentCount: number;
  saved: boolean;
  isNSFW: boolean;
  isSpoiler: boolean;
  isStickied: boolean;
  /** True when the signed-in user moderates this post's community. */
  canModerate: boolean;
  /** True when a mod has removed this post (shown with a removed banner). */
  isRemoved: boolean;
  interactionStatus: InteractionStatus;
  body: RichText;
  media: MediaItem[];
  externalLink?: string;
  openGraph?: OpenGraphData;
  thumbnail?: MediaItem;
  /** Reddit poll_data (read-only display); absent on non-poll posts. */
  poll?: PollData;
  permalinkRoute: Route;
  flair?: Flair;
  ext: SourceExt;
}

export interface Comment extends EntityBase {
  postId: JanusId;
  parentId?: JanusId;
  author: AuthorRef;
  body: RichText;
  createdAt: number;
  editedAt?: number;
  score: number;
  scoreHidden: boolean;
  userVote: Vote;
  saved: boolean;
  isOP: boolean;
  isStickied: boolean;
  /** Reddit moderator/admin distinguished; null on Lemmy. */
  distinguished: "moderator" | "admin" | null;
  depth: number;
  childCount: number;
  loadMore?: LoadMoreRef;
  permalinkRoute: Route;
  flair?: Flair;
  ext: SourceExt;
}

export interface Community extends EntityBase {
  name: string;
  /** Always instance-qualified for remote Lemmy actors. */
  handle: string;
  title?: string;
  description?: RichText;
  icon?: string;
  banner?: string;
  subscriberCount: number;
  subscription: import("./capabilities").SubscribedState;
  isNSFW: boolean;
  isModerator: boolean;
  postingRestrictedToMods: boolean;
  rules?: RichText;
  permalinkRoute: Route;
  ext: SourceExt;
}

export interface User extends EntityBase {
  username: string;
  /** Instance-qualified for remote Lemmy actors. */
  handle: string;
  displayName?: string;
  avatar?: string;
  banner?: string;
  bio?: RichText;
  createdAt: number;
  isBot: boolean;
  isAdmin: boolean;
  /** Reddit link_karma; Lemmy post_count (not karma). */
  postScore?: number;
  /** Reddit comment_karma; Lemmy comment_count. */
  commentScore?: number;
  ext: SourceExt;
}

export type NotificationKind =
  | "commentReply"
  | "postReply"
  | "mention"
  | "privateMessage"
  | "modAction"
  | "subscribed";

export interface Notification extends EntityBase {
  kind: NotificationKind;
  read: boolean;
  createdAt: number;
  author?: AuthorRef;
  subject?: string;
  body: RichText;
  contextRoute?: Route;
  ext: SourceExt;
}

/**
 * A single direct/private message inside a {@link Conversation}. Unlike a
 * Notification (one-directional inbox item), a DirectMessage carries both
 * endpoints and a `fromMe` flag so the thread view can left/right-align bubbles.
 */
export interface DirectMessage extends EntityBase {
  read: boolean;
  createdAt: number;
  from: AuthorRef;
  to: AuthorRef;
  body: RichText;
  /** True when the signed-in account authored it (right-aligned bubble). */
  fromMe: boolean;
}

/**
 * A DM thread grouped by correspondent. `id` is the correspondent's user id, so
 * the thread view can fetch the full exchange via getMessageThread(id).
 */
export interface Conversation {
  id: JanusId;
  source: SourceKind;
  instance: string;
  correspondent: AuthorRef;
  lastMessage: DirectMessage;
  unreadCount: number;
}

/** Reddit-only; gated behind capabilities.supportsMultireddits. */
export interface Multireddit extends EntityBase {
  source: "reddit";
  name: string;
  communities: CommunityRef[];
  permalinkRoute: Route;
}

/** An instance custom emoji (Lemmy/Hexbear). `markdown` is the insertable text. */
export interface CustomEmoji {
  shortcode: string;
  url: string;
  category?: string;
  altText?: string;
  keywords: string[];
  /** Canonical markdown to insert: `![shortcode](url "emoji shortcode")`. */
  markdown: string;
}
