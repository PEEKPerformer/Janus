import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react-native";
import { ComposeScreen } from "../screens/ComposeScreen";
import {
  renderWithAdapters,
  makeAdapters,
  mockNavigation,
  mockRoute,
} from "./testUtils";
import { mapLemmyPost, mapLemmyCommunity } from "../../sources/lemmy/mappers";
import { lemmyListFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";

const community = mapLemmyCommunity(
  {
    community: {
      id: 7,
      name: "technology",
      title: "Tech",
      local: true,
      actor_id: "https://lemmy.world/c/technology",
    },
    counts: { subscribers: 50 },
  },
  "lemmy.world",
);
const createdPost = mapLemmyPost(lemmyListFixture.posts[0], "lemmy.world");

function props(presetCommunity?: typeof community) {
  return {
    navigation: mockNavigation as any,
    route: mockRoute(presetCommunity ? { presetCommunity } : undefined) as any,
  };
}

describe("ComposeScreen", () => {
  it("submits a self post to the chosen community and opens it", async () => {
    const submitPost = jest.fn(async () => createdPost);
    const adapters = makeAdapters({ lemmy: { submitPost } });
    renderWithAdapters(<ComposeScreen {...props(community)} />, { adapters });

    fireEvent.changeText(screen.getByLabelText("Post title"), "Hello world");
    fireEvent.changeText(screen.getByLabelText("Post body"), "Some body text");
    fireEvent.press(screen.getByLabelText("Submit post"));

    await waitFor(() =>
      expect(submitPost).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: community.id,
          title: "Hello world",
          kind: "self",
          markdown: "Some body text",
        }),
      ),
    );
    expect(mockNavigation.replace).toHaveBeenCalledWith("Post", {
      post: createdPost,
    });
  });

  it("requires a community and a title before it can submit", () => {
    const submitPost = jest.fn(async () => createdPost);
    const adapters = makeAdapters({ lemmy: { submitPost } });
    renderWithAdapters(<ComposeScreen {...props()} />, { adapters }); // no preset, no title
    fireEvent.press(screen.getByLabelText("Submit post"));
    expect(submitPost).not.toHaveBeenCalled();
  });

  it("validates link posts require an http(s) URL", async () => {
    const submitPost = jest.fn(async () => createdPost);
    const adapters = makeAdapters({ lemmy: { submitPost } });
    renderWithAdapters(<ComposeScreen {...props(community)} />, { adapters });
    fireEvent.changeText(screen.getByLabelText("Post title"), "A link");
    fireEvent.press(screen.getByLabelText("Link post"));
    fireEvent.changeText(screen.getByLabelText("Link URL"), "not-a-url");
    fireEvent.press(screen.getByLabelText("Submit post"));
    expect(submitPost).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid http(s) URL.")).toBeTruthy();

    fireEvent.changeText(
      screen.getByLabelText("Link URL"),
      "https://example.com",
    );
    fireEvent.press(screen.getByLabelText("Submit post"));
    await waitFor(() =>
      expect(submitPost).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "link", url: "https://example.com" }),
      ),
    );
  });
});
