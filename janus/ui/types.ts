import type { Post } from "../core/model";
import type { JanusId, SourceKind } from "../core/ids";

export type RootStackParamList = {
  Feed: undefined;
  Post: { post: Post };
  Profile: { userId: JanusId; source: SourceKind; handle: string };
};
