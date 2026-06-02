import React from "react";
import { render, fireEvent, screen } from "@testing-library/react-native";
import { PostCard } from "../components/PostCard";
import { mapLemmyPost } from "../../sources/lemmy/mappers";
import { lemmyListFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";

const imagePost = mapLemmyPost(lemmyListFixture.posts[0], "lemmy.world");
const linkPost = mapLemmyPost(lemmyListFixture.posts[1], "lemmy.world");

describe("PostCard", () => {
  it("renders title, community, score, comments and author", () => {
    render(<PostCard post={imagePost} onPress={() => {}} />);
    expect(screen.getByText("A local image post")).toBeTruthy();
    expect(screen.getByText("technology")).toBeTruthy(); // local handle
    expect(screen.getByText("321")).toBeTruthy(); // score
    expect(screen.getByText("12")).toBeTruthy(); // comment count
    expect(screen.getByText("alice")).toBeTruthy(); // author
  });

  it("calls onPress when tapped", () => {
    const onPress = jest.fn();
    render(<PostCard post={imagePost} onPress={onPress} />);
    fireEvent.press(screen.getByLabelText(`Post: ${imagePost.title}`));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("shows the instance-qualified handle for a federated community", () => {
    render(<PostCard post={linkPost} onPress={() => {}} />);
    expect(screen.getByText("news@beehaw.org")).toBeTruthy();
  });
});
