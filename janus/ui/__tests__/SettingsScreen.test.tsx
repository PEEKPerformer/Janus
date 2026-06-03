import React from "react";
import { screen } from "@testing-library/react-native";
import { SettingsScreen } from "../screens/SettingsScreen";
import { renderWithAdapters, mockNavigation } from "./testUtils";

describe("SettingsScreen", () => {
  it("renders the management sections and the guest Lemmy instance", () => {
    renderWithAdapters(
      <SettingsScreen navigation={mockNavigation as any} route={{} as any} />,
    );

    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("ACCOUNTS")).toBeTruthy();
    expect(screen.getByText("LEMMY INSTANCES")).toBeTruthy();
    expect(screen.getByText("GROUPS")).toBeTruthy();

    // No accounts in the mock (guests) → the hint + add buttons show.
    expect(screen.getByText(/Not signed in anywhere yet/i)).toBeTruthy();
    expect(screen.getByLabelText("Add a Reddit account")).toBeTruthy();
    expect(screen.getByLabelText("Add a Lemmy account")).toBeTruthy();

    // The mock Lemmy adapter's instance is listed as a browseable instance.
    expect(screen.getByText("lemmy.world")).toBeTruthy();
  });
});
