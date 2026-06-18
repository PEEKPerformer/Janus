import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { Vote } from "../../core/vote";
import {
  resolveSwipeAction,
  DEFAULT_THRESHOLDS,
  type SwipeAction,
} from "../swipeVote";
import { DEFAULT_SWIPE, type SwipeConfig } from "../../app/settingsStore";
import { SPRING, rubberBand } from "../motion";
import { playHaptic } from "../haptics";

// Horizontal travel before the swipe claims the gesture. Because this runs on
// react-native-gesture-handler, once the swipe activates it OWNS the touch — the
// parent list can no longer steal it with a micro vertical scroll. Vertical-first
// drags never reach activeOffsetX, so scrolling stays smooth.
const ACTIVATE_X = 14;
const { t1, t2 } = DEFAULT_THRESHOLDS;
const MAX_TRAVEL = t2 + 36;
// Extra give past MAX_TRAVEL, heavily damped — the row gets "heavy" rather than
// sliding free, signalling you've armed the strongest action.
const RUBBER_GIVE = 80;

/**
 * Wraps a feed card with Apollo/Voyager-style swipe-to-act, built on the shared
 * motion vocabulary ({@link SPRING}, {@link rubberBand}) and escalating
 * {@link playHaptic} haptics. The four slots (right/left × short/long) come from
 * the user's {@link SwipeConfig}.
 *
 * The feel comes from three things working together, all on the UI thread:
 *  - the finger tracks 1:1, then rubber-bands past the last threshold;
 *  - the haptic fires the instant a tier *arms* (not on release) and escalates
 *    — a selection tick for a short throw, a medium impact for a long one;
 *  - on release the snap-back spring inherits the finger's velocity, so motion
 *    continues your throw instead of restarting.
 * The action commits only on release past a real threshold; a short drag snaps
 * back and does nothing.
 */
export function SwipeableVoteRow({
  children,
  enabled,
  allowDownvote,
  userVote,
  saved,
  config = DEFAULT_SWIPE,
  haptics = true,
  edgeBackInset = 0,
  onUpvote,
  onDownvote,
  onSave,
}: {
  children: React.ReactNode;
  enabled: boolean;
  allowDownvote: boolean;
  userVote: Vote;
  saved: boolean;
  config?: SwipeConfig;
  haptics?: boolean;
  /**
   * Px of the left screen edge to leave for the OS back-swipe (so swiping back
   * out of a pushed screen isn't captured as a vote). 0 = capture full width
   * (the feed, which has no back gesture).
   */
  edgeBackInset?: number;
  onUpvote: () => void;
  onDownvote: () => void;
  onSave: () => void;
}) {
  const t = useTheme();
  // Motion lives on the UI thread; armedTier (a sentinel −2..2) is shared so the
  // pan worklet can debounce tier crossings without a JS round-trip per frame.
  const translateX = useSharedValue(0);
  const armedTier = useSharedValue(0);
  const [armed, setArmed] = useState<SwipeAction>("none");
  const [dir, setDir] = useState(0);

  const thresholds = useMemo(
    () => ({ ...DEFAULT_THRESHOLDS, allowDownvote, config }),
    [allowDownvote, config],
  );

  // tier sentinel → the action that tier would commit, honouring the user's slot
  // mapping and the instance's downvote permission.
  const tierToAction = (tier: number): SwipeAction => {
    let a: SwipeAction = "none";
    if (tier === 2) a = config.rightLong;
    else if (tier === 1) a = config.rightShort;
    else if (tier === -2) a = config.leftLong;
    else if (tier === -1) a = config.leftShort;
    if (a === "downvote" && !allowDownvote) a = "upvote";
    return a;
  };

  // Runs on the JS thread when a new tier arms (or disarms): reveal the icon and
  // fire the escalating haptic at the moment of the crossing.
  const onTierChange = (tier: number) => {
    setDir(tier > 0 ? 1 : tier < 0 ? -1 : 0);
    setArmed(tierToAction(tier));
    if (tier !== 0)
      playHaptic(Math.abs(tier) === 2 ? "medium" : "selection", haptics);
  };
  const resetReveal = () => {
    setArmed("none");
    setDir(0);
  };
  const commit = (dx: number) => {
    const action = resolveSwipeAction(dx, thresholds);
    if (action === "upvote") onUpvote();
    else if (action === "downvote") onDownvote();
    else if (action === "save") onSave();
  };

  let pan = Gesture.Pan()
    .activeOffsetX([-ACTIVATE_X, ACTIVATE_X])
    .onUpdate((e) => {
      const x = e.translationX;
      // 1:1 to the last threshold, then rubber-band the excess.
      if (Math.abs(x) <= MAX_TRAVEL) translateX.value = x;
      else {
        const sign = x < 0 ? -1 : 1;
        translateX.value =
          sign * MAX_TRAVEL + rubberBand(x - sign * MAX_TRAVEL, RUBBER_GIVE);
      }
      // Debounced tier crossing — only hop to JS when the armed tier changes,
      // so haptics fire once per crossing, never per frame.
      let tier = 0;
      if (x >= t2) tier = 2;
      else if (x >= t1) tier = 1;
      else if (x <= -t2) tier = -2;
      else if (x <= -t1) tier = -1;
      if (tier !== armedTier.value) {
        armedTier.value = tier;
        runOnJS(onTierChange)(tier);
      }
    })
    .onEnd((e) => {
      runOnJS(commit)(e.translationX);
      // Reset the tier here (not via a reaction) so the snap-back spring crossing
      // thresholds on its way home doesn't re-fire haptics.
      armedTier.value = 0;
      runOnJS(resetReveal)();
      translateX.value = withSpring(0, {
        ...SPRING.snappy,
        velocity: e.velocityX,
      });
    });
  // Leave the OS back-swipe zone untouched on pushed screens.
  if (edgeBackInset > 0) pan = pan.hitSlop({ left: -edgeBackInset });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  if (!enabled) return <>{children}</>;

  const upColor =
    userVote === Vote.Up ? t.colors.accentActive : t.colors.accent;
  const iconFor = (a: SwipeAction): keyof typeof Ionicons.glyphMap => {
    if (a === "downvote") return "arrow-down";
    if (a === "save") return saved ? "bookmark" : "bookmark-outline";
    return "arrow-up";
  };
  const colorFor = (a: SwipeAction): string =>
    a === "downvote"
      ? t.colors.danger
      : a === "save"
        ? t.colors.accent
        : a === "upvote"
          ? upColor
          : t.colors.textTertiary;
  const showLeft = dir > 0;
  const showRight = dir < 0;

  return (
    <View>
      {/* Action reveal sits behind the card. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.bg}>
          <View style={styles.side}>
            {showLeft && armed !== "none" ? (
              <Ionicons
                name={iconFor(armed)}
                size={22}
                color={colorFor(armed)}
              />
            ) : null}
          </View>
          <View style={[styles.side, styles.right]}>
            {showRight && armed !== "none" ? (
              <Ionicons
                name={iconFor(armed)}
                size={22}
                color={colorFor(armed)}
              />
            ) : null}
          </View>
        </View>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={cardStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  side: { paddingHorizontal: 28, justifyContent: "center" },
  right: { alignItems: "flex-end" },
});
