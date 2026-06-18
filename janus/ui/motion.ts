import type { WithSpringConfig } from "react-native-reanimated";

/**
 * Janus's motion vocabulary — one small, shared set of springs so every
 * interactive surface moves with the same hand. This is the thing that reads as
 * "calibrated" rather than "animated": consistency, plus spring physics instead
 * of duration easing.
 *
 * The personality lives almost entirely in `dampingRatio`. Apollo sat around
 * ~0.8 — a barely-perceptible overshoot that reads as "alive". 1.0 is critically
 * damped and feels stiff/cheap; below ~0.6 reads as a toy. Pick a spring by
 * intent, never hand-roll per component:
 *
 *  - `snappy`  — controls, chips, press states, swipe snap-back. Quick, with the
 *                faintest overshoot. The default for anything the finger drives.
 *  - `gentle`  — sheets, drawers, screen transitions. Smooth, almost no bounce.
 *  - `playful` — a committed, celebratory action (a landed vote/save). A visible
 *                bounce — used sparingly, as a reward.
 *
 * Pass the finger's release velocity into `withSpring(target, { ...SPRING.x,
 * velocity })` so motion continues your throw instead of restarting — that
 * velocity hand-off is most of why a gesture feels physical.
 */
export const SPRING: Record<"snappy" | "gentle" | "playful", WithSpringConfig> =
  {
    snappy: { duration: 320, dampingRatio: 0.82 },
    gentle: { duration: 420, dampingRatio: 0.9 },
    playful: { duration: 480, dampingRatio: 0.62 },
  };

/** Press-down dip for any tappable cell/button; springs back with `snappy`. */
export const PRESS_SCALE = 0.97;

/**
 * iOS rubber-band resistance. Past a limit, motion shouldn't track 1:1 — it
 * should get "heavy", signalling you've gone as far as the surface allows. Feed
 * `overshoot` (px beyond the limit) and the surface `dimension`; returns the
 * damped offset, asymptotically approaching `dimension` no matter how hard you
 * pull. Constant 0.55 matches UIScrollView's feel. Runs on the UI thread.
 */
export function rubberBand(
  overshoot: number,
  dimension: number,
  c = 0.55,
): number {
  "worklet";
  const x = Math.abs(overshoot);
  const damped = (1 - 1 / ((x * c) / dimension + 1)) * dimension;
  return overshoot < 0 ? -damped : damped;
}
