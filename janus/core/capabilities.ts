/**
 * SourceCapabilities — the explicit declaration of what each source actually
 * supports. The shell reads this to show/hide controls instead of assuming
 * feature parity. Critically, a source must NOT advertise a capability it does
 * not genuinely implement (e.g. Hydra stubs awards/poll-voting, so the Reddit
 * adapter declares them false).
 */

export type TimeWindow = "hour" | "day" | "week" | "month" | "year" | "all";

/** Canonical short→long order, shared by every time-window picker. */
export const TIME_WINDOWS: readonly TimeWindow[] = [
  "hour",
  "day",
  "week",
  "month",
  "year",
  "all",
];

/** Human label for a window. Reddit/Lemmy both agree on the same six buckets. */
export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  hour: "Past Hour",
  day: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
  all: "All Time",
};

export interface SortOption {
  id: string;
  label: string;
  /** When true, the UI must compose this sort with a TimeWindow (Lemmy "Top"). */
  needsTimeWindow?: boolean;
}

export interface CommentSortOption {
  id: string;
  label: string;
}

export interface ListingType {
  id: string;
  label: string;
}

/** Subscription tri-state. "pending" only ever occurs on Lemmy. */
export type SubscribedState = "subscribed" | "pending" | "none";

export type CrosspostSupport = "firstClass" | "urlGrouped" | "none";
export type MarkdownInputMode = "html" | "markdown";

export interface SourceCapabilities {
  sorts: {
    feed: SortOption[];
    comment: CommentSortOption[];
    search: SortOption[];
  };
  listingTypes: ListingType[];
  /** Lemmy: Top is (sort × duration). Reddit folds time window into "top". */
  topRequiresTimeWindow: boolean;
  supportsMultireddits: boolean;
  supportsCrossposts: CrosspostSupport;
  supportsAwards: boolean;
  supportsUserFlair: boolean;
  supportsPolls: boolean;
  /** Lemmy resolveObject; Reddit has no analog. */
  supportsFederationResolve: boolean;
  supportsModeration: boolean;
  supportsPrivateMessages: boolean;
  supportsImageUpload: boolean;
  /** Structured per-community rules (Reddit /about/rules). Lemmy: false. */
  supportsRules: boolean;
  /** Community wiki pages (Reddit /wiki). Lemmy has no wiki: false. */
  supportsWiki: boolean;
  /** Reddit serves body_html; Lemmy serves markdown. Drives the renderer. */
  markdownInput: MarkdownInputMode;
}
