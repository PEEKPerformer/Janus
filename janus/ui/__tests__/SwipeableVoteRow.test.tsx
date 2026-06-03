import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { SwipeableVoteRow } from "../components/SwipeableVoteRow";
import { Vote } from "../../core/vote";

function wrap(enabled: boolean) {
  return render(
    <SwipeableVoteRow
      enabled={enabled}
      allowDownvote
      userVote={Vote.None}
      saved={false}
      onUpvote={() => {}}
      onDownvote={() => {}}
      onSave={() => {}}
    >
      <Text>card body</Text>
    </SwipeableVoteRow>,
  );
}

describe("SwipeableVoteRow", () => {
  it("renders the wrapped card whether or not swipe is enabled", () => {
    wrap(true);
    expect(screen.getByText("card body")).toBeTruthy();
    screen.unmount();
    wrap(false);
    expect(screen.getByText("card body")).toBeTruthy();
  });
});
