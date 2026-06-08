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

    fireEvent.changeText(screen.getByLabelText("Search"), "cats");
    expect(await screen.findByText("A local image post")).toBeTruthy();
    expect(search).toHaveBeenCalledWith("cats", "posts", expect.anything());
  });

  it("switches scope to communities and opens one", async () => {
    const community: any = {
      id: "lemmy:lemmy.world:community:1",
      dedupKey: "dk",
      source: "lemmy" as const,
      instance: "lemmy.world",
      name: "cats",
      handle: "cats@lemmy.world",
      subscriberCount: 1234,
      subscription: "none" as const,
      isNSFW: false,
      isModerator: false,
      postingRestrictedToMods: false,
      permalinkRoute: { kind: "community" as const, params: {} },
      ext: { source: "lemmy" as const, apId: "x", local: true },
    };
    const search = jest.fn(async (_q: string, kind: string) => ({
      items: kind === "communities" ? [community] : [],
    }));
    const adapters = makeAdapters({ lemmy: { search } });
    renderWithAdapters(<SearchScreen {...props} />, {
      adapters,
      initialScope: "lemmy",
    });

    fireEvent.press(screen.getByLabelText("Communities"));
    fireEvent.changeText(screen.getByLabelText("Search"), "cats");
    expect(await screen.findByText("cats@lemmy.world")).toBeTruthy();
    expect(search).toHaveBeenCalledWith(
      "cats",
      "communities",
      expect.anything(),
    );

    fireEvent.press(screen.getByLabelText("Open cats@lemmy.world"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("Feed", {
      openCommunity: community,
    });
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

    fireEvent.changeText(screen.getByLabelText("Search"), "kittens");
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
    fireEvent.changeText(screen.getByLabelText("Search"), "a");
    expect(search).not.toHaveBeenCalled();
  });
});
