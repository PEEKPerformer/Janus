import { Vote } from "../core/vote";
import {
  DEFAULT_SWIPE,
  type SwipeConfig,
  type SwipeActionId,
} from "../app/settingsStore";

/**
 * Pure logic for swipe-to-act, kept out of the gesture component so the
 * thresholds, action mapping, and optimistic maths are unit-tested.
 *
 * Apollo/Voyager/Hydra-style graduated swipe: each direction has a short and a
 * long throw, and every one of the four slots is user-remappable via
 * {@link SwipeConfig}. Accidental swipes are minimized by (a) an activation
 * distance the gesture must clear before it even captures the touch (so vertical
 * scrolls win), and (b) committing only on release past a meaningful threshold —
 * anything shorter snaps back and does nothing.
 */

export type SwipeAction = SwipeActionId;

export interface SwipeThresholds {
  /** Min horizontal travel before the short tier arms. */
  t1: number;
  /** Travel for the long tier. */
  t2: number;
  allowDownvote: boolean;
  /** Slot→action mapping; defaults preserve right=vote / left=save. */
  config?: SwipeConfig;
}

export const DEFAULT_THRESHOLDS: Omit<SwipeThresholds, "allowDownvote"> = {
  t1: 72,
  t2: 132,
};

/**
 * Which action a given horizontal offset maps to ("none" = below threshold or
 * unmapped). A downvote on an instance that disables downvotes degrades to an
 * upvote rather than doing nothing, matching the old behaviour.
 */
export function resolveSwipeAction(
  dx: number,
  { t1, t2, allowDownvote, config = DEFAULT_SWIPE }: SwipeThresholds,
): SwipeAction {
  let action: SwipeActionId = "none";
  if (dx >= t2) action = config.rightLong;
  else if (dx >= t1) action = config.rightShort;
  else if (dx <= -t2) action = config.leftLong;
  else if (dx <= -t1) action = config.leftShort;
  if (action === "downvote" && !allowDownvote) action = "upvote";
  return action;
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
