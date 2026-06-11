import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react-native";
import { FeedScreen } from "../screens/FeedScreen";
import {
  renderWithAdapters,
  makeAdapters,
  mockNavigation,
  mockRoute,
} from "./testUtils";
import { mapLemmyPost } from "../../sources/lemmy/mappers";
import { lemmyListFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";
import { NetworkError } from "../../core/errors";
import { buildId } from "../../core/ids";
import { hasSeenHint } from "../../app/hints";
import { setPangramState } from "../../app/pangramModel";

const posts = lemmyListFixture.posts.map((pv: unknown) =>
  mapLemmyPost(pv, "lemmy.world"),
);

const feedProps = {
  navigation: mockNavigation as any,
  route: mockRoute(undefined) as any,
};

describe("FeedScreen", () => {
  it("pitches AI Lens on first load; dismiss persists; installed = no pitch", async () => {
    const adapters = makeAdapters({
      lemmy: { getFeed: async () => ({ items: posts, nextCursor: "c2" }) },
    });
    const first = renderWithAdapters(<FeedScreen {...feedProps} />, {
      adapters,
      initialSource: "lemmy",
    });
    await screen.findByText("A local image post");
    expect(screen.getByText(/Know what's AI/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Set up AI Lens"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("AiLens");
    expect(hasSeenHint("aiLens.hero")).toBe(true);
    expect(screen.queryByText(/Know what's AI/)).toBeNull();
    first.unmount();

    // A device with any install phase never sees the pitch.
    setPangramState({ phase: "ready" });
    renderWithAdapters(<FeedScreen {...feedProps} />, {
      adapters,
      initialSource: "lemmy",
    });
    await screen.findByText("A local image post");
    expect(screen.queryByText(/Know what's AI/)).toBeNull();
  });

  it("renders capability-driven sorts and the fetched posts", async () => {
    const adapters = makeAdapters({
      lemmy: { getFeed: async () => ({ items: posts, nextCursor: "c2" }) },
    });
    renderWithAdapters(<FeedScreen {...feedProps} />, {
      adapters,
      initialSource: "lemmy",
    });

    // Lemmy sort chip present immediately (in the header during loading).
    expect(screen.getByText("Active")).toBeTruthy();
    // Posts arrive asynchronously.
    expect(await screen.findByText("A local image post")).toBeTruthy();
    expect(screen.getByText("A federated link post")).toBeTruthy();
  });

  it("toggles to gallery view, showing image cells", async () => {
    const adapters = makeAdapters({
      lemmy: { getFeed: async () => ({ items: posts, nextCursor: "c2" }) },
    });
    renderWithAdapters(<FeedScreen {...feedProps} />, {
      adapters,
      initialSource: "lemmy",
    });
    await screen.findByText("A local image post"); // list view first
    fireEvent.press(screen.getByLabelText("Switch to gallery view"));
    expect(
      screen.getByLabelText(/image post: A local image post/),
    ).toBeTruthy();
  });

  it("shows a graceful error state with retry when the feed fails", async () => {
    const adapters = makeAdapters({
      lemmy: {
        getFeed: async () => {
          throw new NetworkError("down", 0);
        },
      },
    });
    renderWithAdapters(<FeedScreen {...feedProps} />, {
      adapters,
      initialSource: "lemmy",
    });
    expect(await screen.findByText("Connection problem")).toBeTruthy();
    expect(screen.getByLabelText("Retry")).toBeTruthy();
  });

  it("unified scope merges posts from both sources with source tags", async () => {
    const redditPost = {
      ...posts[0],
      id: "reddit:www.reddit.com:post:abc",
      source: "reddit" as const,
      title: "A reddit post",
      // Distinct content so cross-post collapse doesn't (correctly) fold it
      // into the lemmy post — this test is about merge + source tags.
      media: [],
      externalLink: undefined,
    };
    const adapters = makeAdapters({
      reddit: {
        getFeed: async () => ({ items: [redditPost], nextCursor: undefined }),
      },
      lemmy: {
        getFeed: async () => ({ items: [posts[0]], nextCursor: undefined }),
      },
    });
    renderWithAdapters(<FeedScreen {...feedProps} />, {
      adapters,
      initialScope: "all",
    });
    // Unified sorts (not the Lemmy-specific "Active").
    expect(screen.getByText("Hot")).toBeTruthy();
    expect(await screen.findByText("A reddit post")).toBeTruthy();
    expect(screen.getByText("A local image post")).toBeTruthy();
    // Source tags annotate each card.
    expect(
      screen.getAllByText(/reddit|lemmy/, { includeHiddenElements: true })
        .length,
    ).toBeGreaterThan(0);
  });

  it("switches the listing via the drawer's scope tabs", async () => {
    const signedIn = {
      account: {
        id: buildId({
          source: "lemmy",
          instance: "lemmy.world",
          kind: "user",
          nativeId: "me",
        }),
        source: "lemmy" as const,
        instance: "lemmy.world",
        username: "me",
        isGuest: false,
      },
    };
    const getFeed = jest.fn(async () => ({
      items: posts,
      nextCursor: undefined,
    }));
    const adapters = makeAdapters({
      lemmy: { ...signedIn, getFeed, getSubscriptions: async () => [] },
    });
    renderWithAdapters(<FeedScreen {...feedProps} />, {
      adapters,
      initialScope: "lemmy",
    });
    await screen.findByText("A local image post");
    // Default mode is Subscribed for a signed-in account.
    expect(getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ listingType: "Subscribed" }),
      expect.anything(),
    );

    // Open the drawer (hamburger) and pick the "All" scope.
    fireEvent.press(screen.getByLabelText("Open menu"));
    fireEvent.press(screen.getByLabelText("All feed"));

    await waitFor(() =>
      expect(getFeed).toHaveBeenCalledWith(
        expect.objectContaining({ listingType: "All" }),
        expect.anything(),
      ),
    );
  });
});
