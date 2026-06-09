import type { SourceCapabilities } from "../../core/capabilities";

/**
 * Lemmy's declared capabilities. The big divergences from Reddit: federation
 * resolve IS supported, multireddits/awards/user-flair/polls are NOT, crossposts
 * are URL-grouped (not first-class), markdown is the input format, and Top is a
 * sort×time-window product (topRequiresTimeWindow = true).
 */
export const LEMMY_CAPABILITIES: SourceCapabilities = {
  sorts: {
    feed: [
      { id: "active", label: "Active" },
      { id: "hot", label: "Hot" },
      { id: "new", label: "New" },
      { id: "top", label: "Top", needsTimeWindow: true },
      { id: "mostcomments", label: "Most Comments" },
      { id: "controversial", label: "Controversial" },
      { id: "scaled", label: "Scaled" },
    ],
    comment: [
      { id: "Hot", label: "Hot" },
      { id: "Top", label: "Top" },
      { id: "New", label: "New" },
      { id: "Old", label: "Old" },
      { id: "Controversial", label: "Controversial" },
    ],
    search: [
      { id: "active", label: "Active" },
      { id: "new", label: "New" },
      { id: "top", label: "Top", needsTimeWindow: true },
    ],
  },
  listingTypes: [
    { id: "All", label: "All" },
    { id: "Local", label: "Local" },
    { id: "Subscribed", label: "Subscribed" },
    { id: "ModeratorView", label: "Moderator" },
  ],
  topRequiresTimeWindow: true,
  supportsMultireddits: false,
  supportsCrossposts: "urlGrouped",
  supportsAwards: false,
  supportsUserFlair: false,
  supportsPolls: false,
  supportsFederationResolve: true,
  supportsModeration: false,
  supportsPrivateMessages: true,
  supportsImageUpload: true,
  supportsRules: false,
  supportsWiki: false,
  markdownInput: "markdown",
};
