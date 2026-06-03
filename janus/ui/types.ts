import type { Post, Community } from "../core/model";
import type { JanusId, SourceKind } from "../core/ids";

export type RootStackParamList = {
  Feed: undefined;
  Post: { post: Post };
  Profile: { userId: JanusId; source: SourceKind; handle: string };
  Compose: { presetCommunity?: Community } | undefined;
  Search: undefined;
  Inbox: undefined;
  Settings: undefined;
  ImageViewer: { images: string[]; index?: number };
};
