import {
  resolveSwipeAction,
  nextVote,
  applyVote,
  DEFAULT_THRESHOLDS,
} from "../swipeVote";
import { DEFAULT_SWIPE } from "../../app/settingsStore";
import { Vote } from "../../core/vote";

const T = { ...DEFAULT_THRESHOLDS, allowDownvote: true };

describe("resolveSwipeAction", () => {
  it("does nothing below the first threshold (minimizes accidental swipes)", () => {
    expect(resolveSwipeAction(0, T)).toBe("none");
    expect(resolveSwipeAction(40, T)).toBe("none");
    expect(resolveSwipeAction(-40, T)).toBe("none");
  });

  it("uses the default mapping: short right = upvote, long right = downvote", () => {
    expect(resolveSwipeAction(80, T)).toBe("upvote");
    expect(resolveSwipeAction(140, T)).toBe("downvote");
  });

  it("left = save by default (short tier), long-left unmapped", () => {
    expect(resolveSwipeAction(-80, T)).toBe("save");
    expect(resolveSwipeAction(-140, T)).toBe("none"); // leftLong defaults to "none"
  });

  it("never downvotes when the instance disables it", () => {
    const noDown = { ...DEFAULT_THRESHOLDS, allowDownvote: false };
    expect(resolveSwipeAction(140, noDown)).toBe("upvote"); // degrades to upvote
  });

  it("honours a custom slot mapping", () => {
    const swapped = {
      ...DEFAULT_THRESHOLDS,
      allowDownvote: true,
      config: {
        rightShort: "save" as const,
        rightLong: "save" as const,
        leftShort: "upvote" as const,
        leftLong: "downvote" as const,
      },
    };
    expect(resolveSwipeAction(80, swapped)).toBe("save");
    expect(resolveSwipeAction(-80, swapped)).toBe("upvote");
    expect(resolveSwipeAction(-140, swapped)).toBe("downvote");
  });

  it("falls back to the default config when none is supplied", () => {
    expect(DEFAULT_SWIPE.rightShort).toBe("upvote");
    expect(resolveSwipeAction(80, T)).toBe("upvote");
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
    expect(applyVote({ userVote: Vote.Up, score: 11 }, Vote.Up)).toEqual({
      userVote: Vote.None,
      score: 10,
    });
    expect(applyVote({ userVote: Vote.Up, score: 11 }, Vote.Down)).toEqual({
      userVote: Vote.Down,
      score: 9,
    });
  });
});
