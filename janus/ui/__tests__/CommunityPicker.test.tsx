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
});
