import React from "react";
import { screen, fireEvent } from "@testing-library/react-native";
import { CommunityDrawer } from "../components/CommunityDrawer";
import { renderWithAdapters } from "./testUtils";
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
    groups,
    currentMode: "subscribed" as const,
    hasActiveSelection: false,
    onSelectScope: jest.fn(),
    onSelectGroup: jest.fn(),
    onSelectCommunity: jest.fn(),
    onOpenSearch: jest.fn(),
    initialOpen: true,
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
});
