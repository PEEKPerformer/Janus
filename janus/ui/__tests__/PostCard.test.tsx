import React from "react";
import { render, fireEvent, screen } from "@testing-library/react-native";
import { PostCard } from "../components/PostCard";
import * as links from "../links";
import { mapLemmyPost } from "../../sources/lemmy/mappers";
import { lemmyListFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";

const imagePost = mapLemmyPost(lemmyListFixture.posts[0], "lemmy.world");
const linkPost = mapLemmyPost(lemmyListFixture.posts[1], "lemmy.world");

describe("PostCard", () => {
  it("renders title, community, score, comments and author", () => {
    render(<PostCard post={imagePost} onPress={() => {}} />);
    // Card is one accessibility element (composed label); header/footer text is
    // visible to sighted users but hidden from the a11y tree, so query with
    // includeHiddenElements to assert the visual content.
    const opts = { includeHiddenElements: true } as const;
    expect(screen.getByText("A local image post")).toBeTruthy();
    expect(screen.getByText("technology", opts)).toBeTruthy(); // local handle
    expect(screen.getByText("321 points", opts)).toBeTruthy(); // score (non-vote stat)
    expect(screen.getByText("12", opts)).toBeTruthy(); // comment count
    expect(screen.getByText("alice", opts)).toBeTruthy(); // author
  });

  it("calls onPress when tapped, with a descriptive accessibility label", () => {
    const onPress = jest.fn();
    render(<PostCard post={imagePost} onPress={onPress} />);
    // Composed label includes community, title, points, comments and author.
    fireEvent.press(
      screen.getByLabelText(/A local image post.*points.*comments.*by alice/),
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("shows the instance-qualified handle for a federated community", () => {
    render(<PostCard post={linkPost} onPress={() => {}} />);
    expect(
      screen.getByText("news@beehaw.org", { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it("compact mode still renders all the key fields (title, handle, score, comments, author)", () => {
    render(<PostCard post={imagePost} onPress={() => {}} compact />);
    const opts = { includeHiddenElements: true } as const;
    expect(screen.getByText("A local image post")).toBeTruthy();
    expect(screen.getByText("technology", opts)).toBeTruthy();
    expect(screen.getByText("321 points", opts)).toBeTruthy();
    expect(screen.getByText("12", opts)).toBeTruthy();
    expect(screen.getByText("alice", opts)).toBeTruthy();
  });

  it("showSource attributes a post to its actual instance, not generic 'lemmy'", () => {
    render(<PostCard post={imagePost} onPress={() => {}} compact showSource />);
    // imagePost was mapped with instance "lemmy.world" — that's the attribution.
    expect(
      screen.getByText("lemmy.world", { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it("opens the image viewer (not the post) when a thumbnail is tapped", () => {
    const onPress = jest.fn();
    const onOpenImage = jest.fn();
    render(
      <PostCard
        post={imagePost}
        onPress={onPress}
        onOpenImage={onOpenImage}
        compact
      />,
    );
    fireEvent.press(screen.getByLabelText(/View image/));
    expect(onOpenImage).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]),
      0,
    );
    expect(onPress).not.toHaveBeenCalled(); // tapping the image must not open the post
  });

  it("a link post (even with a preview image) clicks through to the link, not the viewer", () => {
    const onOpenImage = jest.fn();
    const spy = jest.spyOn(links, "openExternal").mockResolvedValue(true);
    // imagePost has image media; adding externalLink makes it a link-with-preview.
    const linkWithPreview = {
      ...imagePost,
      externalLink: "https://example.com/story",
    };
    render(
      <PostCard
        post={linkWithPreview}
        onPress={() => {}}
        onOpenImage={onOpenImage}
        compact
      />,
    );
    fireEvent.press(screen.getByLabelText("Open link"));
    expect(spy).toHaveBeenCalledWith("https://example.com/story");
    expect(onOpenImage).not.toHaveBeenCalled(); // must NOT open the image viewer
    spy.mockRestore();
  });

  it("renders a tappable video player for a video post (comfortable)", () => {
    const videoPost = {
      ...imagePost,
      media: [
        {
          kind: "video" as const,
          url: "https://v.redd.it/abc/DASH_720.mp4",
          hlsUrl: "https://v.redd.it/abc/HLSPlaylist.m3u8",
          thumbnailUrl: "https://i.redd.it/abc.jpg",
          aspectRatio: 1.0,
          isNSFW: false,
        },
      ],
    };
    render(<PostCard post={videoPost} onPress={() => {}} />);
    expect(screen.getByLabelText("Play video")).toBeTruthy();
  });

  it("renders poll options and tally in the feed card", () => {
    const pollPost = {
      ...imagePost,
      media: [],
      poll: {
        options: [
          { id: "a", text: "Cats", voteCount: 7 },
          { id: "b", text: "Dogs", voteCount: 3 },
        ],
        totalVotes: 10,
        closed: true,
        userSelection: "a",
      },
    };
    render(<PostCard post={pollPost} onPress={() => {}} />);
    const opts = { includeHiddenElements: true } as const;
    expect(screen.getByText("Cats", opts)).toBeTruthy();
    expect(screen.getByText("Dogs", opts)).toBeTruthy();
    expect(screen.getByText("10 votes · Final results", opts)).toBeTruthy();
  });

  it("renders a crosspost's original as a nested card and opens it on tap", () => {
    const original: any = {
      ...imagePost,
      id: "reddit:www.reddit.com:post:orig",
      title: "The original post",
      community: { ...imagePost.community, handle: "r/pics" },
      ext: { source: "reddit" },
    };
    const wrapper: any = {
      ...imagePost,
      id: "reddit:www.reddit.com:post:xpost",
      title: "Look at this",
      media: [],
      ext: { source: "reddit", crossPost: original },
    };
    const onOpenPost = jest.fn();
    render(
      <PostCard post={wrapper} onPress={() => {}} onOpenPost={onOpenPost} />,
    );
    const opts = { includeHiddenElements: true } as const;
    expect(screen.getByText("Crossposted from r/pics", opts)).toBeTruthy();
    expect(screen.getByText("The original post", opts)).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/Crossposted from r\/pics/));
    expect(onOpenPost).toHaveBeenCalledWith(original);
  });

  it("compact video thumb opens the post on tap", () => {
    const onPress = jest.fn();
    const videoPost = {
      ...imagePost,
      media: [
        {
          kind: "video" as const,
          url: "https://v.redd.it/abc/DASH_720.mp4",
          hlsUrl: "https://v.redd.it/abc/HLSPlaylist.m3u8",
          thumbnailUrl: "https://i.redd.it/abc.jpg",
          isNSFW: false,
        },
      ],
    };
    render(<PostCard post={videoPost} onPress={onPress} compact />);
    fireEvent.press(screen.getByLabelText("Play video"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
