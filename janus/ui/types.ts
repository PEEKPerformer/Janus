import type { Post } from "../core/model";

export type RootStackParamList = {
  Feed: undefined;
  Post: { post: Post };
};
