import { Vote, toVote } from "../vote";

describe("Vote", () => {
  it("maps numeric vote signals to the tri-state enum", () => {
    expect(toVote(1)).toBe(Vote.Up);
    expect(toVote(-1)).toBe(Vote.Down);
    expect(toVote(0)).toBe(Vote.None);
  });

  it("treats null/undefined as no vote", () => {
    expect(toVote(null)).toBe(Vote.None);
    expect(toVote(undefined)).toBe(Vote.None);
  });

  it("treats unexpected magnitudes as no vote", () => {
    expect(toVote(2)).toBe(Vote.None);
    expect(toVote(-5)).toBe(Vote.None);
  });
});
