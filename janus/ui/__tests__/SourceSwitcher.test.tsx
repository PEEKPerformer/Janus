import React from "react";
import { Text } from "react-native";
import { fireEvent, screen } from "@testing-library/react-native";
import { SourceSwitcher } from "../components/SourceSwitcher";
import { useAdapters } from "../AdapterContext";
import { renderWithAdapters } from "./testUtils";

function Probe() {
  const { activeSource } = useAdapters();
  return <Text>active:{activeSource}</Text>;
}

describe("SourceSwitcher", () => {
  it("switches the active source on tap", () => {
    renderWithAdapters(
      <>
        <SourceSwitcher />
        <Probe />
      </>,
      { initialSource: "lemmy" },
    );
    expect(screen.getByText("active:lemmy")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Show Reddit"));
    expect(screen.getByText("active:reddit")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Show Lemmy"));
    expect(screen.getByText("active:lemmy")).toBeTruthy();
  });
});
