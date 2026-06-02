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
    fireEvent.press(screen.getByLabelText(/A local image post.*points.*comments.*by alice/));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("shows the instance-qualified handle for a federated community", () => {
    render(<PostCard post={linkPost} onPress={() => {}} />);
    expect(screen.getByText("news@beehaw.org", { includeHiddenElements: true })).toBeTruthy();
  });
});
