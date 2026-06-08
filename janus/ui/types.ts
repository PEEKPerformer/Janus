import type { Post, Community } from "../core/model";
import type { JanusId, SourceKind } from "../core/ids";

export type RootStackParamList = {
  Feed: { openCommunity?: Community } | undefined;
  Post: { post: Post };
  Profile: { userId: JanusId; source: SourceKind; handle: string };
  Compose: { presetCommunity?: Community } | undefined;
  Search: undefined;
  Inbox: undefined;
  Messages: undefined;
  MessageThread: {
    correspondentId: JanusId;
    source: SourceKind;
    instance: string;
    handle: string;
  };
  Settings: undefined;
  ImageViewer: { images: string[]; index?: number };
};
