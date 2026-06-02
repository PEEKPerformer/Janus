import type { SourceCapabilities } from "../../core/capabilities";

/**
 * Reddit's declared capabilities. Honest about what the web-`.json` data layer
 * actually implements: awards and polls are declared FALSE because Hydra (our
 * reference) omits awards entirely and only stubs poll voting — we won't
 * advertise a control that does nothing.
 */
export const REDDIT_CAPABILITIES: SourceCapabilities = {
  sorts: {
    feed: [
      { id: "best", label: "Best" },
      { id: "hot", label: "Hot" },
      { id: "new", label: "New" },
      { id: "top", label: "Top", needsTimeWindow: true },
      { id: "rising", label: "Rising" },
      { id: "controversial", label: "Controversial", needsTimeWindow: true },
    ],
    comment: [
      { id: "confidence", label: "Best" },
      { id: "top", label: "Top" },
      { id: "new", label: "New" },
      { id: "controversial", label: "Controversial" },
      { id: "old", label: "Old" },
      { id: "qa", label: "Q&A" },
    ],
    search: [
      { id: "relevance", label: "Relevance" },
      { id: "hot", label: "Hot" },
      { id: "top", label: "Top", needsTimeWindow: true },
      { id: "new", label: "New" },
      { id: "comments", label: "Comments" },
    ],
  },
  listingTypes: [
    { id: "popular", label: "Popular" },
    { id: "all", label: "All" },
    { id: "home", label: "Home" },
  ],
  // Reddit folds the time window into the "top" sort (?t=), it isn't a separate
  // sort×duration product the way Lemmy's is.
  topRequiresTimeWindow: false,
  supportsMultireddits: true,
  supportsCrossposts: "firstClass",
  supportsAwards: false,
  supportsUserFlair: true,
  supportsPolls: false,
  supportsFederationResolve: false,
  supportsModeration: false,
  supportsPrivateMessages: true,
  supportsImageUpload: true,
  markdownInput: "html",
};
