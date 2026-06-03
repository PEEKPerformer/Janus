import React from "react";
import { render, fireEvent, screen } from "@testing-library/react-native";
import { VoteControl } from "../components/VoteControl";
import { Vote } from "../../core/vote";

describe("VoteControl", () => {
  it("shows the score and reports up/down votes", () => {
    const onVote = jest.fn();
    render(<VoteControl score={1234} userVote={Vote.None} onVote={onVote} />);
    expect(screen.getByText("1.2k")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Upvote"));
    expect(onVote).toHaveBeenCalledWith(Vote.Up);
    fireEvent.press(screen.getByLabelText("Downvote"));
    expect(onVote).toHaveBeenCalledWith(Vote.Down);
  });

  it("untoggles when pressing the already-selected direction", () => {
    const onVote = jest.fn();
    render(<VoteControl score={5} userVote={Vote.Up} onVote={onVote} />);
    fireEvent.press(screen.getByLabelText("Upvote"));
    expect(onVote).toHaveBeenCalledWith(Vote.None);
  });

  it("masks the score when hidden", () => {
    render(
      <VoteControl
        score={5}
        userVote={Vote.None}
        scoreHidden
        onVote={() => {}}
      />,
    );
    expect(screen.getByText("•")).toBeTruthy();
  });

  it("hides the downvote button when downvotes are disabled (e.g. Hexbear)", () => {
    render(
      <VoteControl
        score={5}
        userVote={Vote.None}
        onVote={() => {}}
        allowDownvote={false}
      />,
    );
    expect(screen.getByLabelText("Upvote")).toBeTruthy();
    expect(screen.queryByLabelText("Downvote")).toBeNull();
  });
});
