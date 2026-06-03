import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { EmojiPicker, filterEmoji } from "../components/EmojiPicker";
import * as Recent from "../recentEmoji";
import type { CustomEmoji } from "../../core/model";

function emoji(
  shortcode: string,
  category: string,
  keywords: string[] = [],
): CustomEmoji {
  return {
    shortcode,
    url: `https://hexbear.net/pictrs/image/${shortcode}.png`,
    category,
    keywords,
    markdown: `![${shortcode}](https://hexbear.net/pictrs/image/${shortcode}.png "emoji ${shortcode}")`,
  };
}

const emojis = [
  emoji("marx-hi", "Theory", ["wave", "greeting"]),
  emoji("lenin-laugh", "Theory"),
  emoji("catgirl-heart", "Cats", ["love"]),
  emoji("doggirl-sleep", "Dogs"),
];

describe("filterEmoji", () => {
  it("matches shortcode, keyword, and category", () => {
    expect(filterEmoji(emojis, "marx").map((e) => e.shortcode)).toEqual([
      "marx-hi",
    ]);
    expect(filterEmoji(emojis, "wave").map((e) => e.shortcode)).toEqual([
      "marx-hi",
    ]);
    expect(filterEmoji(emojis, "cats").map((e) => e.shortcode)).toEqual([
      "catgirl-heart",
    ]);
    expect(filterEmoji(emojis, "").length).toBe(4);
  });
});

describe("EmojiPicker", () => {
  it("inserts the tapped emoji and supports search + category tabs", () => {
    const onSelect = jest.fn();
    render(
      <EmojiPicker
        emojis={emojis}
        popular={["catgirl-heart", "marx-hi"]}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    // Category tabs include Popular + the emoji categories.
    expect(screen.getByLabelText("Popular")).toBeTruthy();
    expect(screen.getByLabelText("Theory")).toBeTruthy();

    // Search narrows the grid; tapping inserts.
    fireEvent.changeText(screen.getByLabelText("Search emoji"), "lenin");
    fireEvent.press(screen.getByLabelText(":lenin-laugh:"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ shortcode: "lenin-laugh" }),
    );
  });

  it("shows a Recent tab seeded from on-device history and records picks", async () => {
    const load = jest
      .spyOn(Recent, "loadRecentEmoji")
      .mockResolvedValue(["catgirl-heart"]);
    const record = jest
      .spyOn(Recent, "recordRecentEmoji")
      .mockResolvedValue(["marx-hi", "catgirl-heart"]);
    render(
      <EmojiPicker
        emojis={emojis}
        popular={[]}
        instance="hexbear.net"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    // Recent tab appears once history loads.
    expect(await screen.findByLabelText("Recent")).toBeTruthy();
    await waitFor(() => expect(load).toHaveBeenCalledWith("hexbear.net"));

    // Picking records to the instance's recent list.
    fireEvent.changeText(screen.getByLabelText("Search emoji"), "marx");
    fireEvent.press(screen.getByLabelText(":marx-hi:"));
    expect(record).toHaveBeenCalledWith("hexbear.net", "marx-hi");

    load.mockRestore();
    record.mockRestore();
  });
});
