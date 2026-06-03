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

const ACTIVATE = 14; // px of horizontal travel before we capture the gesture
const MAX_TRAVEL = DEFAULT_THRESHOLDS.t2 + 36;

function lightTap() {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    /* haptics unavailable — non-fatal */
  }
}

/**
 * Wraps a feed card with Apollo/Voyager-style swipe-to-vote, on core
 * PanResponder (no new native deps).
 *
 * Accidental-swipe minimization is the whole point:
 *  - We only CAPTURE the touch once it has travelled ACTIVATE px AND is clearly
 *    more horizontal than vertical, so taps and vertical scrolling always win.
 *  - The action only fires on RELEASE past a real threshold; a short drag snaps
 *    back and does nothing.
 *  - A light haptic + a colour/icon reveal fire as each threshold arms, so you
 *    feel and see the action before you commit.
 *
 * Right: short = upvote, long = downvote (suppressed where the instance disables
 * downvotes). Left: save. Disabled entirely when the user can't act (guest).
 */
export function SwipeableVoteRow({
  children,
  enabled,
  allowDownvote,
  userVote,
  saved,
  onUpvote,
  onDownvote,
  onSave,
}: {
  children: React.ReactNode;
  enabled: boolean;
  allowDownvote: boolean;
  userVote: Vote;
  saved: boolean;
  onUpvote: () => void;
  onDownvote: () => void;
  onSave: () => void;
}) {
  const t = useTheme();
  const tx = useRef(new Animated.Value(0)).current;
  const armedRef = useRef<SwipeAction>(null);
  const [armed, setArmed] = useState<SwipeAction>(null);

  const thresholds = useMemo(
    () => ({ ...DEFAULT_THRESHOLDS, allowDownvote }),
    [allowDownvote],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > ACTIVATE && Math.abs(g.dx) > Math.abs(g.dy) * 1.25,
        onPanResponderMove: (_e, g) => {
          const clamped = Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, g.dx));
          tx.setValue(clamped);
          const next = resolveSwipeAction(g.dx, thresholds);
          if (next !== armedRef.current) {
            armedRef.current = next;
            setArmed(next);
            if (next) lightTap();
          }
        },
        onPanResponderRelease: (_e, g) => {
          const action = resolveSwipeAction(g.dx, thresholds);
          if (action === "upvote") onUpvote();
          else if (action === "downvote") onDownvote();
          else if (action === "save") onSave();
          armedRef.current = null;
          setArmed(null);
          Animated.spring(tx, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
            speed: 18,
          }).start();
        },
        onPanResponderTerminate: () => {
          armedRef.current = null;
          setArmed(null);
          Animated.spring(tx, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    // thresholds/handlers are stable enough; recreate only if downvote rule flips
    [thresholds, onUpvote, onDownvote, onSave, tx],
  );

  if (!enabled) return <>{children}</>;

  const upColor =
    userVote === Vote.Up ? t.colors.accentActive : t.colors.accent;
  const action = armed;
  const rightIcon =
    action === "downvote"
      ? "arrow-down"
      : action === "upvote"
        ? "arrow-up"
        : "arrow-up";
  const rightColor =
    action === "downvote"
      ? t.colors.danger
      : action === "upvote"
        ? upColor
        : t.colors.textTertiary;

  return (
    <View>
      {/* Action reveal sits behind the card. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.bg}>
          <View style={styles.side}>
            <Ionicons name={rightIcon} size={22} color={rightColor} />
          </View>
          <View style={[styles.side, styles.right]}>
            <Ionicons
              name={saved ? "bookmark" : "bookmark-outline"}
              size={20}
              color={
                action === "save" ? t.colors.accent : t.colors.textTertiary
              }
            />
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
