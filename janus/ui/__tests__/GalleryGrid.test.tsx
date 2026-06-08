import React from "react";
import { render, screen } from "@testing-library/react-native";
import { GalleryGrid, galleryCells } from "../components/GalleryGrid";
import { mapLemmyPost } from "../../sources/lemmy/mappers";
import { lemmyListFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";

const imagePost = mapLemmyPost(lemmyListFixture.posts[0], "lemmy.world"); // image
const linkPost = mapLemmyPost(lemmyListFixture.posts[1], "lemmy.world"); // link, no image

describe("galleryCells", () => {
  it("includes only posts with renderable images", () => {
    const cells = galleryCells([imagePost, linkPost]);
    expect(cells).toHaveLength(1);
    expect(cells[0].post.id).toBe(imagePost.id);
    expect(cells[0].uri).toBe(imagePost.media[0].thumbnailUrl);
    expect(cells[0].key).toBe(`${imagePost.id}:0`);
  });

  it("returns nothing for an image-less feed", () => {
    expect(galleryCells([linkPost])).toEqual([]);
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
});
