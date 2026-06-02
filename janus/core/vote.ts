/**
 * Unified tri-state vote. Maps cleanly onto both Hydra's VoteOption (1/0/-1)
 * and Lemmy's my_vote / score-delta model.
 */
export enum Vote {
  Up = 1,
  None = 0,
  Down = -1,
}

/** Normalize an arbitrary numeric vote signal (e.g. Lemmy my_vote) to Vote. */
export function toVote(n: number | null | undefined): Vote {
  if (n === 1) return Vote.Up;
  if (n === -1) return Vote.Down;
  return Vote.None;
}
