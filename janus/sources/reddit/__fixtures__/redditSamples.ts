/**
 * Hand-crafted fixtures matching Reddit's real `.json` Thing schema (fields
 * taken verbatim from the shapes Hydra's formatters read). Reddit blocks
 * datacenter IPs, and deterministic fixtures make for better unit tests anyway:
 * they pin specific edge cases (self/image/link posts, nested comments, a
 * `more` continuation node) that a random live post might not contain.
 *
 * Typed loosely as the raw API returns — the mappers consume `unknown`.
 */

const selfPost = {
  kind: "t3",
  data: {
    id: "abc100",
    name: "t3_abc100",
    title: "A self post about &amp; things",
    author: "alice",
    ups: 1234,
    score_hidden: false,
    saved: false,
    likes: true, // current user upvoted
    subreddit: "aww",
    sr_detail: {
      community_icon: "https://styles.redditmedia.com/icon.png?width=64",
      icon_img: "",
    },
    distinguished: null,
    stickied: false,
    over_18: false,
    spoiler: false,
    archived: false,
    locked: false,
    selftext: "Hello **world**",
    selftext_html: "&lt;div&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/div&gt;",
    num_comments: 42,
    permalink: "/r/aww/comments/abc100/a_self_post/",
    created: 1_700_000_000,
    url: "https://www.reddit.com/r/aww/comments/abc100/a_self_post/",
  },
};

const imagePost = {
  kind: "t3",
  data: {
    id: "abc200",
    name: "t3_abc200",
    title: "Look at this",
    author: "bob",
    ups: 50,
    score_hidden: false,
    saved: true,
    likes: null,
    subreddit: "aww",
    sr_detail: { icon_img: "https://example.com/sub.png" },
    distinguished: null,
    stickied: false,
    over_18: false,
    spoiler: false,
    archived: false,
    locked: false,
    selftext: "",
    selftext_html: null,
    num_comments: 3,
    permalink: "/r/aww/comments/abc200/look_at_this/",
    created: 1_700_000_500,
    url: "https://i.redd.it/xyz.jpg",
    preview: {
      images: [
        {
          source: {
            url: "https://preview.redd.it/xyz.jpg?full",
            width: 1200,
            height: 800,
          },
          resolutions: [
            {
              url: "https://preview.redd.it/xyz.jpg?w=320",
              width: 320,
              height: 213,
            },
            {
              url: "https://preview.redd.it/xyz.jpg?w=640",
              width: 640,
              height: 426,
            },
          ],
        },
      ],
    },
  },
};

const linkPost = {
  kind: "t3",
  data: {
    id: "abc300",
    name: "t3_abc300",
    title: "An external article",
    author: "carol",
    ups: 9,
    score_hidden: false,
    saved: false,
    likes: false, // downvoted
    subreddit: "news",
    sr_detail: {},
    distinguished: null,
    stickied: true,
    over_18: false,
    spoiler: false,
    archived: false,
    locked: true,
    selftext: "",
    selftext_html: null,
    num_comments: 100,
    permalink: "/r/news/comments/abc300/an_external_article/",
    created: 1_700_001_000,
    url: "https://example.com/article",
  },
};

export const listingFixture = {
  kind: "Listing",
  data: {
    after: "t3_abc300",
    children: [selfPost, imagePost, linkPost],
  },
} as any;

// --- Post detail + comment thread ------------------------------------------

const nestedReply = {
  kind: "t1",
  data: {
    id: "c200",
    name: "t1_c200",
    author: "dave",
    is_submitter: false,
    distinguished: null,
    stickied: false,
    edited: false,
    ups: 5,
    score_hidden: false,
    saved: false,
    likes: null,
    permalink: "/r/aww/comments/abc100/_/c200/",
    link_title: "A self post about & things",
    link_permalink: "https://www.reddit.com/r/aww/comments/abc100/a_self_post/",
    subreddit: "aww",
    body: "A nested reply",
    body_html: "&lt;p&gt;A nested reply&lt;/p&gt;",
    replies: "",
    created: 1_700_000_300,
  },
};

const topComment = {
  kind: "t1",
  data: {
    id: "c100",
    name: "t1_c100",
    author: "alice",
    is_submitter: true, // OP
    distinguished: "moderator",
    stickied: true,
    edited: 1_700_000_250,
    ups: 20,
    score_hidden: false,
    saved: false,
    likes: true,
    permalink: "/r/aww/comments/abc100/_/c100/",
    link_title: "A self post about & things",
    link_permalink: "https://www.reddit.com/r/aww/comments/abc100/a_self_post/",
    subreddit: "aww",
    body: "Top-level comment",
    body_html: "&lt;p&gt;Top-level comment&lt;/p&gt;",
    replies: {
      kind: "Listing",
      data: {
        children: [
          nestedReply,
          {
            kind: "more",
            data: { depth: 1, children: ["c201", "c202"], count: 2 },
          },
        ],
      },
    },
    created: 1_700_000_200,
  },
};

const secondTopComment = {
  kind: "t1",
  data: {
    id: "c150",
    name: "t1_c150",
    author: "erin",
    is_submitter: false,
    distinguished: null,
    stickied: false,
    edited: false,
    ups: 2,
    score_hidden: true,
    saved: false,
    likes: null,
    permalink: "/r/aww/comments/abc100/_/c150/",
    link_title: "A self post about & things",
    link_permalink: "https://www.reddit.com/r/aww/comments/abc100/a_self_post/",
    subreddit: "aww",
    body: "Another top comment",
    body_html: "&lt;p&gt;Another top comment&lt;/p&gt;",
    replies: "",
    created: 1_700_000_400,
  },
};

export const postCommentsFixture = [
  { kind: "Listing", data: { children: [selfPost] } },
  {
    kind: "Listing",
    data: {
      children: [
        topComment,
        secondTopComment,
        {
          kind: "more",
          data: { depth: 0, children: ["c900", "c901", "c902"], count: 3 },
        },
      ],
    },
  },
] as any;
