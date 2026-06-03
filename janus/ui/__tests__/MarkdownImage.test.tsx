import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Markdown } from "../components/Markdown";

describe("Markdown inline images", () => {
  it("renders a standalone image as a collapsible block, not a 🖼 link", () => {
    render(<Markdown source={"![a cat](https://img.example/cat.jpg)"} />);
    // Expanded by default → the header offers to hide it.
    expect(screen.getByLabelText("Hide image: a cat")).toBeTruthy();
    // The old text-link fallback is gone.
    expect(screen.queryByText(/🖼/)).toBeNull();
  });

  it("collapses and expands on header tap", () => {
    render(<Markdown source={"![pic](https://img.example/p.png)"} />);
    fireEvent.press(screen.getByLabelText("Hide image: pic"));
    expect(screen.getByLabelText("Show image: pic")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Show image: pic"));
    expect(screen.getByLabelText("Hide image: pic")).toBeTruthy();
  });

  it("falls back to a default label when alt text is empty", () => {
    render(<Markdown source={"![](https://img.example/x.jpg)"} />);
    expect(screen.getByLabelText("Hide image: Image")).toBeTruthy();
  });
});
