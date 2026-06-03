import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { CommunityPicker } from "../components/CommunityPicker";
import { makeAdapters } from "./testUtils";
import { mapRedditCommunity } from "../../sources/reddit/mappers/community";
import { mapLemmyCommunity } from "../../sources/lemmy/mappers";
import { buildId } from "../../core/ids";

const redditUser = {
  id: buildId({
    source: "reddit",
    instance: "www.reddit.com",
    kind: "user",
    nativeId: "me",
  }),
  source: "reddit" as const,
  instance: "www.reddit.com",
  username: "me",
  isGuest: false,
};

const redditCommunity = mapRedditCommunity({
  kind: "t5",
  data: {
    name: "t5_x",
    display_name: "aww",
    title: "Aww",
    subscribers: 100,
    over18: false,
  },
});
const lemmyCommunity = mapLemmyCommunity(
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

describe("CommunityPicker", () => {
  it("searches both sources in 'all' scope and selects a community", async () => {
    const adapters = makeAdapters({
      reddit: { searchCommunities: async () => ({ items: [redditCommunity] }) },
      lemmy: { searchCommunities: async () => ({ items: [lemmyCommunity] }) },
    });
    const onSelect = jest.fn();
    render(
      <CommunityPicker
        adapters={adapters}
        scope="all"
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    fireEvent.changeText(screen.getByLabelText("Search communities"), "tech");

    // Debounced search resolves results from both sources.
    expect(await screen.findByText("r/aww")).toBeTruthy();
    expect(screen.getByText("technology")).toBeTruthy();

    fireEvent.press(screen.getByText("r/aww"));
    expect(onSelect).toHaveBeenCalledWith(redditCommunity);
  });

  it("offers a Default feed shortcut that clears the selection", () => {
    const adapters = makeAdapters();
    const onSelect = jest.fn();
    render(
      <CommunityPicker
        adapters={adapters}
        scope="lemmy"
        current={lemmyCommunity}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    fireEvent.press(screen.getByText("Default feed"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("only searches the active source when scoped to one", async () => {
    const redditSearch = jest.fn(async () => ({ items: [redditCommunity] }));
    const lemmySearch = jest.fn(async () => ({ items: [lemmyCommunity] }));
    const adapters = makeAdapters({
      reddit: { searchCommunities: redditSearch },
      lemmy: { searchCommunities: lemmySearch },
    });
    render(
      <CommunityPicker
        adapters={adapters}
        scope="reddit"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.changeText(screen.getByLabelText("Search communities"), "aww");
    await waitFor(() => expect(redditSearch).toHaveBeenCalled());
    expect(lemmySearch).not.toHaveBeenCalled();
  });

  it("lists the signed-in user's subscriptions and offers a Subscribed feed", async () => {
    const adapters = makeAdapters({
      reddit: {
        account: redditUser,
        getSubscriptions: async () => [redditCommunity],
      },
    });
    const onSelect = jest.fn();
    render(
      <CommunityPicker
        adapters={adapters}
        scope="reddit"
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText("r/aww")).toBeTruthy(); // sidebar list
    expect(screen.getByText("YOUR COMMUNITIES")).toBeTruthy();
    fireEvent.press(screen.getByText("Subscribed"));
    expect(onSelect).toHaveBeenCalledWith("subscribed");
  });

  it("does not show the Subscribed feed when signed out", () => {
    const adapters = makeAdapters();
    render(
      <CommunityPicker
        adapters={adapters}
        scope="reddit"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("Subscribed")).toBeNull();
  });

  it("follow toggle calls setSubscription for the row's source", async () => {
    const setSubscription = jest.fn(async () => redditCommunity);
    const adapters = makeAdapters({
      reddit: {
        account: redditUser,
        getSubscriptions: async () => [],
        setSubscription,
        searchCommunities: async () => ({ items: [redditCommunity] }),
      },
    });
    render(
      <CommunityPicker
        adapters={adapters}
        scope="reddit"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.changeText(screen.getByLabelText("Search communities"), "aww");
    fireEvent.press(await screen.findByLabelText("Follow r/aww"));
    await waitFor(() =>
      expect(setSubscription).toHaveBeenCalledWith(redditCommunity.id, true),
    );
  });
});
