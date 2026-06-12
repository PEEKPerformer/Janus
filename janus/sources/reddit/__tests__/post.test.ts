import { mapPost } from "../mappers/post";
import { listingFixture } from "../__fixtures__/redditSamples";
import { Vote } from "../../../core/vote";

const [selfChild, imageChild, linkChild] = listingFixture.data.children;

describe("mapPost", () => {
  it("maps a self/text post with decoded title + body and upvote state", () => {
    const post = mapPost(selfChild);
    expect(post.id).toBe("reddit:www.reddit.com:post:t3_abc100");
    expect(post.dedupKey).toBe("t3_abc100");
    expect(post.source).toBe("reddit");
    expect(post.title).toBe("A self post about & things"); // &amp; decoded
    expect(post.author).toMatchObject({ username: "alice", handle: "u/alice" });
    expect(post.community).toMatchObject({ name: "aww", handle: "r/aww" });
    expect(post.score).toBe(1234);
    expect(post.userVote).toBe(Vote.Up);
    expect(post.commentCount).toBe(42);
    expect(post.createdAt).toBe(1_700_000_000 * 1000);
    expect(post.body.markdown).toBe("Hello **world**");
    expect(post.body.html).toBe("<div>Hello <b>world</b></div>"); // entities decoded
    expect(post.media).toHaveLength(0);
    expect(post.interactionStatus).toBeNull();
  });

  it("extracts a preview image with source + resolution variants", () => {
    const post = mapPost(imageChild);
    expect(post.saved).toBe(true);
    expect(post.userVote).toBe(Vote.None);
    expect(post.media).toHaveLength(1);
    const img = post.media[0];
    expect(img.kind).toBe("image");
    expect(img.url).toBe("https://preview.redd.it/xyz.jpg?full");
    expect(img.width).toBe(1200);
    expect(img.height).toBe(800);
    expect(img.aspectRatio).toBeCloseTo(1.5);
    expect(img.variants).toHaveLength(2);
    expect(img.thumbnailUrl).toBe("https://preview.redd.it/xyz.jpg?w=320");
    expect(post.thumbnail).toBe(img);
  });

  it("maps a downvoted, locked, stickied external link post", () => {
    const post = mapPost(linkChild);
    expect(post.userVote).toBe(Vote.Down);
    expect(post.isStickied).toBe(true);
    expect(post.interactionStatus).toBe("locked");
    expect(post.externalLink).toBe("https://example.com/article");
    expect(post.media).toEqual([
      expect.objectContaining({
        kind: "link",
        url: "https://example.com/article",
      }),
    ]);
    expect(post.community.handle).toBe("r/news");
  });

  it("keeps externalLink for a link post that ALSO has a preview image", () => {
    // Reddit attaches a preview to most link posts; it must stay a link, not be
    // misclassified as an image post (which hid the click-through).
    const post = mapPost({
      data: {
        name: "t3_lp1",
        title: "Article with a preview image",
        url: "https://example.com/news",
        post_hint: "link",
        ups: 9,
        num_comments: 3,
        created: 1_700_000_000,
        subreddit: "news",
        preview: {
          images: [
            {
              source: {
                url: "https://preview.redd.it/p.jpg",
                width: 800,
                height: 600,
              },
              resolutions: [
                {
                  url: "https://preview.redd.it/p.jpg?w=320",
                  width: 320,
                  height: 240,
                },
              ],
            },
          ],
        },
      },
    });
    expect(post.externalLink).toBe("https://example.com/news");
    expect(post.media.some((m) => m.kind === "image")).toBe(true);
  });

  it("does not set externalLink on a direct image post", () => {
    // imageChild's url is https://i.redd.it/xyz.jpg — the image IS the content.
    expect(mapPost(imageChild).externalLink).toBeUndefined();
  });

  it("maps poll_data into a unified PollData (read-only)", () => {
    const post = mapPost({
      data: {
        ...selfChild.data,
        name: "t3_poll1",
        poll_data: {
          total_vote_count: 30,
          voting_end_timestamp: 1_600_000_000_000, // in the past -> closed
          user_selection: "opt2",
          options: [
            { id: "opt1", text: "Red", vote_count: 10 },
            { id: "opt2", text: "Blue &amp; Green", vote_count: 20 },
          ],
        },
      },
    });
    expect(post.poll).toBeDefined();
    expect(post.poll!.totalVotes).toBe(30);
    expect(post.poll!.closed).toBe(true);
    expect(post.poll!.userSelection).toBe("opt2");
    expect(post.poll!.options[1]).toMatchObject({
      id: "opt2",
      text: "Blue & Green",
      voteCount: 20,
    });
  });

  it("leaves poll undefined on non-poll posts", () => {
    expect(mapPost(selfChild).poll).toBeUndefined();
  });
});

