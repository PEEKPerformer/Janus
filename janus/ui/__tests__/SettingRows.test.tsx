import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ToggleRow, ChoiceRow, StepperRow } from "../components/SettingRows";

describe("ToggleRow", () => {
  it("fires onChange with the toggled value", () => {
    const onChange = jest.fn();
    render(<ToggleRow label="Haptics" value={false} onChange={onChange} />);
    fireEvent(screen.getByLabelText("Haptics"), "valueChange", true);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("ChoiceRow", () => {
  const opts = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Bravo" },
  ] as const;

  it("marks the active option selected and fires on press", () => {
    const onChange = jest.fn();
    render(
      <ChoiceRow label="Pick" value="a" options={opts} onChange={onChange} />,
    );
    expect(
      screen.getByLabelText("Pick: Alpha").props.accessibilityState.selected,
    ).toBe(true);
    fireEvent.press(screen.getByLabelText("Pick: Bravo"));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("StepperRow", () => {
  const base = {
    label: "Text size",
    value: 1,
    display: "100%",
    min: 0.85,
    max: 1.4,
    step: 0.05,
  };

  it("increments and decrements by step", () => {
    const onChange = jest.fn();
    render(<StepperRow {...base} onChange={onChange} />);
    fireEvent.press(screen.getByLabelText("Increase Text size"));
    expect(onChange).toHaveBeenCalledWith(1.05);
    fireEvent.press(screen.getByLabelText("Decrease Text size"));
    expect(onChange).toHaveBeenCalledWith(0.95);
  });

  it("does not exceed the max bound", () => {
    const onChange = jest.fn();
    render(
      <StepperRow {...base} value={1.4} display="140%" onChange={onChange} />,
    );
    fireEvent.press(screen.getByLabelText("Increase Text size"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
