import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { LemmyInstanceModal } from "../components/LemmyInstanceModal";
import { normalizeInstance } from "../../sources/lemmy/LemmyInstance";

describe("normalizeInstance", () => {
  it("strips scheme, path, and lowercases", () => {
    expect(normalizeInstance("https://Lemmy.World/")).toBe("lemmy.world");
    expect(normalizeInstance("  beehaw.org/c/news ")).toBe("beehaw.org");
    expect(normalizeInstance("LEMM.EE")).toBe("lemm.ee");
  });
});

describe("LemmyInstanceModal", () => {
  it("selects a popular instance", () => {
    const onSelect = jest.fn();
    render(
      <LemmyInstanceModal
        current="lemmy.world"
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    fireEvent.press(screen.getByText("beehaw.org"));
    expect(onSelect).toHaveBeenCalledWith("beehaw.org");
  });

  it("accepts a normalized custom instance", () => {
    const onSelect = jest.fn();
    render(
      <LemmyInstanceModal
        current="lemmy.world"
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    fireEvent.changeText(
      screen.getByLabelText("Custom instance"),
      "https://Lemmy.Zip/",
    );
    fireEvent.press(screen.getByLabelText("Use custom instance"));
    expect(onSelect).toHaveBeenCalledWith("lemmy.zip");
  });
});
