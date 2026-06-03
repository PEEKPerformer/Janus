import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import {
  PanGestureHandler,
  State,
  type PanGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme";
import { Vote } from "../../core/vote";
import {
  resolveSwipeAction,
  DEFAULT_THRESHOLDS,
  type SwipeAction,
} from "../swipeVote";
import { DEFAULT_SWIPE, type SwipeConfig } from "../../app/settingsStore";

// Horizontal travel before the swipe claims the gesture. Because this runs on
// react-native-gesture-handler, once the swipe activates it OWNS the touch — the
// parent list can no longer steal it with a micro vertical scroll (the bug with
// the old PanResponder version). Vertical-first drags never reach activeOffsetX,
// so scrolling stays smooth.
const ACTIVATE_X = 14;
const MAX_TRAVEL = DEFAULT_THRESHOLDS.t2 + 36;

/**
 * Wraps a feed card with Apollo/Voyager-style swipe-to-act. The four slots
 * (right/left × short/long) come from the user's {@link SwipeConfig}; haptics
 * honour the user setting. The action fires only on release past a real
 * threshold; a short drag snaps back and does nothing.
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
  const dragX = useRef(new Animated.Value(0)).current;
  const armedRef = useRef<SwipeAction>("none");
  const [armed, setArmed] = useState<SwipeAction>("none");
  const [dir, setDir] = useState(0);

  const thresholds = useMemo(
    () => ({ ...DEFAULT_THRESHOLDS, allowDownvote, config }),
    [allowDownvote, config],
  );

  // Update the armed action (icon reveal) + fire a haptic as each tier crosses,
  // driven off the live drag value.
  useEffect(() => {
    const tap = () => {
      if (!haptics) return;
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        /* haptics unavailable — non-fatal */
      }
    };
    const id = dragX.addListener(({ value }) => {
      setDir(value === 0 ? 0 : value > 0 ? 1 : -1);
      const next = resolveSwipeAction(value, thresholds);
      if (next !== armedRef.current) {
        armedRef.current = next;
        setArmed(next);
        if (next !== "none") tap();
      }
    });
    return () => dragX.removeListener(id);
  }, [dragX, thresholds, haptics]);

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: dragX } }],
    { useNativeDriver: false },
  );

  const onStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.oldState !== State.ACTIVE) return;
    const action = resolveSwipeAction(e.nativeEvent.translationX, thresholds);
    if (action === "upvote") onUpvote();
    else if (action === "downvote") onDownvote();
    else if (action === "save") onSave();
    armedRef.current = "none";
    setArmed("none");
    setDir(0);
    Animated.spring(dragX, {
      toValue: 0,
      useNativeDriver: false,
      bounciness: 4,
      speed: 18,
    }).start();
  };

  if (!enabled) return <>{children}</>;

  const translateX = dragX.interpolate({
    inputRange: [-MAX_TRAVEL, 0, MAX_TRAVEL],
    outputRange: [-MAX_TRAVEL, 0, MAX_TRAVEL],
    extrapolate: "clamp",
  });

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
      <PanGestureHandler
        activeOffsetX={[-ACTIVATE_X, ACTIVATE_X]}
        hitSlop={edgeBackInset > 0 ? { left: -edgeBackInset } : undefined}
        onGestureEvent={onGestureEvent}
        onHandlerStateChange={onStateChange}
      >
        <Animated.View style={{ transform: [{ translateX }] }}>
          {children}
        </Animated.View>
      </PanGestureHandler>
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
