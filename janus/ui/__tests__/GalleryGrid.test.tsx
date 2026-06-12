import React from "react";
import { render, screen } from "@testing-library/react-native";
import { GalleryGrid, galleryCells } from "../components/GalleryGrid";
import { mapLemmyPost } from "../../sources/lemmy/mappers";
import { lemmyListFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";

const imagePost = mapLemmyPost(lemmyListFixture.posts[0], "lemmy.world"); // image
const linkPost = mapLemmyPost(lemmyListFixture.posts[1], "lemmy.world"); // link, no image
// A gif-as-mp4 post the way the Reddit mapper now produces them (r/gifs etc.)
const gifPost = {
  ...imagePost,
  id: `${imagePost.id}-gif` as typeof imagePost.id,
  title: "A gif post",
  media: [
    {
      kind: "video" as const,
      url: "https://preview.redd.it/cat.mp4",
      thumbnailUrl: "https://preview.redd.it/cat-still.jpg",
      isGif: true,
      isNSFW: false,
    },
  ],
};

describe("galleryCells", () => {
  it("includes only posts with renderable media", () => {
    const cells = galleryCells([imagePost, linkPost]);
    expect(cells).toHaveLength(1);
    expect(cells[0].post.id).toBe(imagePost.id);
    expect(cells[0].uri).toBe(imagePost.media[0].thumbnailUrl);
    expect(cells[0].key).toBe(`${imagePost.id}:0`);
  });

  it("returns nothing for a media-less feed", () => {
    expect(galleryCells([linkPost])).toEqual([]);
  });

  it("includes video/gif posts via their poster still (r/gifs blank-grid bug)", () => {
    const cells = galleryCells([gifPost]);
    expect(cells).toHaveLength(1);
    expect(cells[0].uri).toBe("https://preview.redd.it/cat-still.jpg");
  });

  it("skips a video with no poster (nothing to render in an image grid)", () => {
    const bare = {
      ...gifPost,
      media: [
        { kind: "video" as const, url: "https://x/clip.mp4", isNSFW: false },
      ],
    };
    expect(galleryCells([bare])).toEqual([]);
  });
});

describe("GalleryGrid", () => {
  it("renders a tappable cell per image with an accessible label", () => {
    render(
      <GalleryGrid
        posts={[imagePost, linkPost]}
        onPressPost={() => {}}
        onEndReached={() => {}}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );
    expect(
      screen.getByLabelText(/image post: A local image post/),
    ).toBeTruthy();
  });

  it("renders gif posts with a GIF badge and gif-labelled cell", () => {
    render(
      <GalleryGrid
        posts={[gifPost]}
        onPressPost={() => {}}
        onEndReached={() => {}}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByLabelText(/gif post: A gif post/)).toBeTruthy();
    expect(screen.getByText("GIF")).toBeTruthy();
  });
});
