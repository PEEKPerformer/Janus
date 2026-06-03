import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react-native";
import { SearchScreen } from "../screens/SearchScreen";
import {
  renderWithAdapters,
  makeAdapters,
  mockNavigation,
  mockRoute,
} from "./testUtils";
import { mapLemmyPost } from "../../sources/lemmy/mappers";
import { lemmyListFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";

const posts = lemmyListFixture.posts.map((pv: unknown) =>
  mapLemmyPost(pv, "lemmy.world"),
);
const props = {
  navigation: mockNavigation as any,
  route: mockRoute(undefined) as any,
};

describe("SearchScreen", () => {
  it("debounce-searches the scoped source and shows post results", async () => {
    const search = jest.fn(async () => ({ items: posts }));
    const adapters = makeAdapters({ lemmy: { search } });
    renderWithAdapters(<SearchScreen {...props} />, {
      adapters,
      initialScope: "lemmy",
    });

    fireEvent.changeText(screen.getByLabelText("Search posts"), "cats");
    expect(await screen.findByText("A local image post")).toBeTruthy();
    expect(search).toHaveBeenCalledWith("cats", "posts", expect.anything());
  });

  it("searches both sources in All scope", async () => {
    const redditPost = {
      ...posts[0],
      id: "reddit:www.reddit.com:post:z",
      source: "reddit" as const,
      title: "A reddit hit",
    };
    const redditSearch = jest.fn(async () => ({ items: [redditPost] }));
    const lemmySearch = jest.fn(async () => ({ items: [posts[0]] }));
    const adapters = makeAdapters({
      reddit: { search: redditSearch },
      lemmy: { search: lemmySearch },
    });
    renderWithAdapters(<SearchScreen {...props} />, {
      adapters,
      initialScope: "all",
    });

    fireEvent.changeText(screen.getByLabelText("Search posts"), "kittens");
    expect(await screen.findByText("A reddit hit")).toBeTruthy();
    await waitFor(() => expect(lemmySearch).toHaveBeenCalled());
    expect(redditSearch).toHaveBeenCalled();
  });

  it("ignores queries shorter than two characters", () => {
    const search = jest.fn(async () => ({ items: posts }));
    const adapters = makeAdapters({ lemmy: { search } });
    renderWithAdapters(<SearchScreen {...props} />, {
      adapters,
      initialScope: "lemmy",
    });
    fireEvent.changeText(screen.getByLabelText("Search posts"), "a");
    expect(search).not.toHaveBeenCalled();
  });
});