describe("mapPost — animated media (gifs and videos)", () => {
  const base = {
    name: "t3_anim1",
    title: "moving picture",
    ups: 5,
    num_comments: 1,
    created: 1_700_000_000,
    subreddit: "gifs",
  };

  it("surfaces a gif post as its mp4 variant (silent looping video), not the still", () => {
    const post = mapPost({
      data: {
        ...base,
        url: "https://i.redd.it/cat.gif",
        post_hint: "image",
        preview: {
          images: [
            {
              source: {
                url: "https://preview.redd.it/cat.gif",
                width: 480,
                height: 360,
              },
              resolutions: [
                {
                  url: "https://preview.redd.it/cat.gif?w=108",
                  width: 108,
                  height: 81,
                },
              ],
              variants: {
                mp4: {
                  source: {
                    url: "https://preview.redd.it/cat.mp4?s=sig",
                    width: 480,
                    height: 360,
                  },
                },
              },
            },
          ],
        },
      },
    });
    expect(post.media).toHaveLength(1);
    expect(post.media[0]).toMatchObject({
      kind: "video",
      url: "https://preview.redd.it/cat.mp4?s=sig",
      isGif: true,
      thumbnailUrl: "https://preview.redd.it/cat.gif?w=108",
    });
    expect(post.externalLink).toBeUndefined();
  });

  it("plays rich:video embeds via preview.reddit_video_preview (redgifs etc.)", () => {
    const post = mapPost({
      data: {
        ...base,
        url: "https://www.redgifs.com/watch/thing",
        post_hint: "rich:video",
        preview: {
          reddit_video_preview: {
            hls_url: "https://v.redd.it/abc/HLSPlaylist.m3u8",
            fallback_url: "https://v.redd.it/abc/DASH_720.mp4",
            width: 1280,
            height: 720,
            is_gif: true,
          },
          images: [
            {
              source: {
                url: "https://preview.redd.it/poster.jpg",
                width: 1280,
                height: 720,
              },
              resolutions: [],
            },
          ],
        },
      },
    });
    const videos = post.media.filter((m) => m.kind === "video");
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      hlsUrl: "https://v.redd.it/abc/HLSPlaylist.m3u8",
      isGif: true,
    });
    // The preview image folds in as the poster instead of a second medium.
    expect(post.media).toHaveLength(1);
    expect(videos[0].thumbnailUrl).toBe("https://preview.redd.it/poster.jpg");
  });

  it("does not duplicate a v.redd.it video with its frozen preview slide", () => {
    const post = mapPost({
      data: {
        ...base,
        url: "https://v.redd.it/xyz",
        post_hint: "hosted:video",
        media: {
          reddit_video: {
            hls_url: "https://v.redd.it/xyz/HLSPlaylist.m3u8",
            fallback_url: "https://v.redd.it/xyz/DASH_1080.mp4",
            width: 1920,
            height: 1080,
          },
        },
        preview: {
          images: [
            {
              source: {
                url: "https://preview.redd.it/frame.jpg",
                width: 1920,
                height: 1080,
              },
              resolutions: [
                {
                  url: "https://preview.redd.it/frame.jpg?w=320",
                  width: 320,
                  height: 180,
                },
              ],
            },
          ],
        },
      },
    });
    expect(post.media).toHaveLength(1);
    expect(post.media[0]).toMatchObject({
      kind: "video",
      thumbnailUrl: "https://preview.redd.it/frame.jpg?w=320",
    });
  });

  it("rewrites a bare .gifv link to its mp4 and keeps it out of externalLink", () => {
    const post = mapPost({
      data: { ...base, url: "https://i.imgur.com/abc.gifv" },
    });
    expect(post.media).toEqual([
      expect.objectContaining({
        kind: "video",
        url: "https://i.imgur.com/abc.mp4",
        isGif: true,
      }),
    ]);
    expect(post.externalLink).toBeUndefined();
  });

  it("maps a direct mp4 / gif url with no preview payload to playable media", () => {
    expect(
      mapPost({ data: { ...base, url: "https://files.catbox.moe/x.mp4" } })
        .media[0],
    ).toMatchObject({ kind: "video", url: "https://files.catbox.moe/x.mp4" });
    expect(
      mapPost({ data: { ...base, url: "https://i.redd.it/y.gif" } }).media[0],
    ).toMatchObject({ kind: "image", url: "https://i.redd.it/y.gif" });
  });

  it("uses the animated gif rendition for animated gallery entries (s.gif, no s.u)", () => {
    const post = mapPost({
      data: {
        ...base,
        is_gallery: true,
        gallery_data: { items: [{ media_id: "m1" }, { media_id: "m2" }] },
        media_metadata: {
          m1: {
            id: "m1",
            e: "AnimatedImage",
            s: {
              gif: "https://i.redd.it/m1.gif",
              mp4: "https://i.redd.it/m1.mp4",
              x: 400,
              y: 300,
            },
            p: [{ u: "https://preview.redd.it/m1.jpg?w=108", x: 108, y: 81 }],
          },
          m2: {
            id: "m2",
            e: "Image",
            s: { u: "https://i.redd.it/m2.jpg", x: 800, y: 600 },
            p: [{ u: "https://preview.redd.it/m2.jpg?w=108", x: 108, y: 81 }],
          },
        },
      },
    });
    expect(post.media).toHaveLength(2);
    expect(post.media[0]).toMatchObject({
      kind: "gallery",
      url: "https://i.redd.it/m1.gif",
      isGif: true,
    });
    expect(post.media[1]).toMatchObject({
      kind: "gallery",
      url: "https://i.redd.it/m2.jpg",
    });
  });

  it("falls back to the crosspost parent's video when the child has none", () => {
    const post = mapPost({
      data: {
        ...base,
        url: "https://v.redd.it/parent1",
        crosspost_parent_list: [
          {
            over_18: false,
            media: {
              reddit_video: {
                hls_url: "https://v.redd.it/parent1/HLSPlaylist.m3u8",
                fallback_url: "https://v.redd.it/parent1/DASH_720.mp4",
                width: 1280,
                height: 720,
              },
            },
          },
        ],
      },
    });
    expect(post.media[0]).toMatchObject({
      kind: "video",
      hlsUrl: "https://v.redd.it/parent1/HLSPlaylist.m3u8",
    });
  });
});
