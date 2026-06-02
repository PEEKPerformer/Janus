import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Vote } from "../../core/vote";
import { useTheme } from "../theme";
import { compactNumber } from "../format";

export function VoteControl({
  score,
  userVote,
  scoreHidden,
  onVote,
  layout = "horizontal",
}: {
  score: number;
  userVote: Vote;
  scoreHidden?: boolean;
  onVote: (next: Vote) => void;
  layout?: "horizontal" | "vertical";
}) {
  const t = useTheme();
  const vertical = layout === "vertical";

  // Optimistic score: reflect the user's current vote relative to a neutral base.
  const display = scoreHidden ? "•" : compactNumber(score);
  const scoreColor =
    userVote === Vote.Up ? t.colors.upvote : userVote === Vote.Down ? t.colors.downvote : t.colors.textSecondary;

  const press = (dir: Vote) => () => onVote(userVote === dir ? Vote.None : dir);

  return (
    <View style={[styles.row, vertical && styles.col]}>
      <Pressable
        hitSlop={10}
        onPress={press(Vote.Up)}
        accessibilityRole="button"
        accessibilityLabel="Upvote"
        accessibilityState={{ selected: userVote === Vote.Up }}
        style={styles.hit}
      >
        <Ionicons name="arrow-up" size={20} color={userVote === Vote.Up ? t.colors.upvote : t.colors.textTertiary} />
      </Pressable>
      <Text style={[t.type.meta, styles.score, { color: scoreColor }]} accessibilityLabel={`Score ${display}`}>
        {display}
      </Text>
      <Pressable
        hitSlop={10}
        onPress={press(Vote.Down)}
        accessibilityRole="button"
        accessibilityLabel="Downvote"
        accessibilityState={{ selected: userVote === Vote.Down }}
        style={styles.hit}
      >
        <Ionicons name="arrow-down" size={20} color={userVote === Vote.Down ? t.colors.downvote : t.colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  col: { flexDirection: "column" },
  // 44pt minimum touch target for the app's primary action.
  hit: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  score: { marginHorizontal: 2, minWidth: 30, textAlign: "center", fontVariant: ["tabular-nums"] },
});
