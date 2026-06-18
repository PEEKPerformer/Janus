import React from "react";
import { Text } from "react-native";
import { render, fireEvent, screen } from "@testing-library/react-native";
import { PressableScale } from "../components/PressableScale";

describe("PressableScale", () => {
  it("renders children and forwards press + accessibility props", () => {
    const onPress = jest.fn();
    render(
      <PressableScale accessibilityLabel="Sort by Top" onPress={onPress}>
        <Text>Top</Text>
      </PressableScale>,
    );
    expect(screen.getByText("Top")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Sort by Top"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("still calls a caller's onPressIn/onPressOut after kicking the scale", () => {
    const onPressIn = jest.fn();
    const onPressOut = jest.fn();
    render(
      <PressableScale
        accessibilityLabel="chip"
        onPressIn={onPressIn}
        onPressOut={onPressOut}
      >
        <Text>chip</Text>
      </PressableScale>,
    );
    const el = screen.getByLabelText("chip");
    fireEvent(el, "pressIn");
    fireEvent(el, "pressOut");
    expect(onPressIn).toHaveBeenCalledTimes(1);
    expect(onPressOut).toHaveBeenCalledTimes(1);
  });
});
