import { Vote } from "../core/vote";

/**
 * Pure logic for swipe-to-vote, kept out of the gesture component so the
 * thresholds and optimistic maths are unit-tested.
 *
 * Apollo/Voyager-style graduated swipe: a short right swipe upvotes, a longer
 * right swipe downvotes, a left swipe saves. Accidental swipes are minimized by
 * (a) an activation distance the gesture must clear before it even captures the
 * touch (so vertical scrolls win), and (b) committing only on release past a
 * meaningful threshold — anything shorter snaps back and does nothing.
 */

export type SwipeAction = "upvote" | "downvote" | "save" | null;

export interface SwipeThresholds {
  /** Min horizontal travel before any action arms. */
  t1: number;
  /** Travel for the second (downvote) tier. */
  t2: number;
  allowDownvote: boolean;
}

export const DEFAULT_THRESHOLDS: Omit<SwipeThresholds, "allowDownvote"> = {
  t1: 72,
  t2: 132,
};

/** Which action a given horizontal offset maps to (null = below threshold). */
export function resolveSwipeAction(
  dx: number,
  { t1, t2, allowDownvote }: SwipeThresholds,
): SwipeAction {
  if (dx >= t2 && allowDownvote) return "downvote";
  if (dx >= t1) return "upvote";
  if (dx <= -t1) return "save";
  return null;
}

/** Toggle semantics: voting the same way again clears the vote. */
export function nextVote(current: Vote, target: Vote): Vote {
  return current === target ? Vote.None : target;
}

export interface VoteState {
  userVote: Vote;
  score: number;
}

/** Apply a vote optimistically, adjusting score by the vote delta. */
export function applyVote(state: VoteState, target: Vote): VoteState {
  const userVote = nextVote(state.userVote, target);
  return { userVote, score: state.score + (userVote - state.userVote) };
}
