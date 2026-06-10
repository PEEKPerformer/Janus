import type { Post, Community } from "../core/model";
import type { JanusId, SourceKind } from "../core/ids";

export type RootStackParamList = {
  Feed: { openCommunity?: Community } | undefined;
  /** `focusCommentId` opens the thread scrolled to that comment (inbox taps). */
  Post: { post: Post; focusCommentId?: string };
  Profile: { userId: JanusId; source: SourceKind; handle: string };
  Compose: { presetCommunity?: Community } | undefined;
  /** Optional `community` scopes a post search to that community (in-community search). */
  Search: { community?: Community } | undefined;
  Inbox: undefined;
  Messages: undefined;
  MessageThread: {
    correspondentId: JanusId;
    source: SourceKind;
    instance: string;
    handle: string;
  };
  Settings: undefined;
  Stats: undefined;
  /** Browsing history — every thread you've opened, searchable. */
  History: undefined;
  /** Read Later — local, account-free bookmark queue (both networks). */
  ReadLater: undefined;
  /** Saved searches ("watches") — list with "N new" badges. */
  Watches: undefined;
  /** Briefing — per-series megathread digest ("what did I miss?"). */
  Briefing: undefined;
  /** Plane Mode — pack threads, comments and images for offline reading. */
  PlaneMode: undefined;
  /** One watch's current results, newest first, NEW-badged. */
  WatchResults: { id: string };
  ImageViewer: { images: string[]; index?: number };
  /** TikTok-style media reel over a feed snapshot, opened at `postId`. */
  Reel: { posts: Post[]; postId: string };
  /** Same content across communities/networks — every side's discussion in one view. */
  MergedDiscussion: { posts: Post[] };
  /** Community sidebar/about (works for subreddits + Lemmy communities). */
  CommunityAbout: { community: Community };
  /** Community wiki page (Reddit only). Defaults to the wiki index. */
  Wiki: { community: Community; page?: string };
};
