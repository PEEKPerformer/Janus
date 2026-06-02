import React from "react";
import { screen } from "@testing-library/react-native";
import { FeedScreen } from "../screens/FeedScreen";
import { renderWithAdapters, makeAdapters, mockNavigation, mockRoute } from "./testUtils";
import { mapLemmyPost } from "../../sources/lemmy/mappers";
import { lemmyListFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";
import { NetworkError } from "../../core/errors";

const posts = lemmyListFixture.posts.map((pv: unknown) => mapLemmyPost(pv, "lemmy.world"));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const feedProps = { navigation: mockNavigation as any, route: mockRoute(undefined) as any };

describe("FeedScreen", () => {
  it("renders capability-driven sorts and the fetched posts", async () => {
    const adapters = makeAdapters({ lemmy: { getFeed: async () => ({ items: posts, nextCursor: "c2" }) } });
    renderWithAdapters(<FeedScreen {...feedProps} />, { adapters, initialSource: "lemmy" });

    // Lemmy sort chip present immediately (in the header during loading).
    expect(screen.getByText("Active")).toBeTruthy();
    // Posts arrive asynchronously.
    expect(await screen.findByText("A local image post")).toBeTruthy();
    expect(screen.getByText("A federated link post")).toBeTruthy();
  });

  it("shows a graceful error state with retry when the feed fails", async () => {
    const adapters = makeAdapters({ lemmy: { getFeed: async () => { throw new NetworkError("down", 0); } } });
    renderWithAdapters(<FeedScreen {...feedProps} />, { adapters, initialSource: "lemmy" });
    expect(await screen.findByText("Connection problem")).toBeTruthy();
    expect(screen.getByLabelText("Retry")).toBeTruthy();
  });
});
