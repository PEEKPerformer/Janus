import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MarkdownToolbar } from "../components/MarkdownToolbar";

describe("MarkdownToolbar", () => {
  it("fires onFormat with the tapped action", () => {
    const onFormat = jest.fn();
    render(
      <MarkdownToolbar
        onFormat={onFormat}
        onTogglePreview={() => {}}
        previewing={false}
      />,
    );
    fireEvent.press(screen.getByLabelText("Bold"));
    expect(onFormat).toHaveBeenCalledWith("bold");
    fireEvent.press(screen.getByLabelText("Spoiler"));
    expect(onFormat).toHaveBeenCalledWith("spoiler");
  });

  it("shows the emoji button only when onEmoji is provided", () => {
    const { rerender } = render(
      <MarkdownToolbar
        onFormat={() => {}}
        onTogglePreview={() => {}}
        previewing={false}
      />,
    );
    expect(screen.queryByLabelText("Insert emoji")).toBeNull();

    const onEmoji = jest.fn();
    rerender(
      <MarkdownToolbar
        onFormat={() => {}}
        onEmoji={onEmoji}
        onTogglePreview={() => {}}
        previewing={false}
      />,
    );
    fireEvent.press(screen.getByLabelText("Insert emoji"));
    expect(onEmoji).toHaveBeenCalled();
  });

  it("toggles preview", () => {
    const onTogglePreview = jest.fn();
    render(
      <MarkdownToolbar
        onFormat={() => {}}
        onTogglePreview={onTogglePreview}
        previewing={false}
      />,
    );
    fireEvent.press(screen.getByLabelText("Preview"));
    expect(onTogglePreview).toHaveBeenCalled();
  });
});
