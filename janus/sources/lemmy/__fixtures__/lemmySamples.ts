/**
 * Hand-crafted Lemmy v3 fixtures mirroring the real lemmy.world shapes
 * (verified live against lemmy.world v0.19.18). Stable values pin edge cases:
 * a LOCAL post, a REMOTE/federated post (local:false -> instance-qualified
 * handle), an image post vs a link post, and a comment thread whose nesting
 * comes from the dotted `path`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const localImagePost = {
  post: {
    id: 1001,
    name: "A local image post",
    url: "https://lemmy.world/pictrs/image/abc.jpeg",
    url_content_type: "image/jpeg",
    thumbnail_url: "https://lemmy.world/pictrs/image/abc-thumb.jpeg",
    image_details: { width: 1000, height: 500 },
    creator_id: 7,
    community_id: 3,
    published: "2024-05-01T12:00:00",
    nsfw: false,
    locked: false,
    featured_community: true,
    featured_local: false,
    ap_id: "https://lemmy.world/post/1001",
    local: true,
  },
  creator: { id: 7, name: "alice", avatar: "https://lemmy.world/u/alice.png", actor_id: "https://lemmy.world/u/alice", local: true, bot_account: false },
  community: { id: 3, name: "technology", title: "Technology", icon: "https://lemmy.world/c/tech.png", actor_id: "https://lemmy.world/c/technology", local: true, nsfw: false, posting_restricted_to_mods: false },
  counts: { score: 321, comments: 12 },
  subscribed: "NotSubscribed",
  saved: false,
  read: false,
  my_vote: 1,
};

const remoteLinkPost = {
  post: {
    id: 1002,
    name: "A federated link post",
    url: "https://example.com/story",
    creator_id: 99,
    community_id: 50,
    published: "2024-05-02T08:30:00",
    nsfw: false,
    locked: true,
    featured_community: false,
    featured_local: false,
    ap_id: "https://beehaw.org/post/55",
    local: false,
  },
  creator: { id: 99, name: "bob", actor_id: "https://sh.itjust.works/u/bob", local: false, bot_account: false },
  community: { id: 50, name: "news", title: "News", actor_id: "https://beehaw.org/c/news", local: false, nsfw: false, posting_restricted_to_mods: false },
  counts: { score: 5, comments: 0 },
  subscribed: "Subscribed",
  saved: true,
  read: true,
  my_vote: 0,
};

export const lemmyListFixture = {
  posts: [localImagePost, remoteLinkPost],
  next_page: "PAGECURSOR2",
} as any;

export const lemmyPostFixture = { post_view: localImagePost } as any;

// Comment thread for post 1001: c10 (top) -> c11 (child); c12 (top, remote author).
export const lemmyCommentsFixture = {
  comments: [
    {
      comment: { id: 10, creator_id: 7, post_id: 1001, content: "OP top comment", path: "0.10", published: "2024-05-01T12:05:00", ap_id: "https://lemmy.world/comment/10", local: true, distinguished: false },
      creator: { id: 7, name: "alice", actor_id: "https://lemmy.world/u/alice", local: true, bot_account: false },
      post: { id: 1001, creator_id: 7 },
      community: { id: 3, name: "technology", actor_id: "https://lemmy.world/c/technology", local: true },
      counts: { comment_id: 10, score: 50, child_count: 1 },
      subscribed: "NotSubscribed",
      saved: false,
    },
    {
      comment: { id: 11, creator_id: 8, post_id: 1001, content: "A reply", path: "0.10.11", published: "2024-05-01T12:06:00", ap_id: "https://lemmy.world/comment/11", local: true, distinguished: false },
      creator: { id: 8, name: "carol", actor_id: "https://lemmy.world/u/carol", local: true, bot_account: false },
      post: { id: 1001, creator_id: 7 },
      community: { id: 3, name: "technology", actor_id: "https://lemmy.world/c/technology", local: true },
      counts: { comment_id: 11, score: 9, child_count: 0 },
      subscribed: "NotSubscribed",
      saved: false,
    },
    {
      comment: { id: 12, creator_id: 99, post_id: 1001, content: "Remote commenter", path: "0.12", published: "2024-05-01T12:10:00", ap_id: "https://beehaw.org/comment/12", local: false, distinguished: false },
      creator: { id: 99, name: "dave", actor_id: "https://beehaw.org/u/dave", local: false, bot_account: false },
      post: { id: 1001, creator_id: 7 },
      community: { id: 3, name: "technology", actor_id: "https://lemmy.world/c/technology", local: true },
      counts: { comment_id: 12, score: 3, child_count: 0 },
      subscribed: "NotSubscribed",
      saved: false,
    },
  ],
} as any;
