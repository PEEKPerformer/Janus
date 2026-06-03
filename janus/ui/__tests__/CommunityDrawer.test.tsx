import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react-native";
import { CommunityDrawer } from "../components/CommunityDrawer";
import { renderWithAdapters, makeAdapters } from "./testUtils";
import { buildId } from "../../core/ids";
import type { Community } from "../../core/model";
import type { FeedGroup } from "../../app/feedGroups";

const groups: FeedGroup[] = [
  {
    id: "g1",
    name: "Privacy",
    members: [
      { source: "reddit", name: "privacy" },
      { source: "lemmy", instance: "lemmy.ml", name: "privacy" },
    ],
  },
];

function renderOpen(
  overrides: Partial<React.ComponentProps<typeof CommunityDrawer>> = {},
) {
  const props = {
    open: true,
    onOpenChange: jest.fn(),
    groups,
    currentMode: "subscribed" as const,
    hasActiveSelection: false,
    onSelectScope: jest.fn(),
    onSelectGroup: jest.fn(),
    onSelectCommunity: jest.fn(),
    onSelectFavorite: jest.fn(),
    onOpenSearch: jest.fn(),
    onOpenSettings: jest.fn(),
    ...overrides,
  };
  renderWithAdapters(<CommunityDrawer {...props} />);
  return props;
}

describe("CommunityDrawer", () => {
  it("renders unified scopes, the cross-source group, and search when open", () => {
    renderOpen();
    expect(screen.getByLabelText("Subscribed feed")).toBeTruthy();
    expect(screen.getByLabelText("All feed")).toBeTruthy();
    expect(screen.getByLabelText("Local feed")).toBeTruthy();
    expect(screen.getByLabelText("Privacy group")).toBeTruthy();
    expect(screen.getByLabelText("Search all communities")).toBeTruthy();
  });

  it("routes a scope tap to onSelectScope", () => {
    const { onSelectScope } = renderOpen();
    fireEvent.press(screen.getByLabelText("All feed"));
    expect(onSelectScope).toHaveBeenCalledWith("all");
  });

  it("routes the search affordance to onOpenSearch", () => {
    const { onOpenSearch } = renderOpen();
    fireEvent.press(screen.getByLabelText("Search all communities"));
    expect(onOpenSearch).toHaveBeenCalled();
  });

  it("routes a group tap to onSelectGroup", () => {
    const { onSelectGroup } = renderOpen();
    fireEvent.press(screen.getByLabelText("Privacy group"));
    expect(onSelectGroup).toHaveBeenCalledWith(groups[0]);
  });

  it("filters the subscribed community list by the search query", async () => {
    const communities = [
      {
        id: "lemmy:lemmy.world:community:priv",
        dedupKey: "priv",
        source: "lemmy",
        instance: "lemmy.world",
        name: "privacy",
        handle: "privacy",
        subscriberCount: 10,
      },
      {
        id: "lemmy:lemmy.world:community:tech",
        dedupKey: "tech",
        source: "lemmy",
        instance: "lemmy.world",
        name: "technology",
        handle: "technology",
        subscriberCount: 20,
      },
    ] as unknown as Community[];
    const adapters = makeAdapters({
      lemmy: {
        account: {
          id: buildId({
            source: "lemmy",
            instance: "lemmy.world",
            kind: "user",
            nativeId: "alice",
          }),
          source: "lemmy",
          instance: "lemmy.world",
          username: "alice",
          isGuest: false,
        },
        getSubscriptions: async () => communities,
      },
    });
    const props = {
      open: true,
      onOpenChange: jest.fn(),
      groups,
      currentMode: "subscribed" as const,
      hasActiveSelection: false,
      onSelectScope: jest.fn(),
      onSelectGroup: jest.fn(),
      onSelectCommunity: jest.fn(),
      onSelectFavorite: jest.fn(),
      onOpenSearch: jest.fn(),
      onOpenSettings: jest.fn(),
    };
    renderWithAdapters(<CommunityDrawer {...props} />, { adapters });

    // Both communities load.
    await screen.findByLabelText("privacy on lemmy.world");
    expect(screen.getByLabelText("technology on lemmy.world")).toBeTruthy();

    // Filtering to "priv" hides the non-match.
    fireEvent.changeText(
      screen.getByLabelText("Filter subscribed communities"),
      "priv",
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("technology on lemmy.world")).toBeNull(),
    );
    expect(screen.getByLabelText("privacy on lemmy.world")).toBeTruthy();
  });
});
