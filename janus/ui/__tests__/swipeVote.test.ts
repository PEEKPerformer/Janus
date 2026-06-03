import {
  resolveSwipeAction,
  nextVote,
  applyVote,
  DEFAULT_THRESHOLDS,
} from "../swipeVote";
import { Vote } from "../../core/vote";

const T = { ...DEFAULT_THRESHOLDS, allowDownvote: true };

describe("resolveSwipeAction", () => {
  it("does nothing below the first threshold (minimizes accidental swipes)", () => {
    expect(resolveSwipeAction(0, T)).toBeNull();
    expect(resolveSwipeAction(40, T)).toBeNull();
    expect(resolveSwipeAction(-40, T)).toBeNull();
  });

  it("short right = upvote, long right = downvote", () => {
    expect(resolveSwipeAction(80, T)).toBe("upvote");
    expect(resolveSwipeAction(140, T)).toBe("downvote");
  });

  it("left = save", () => {
    expect(resolveSwipeAction(-80, T)).toBe("save");
  });

  it("never downvotes when the instance disables it", () => {
    const noDown = { ...DEFAULT_THRESHOLDS, allowDownvote: false };
    expect(resolveSwipeAction(140, noDown)).toBe("upvote"); // stays upvote
  });
});

describe("nextVote / applyVote", () => {
  it("toggles a repeated vote back to none", () => {
    expect(nextVote(Vote.Up, Vote.Up)).toBe(Vote.None);
    expect(nextVote(Vote.None, Vote.Up)).toBe(Vote.Up);
    expect(nextVote(Vote.Up, Vote.Down)).toBe(Vote.Down);
  });

  it("adjusts score by the vote delta", () => {
    expect(applyVote({ userVote: Vote.None, score: 10 }, Vote.Up)).toEqual({
      userVote: Vote.Up,
      score: 11,
    });
    // upvote again clears it
    expect(applyVote({ userVote: Vote.Up, score: 11 }, Vote.Up)).toEqual({
      userVote: Vote.None,
      score: 10,
    });
    // up -> down is a 2-point swing
    expect(applyVote({ userVote: Vote.Up, score: 11 }, Vote.Down)).toEqual({
      userVote: Vote.Down,
      score: 9,
    });
  });
});
