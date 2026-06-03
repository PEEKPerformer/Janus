import React, { useMemo, useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet, View } from "react-native";
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

const ACTIVATE = 14; // px of horizontal travel before we capture the gesture
const MAX_TRAVEL = DEFAULT_THRESHOLDS.t2 + 36;

/**
 * Wraps a feed card with Apollo/Voyager-style swipe-to-act, on core
 * PanResponder (no new native deps). The four slots (right/left × short/long)
 * are driven by the user's {@link SwipeConfig}; haptics honour the user setting.
 *
 * Accidental-swipe minimization is the whole point:
 *  - We only CAPTURE the touch once it has travelled ACTIVATE px AND is clearly
 *    more horizontal than vertical, so taps and vertical scrolling always win.
 *  - The action only fires on RELEASE past a real threshold; a short drag snaps
 *    back and does nothing.
 *  - A light haptic + a colour/icon reveal fire as each threshold arms, so you
 *    feel and see the action before you commit.
 */
export function SwipeableVoteRow({
  children,
  enabled,
  allowDownvote,
  userVote,
  saved,
  config = DEFAULT_SWIPE,
  haptics = true,
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
  onUpvote: () => void;
  onDownvote: () => void;
  onSave: () => void;
}) {
  const t = useTheme();
  const tx = useRef(new Animated.Value(0)).current;
  const armedRef = useRef<SwipeAction>("none");
  const [armed, setArmed] = useState<SwipeAction>("none");
  const [dir, setDir] = useState(0);

  function lightTap() {
    if (!haptics) return;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      /* haptics unavailable — non-fatal */
    }
  }

  const thresholds = useMemo(
    () => ({ ...DEFAULT_THRESHOLDS, allowDownvote, config }),
    [allowDownvote, config],
  );

  const fire = (action: SwipeAction) => {
    if (action === "upvote") onUpvote();
    else if (action === "downvote") onDownvote();
    else if (action === "save") onSave();
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > ACTIVATE && Math.abs(g.dx) > Math.abs(g.dy) * 1.25,
        onPanResponderMove: (_e, g) => {
          const clamped = Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, g.dx));
          tx.setValue(clamped);
          setDir(Math.sign(g.dx));
          const next = resolveSwipeAction(g.dx, thresholds);
          if (next !== armedRef.current) {
            armedRef.current = next;
            setArmed(next);
            if (next !== "none") lightTap();
          }
        },
        onPanResponderRelease: (_e, g) => {
          fire(resolveSwipeAction(g.dx, thresholds));
          armedRef.current = "none";
          setArmed("none");
          setDir(0);
          Animated.spring(tx, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
            speed: 18,
          }).start();
        },
        onPanResponderTerminate: () => {
          armedRef.current = "none";
          setArmed("none");
          setDir(0);
          Animated.spring(tx, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    // thresholds/handlers are stable enough; recreate only if config flips
    [thresholds, onUpvote, onDownvote, onSave, tx],
  );

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
  // The revealed edge depends on swipe direction: dragging right exposes the
  // left edge (right-slot action) and vice-versa.
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
      <Animated.View
        {...responder.panHandlers}
        style={{ transform: [{ translateX: tx }] }}
      >
        {children}
      </Animated.View>
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
