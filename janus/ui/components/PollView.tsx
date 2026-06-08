import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { compactNumber } from "../format";
import type { PollData } from "../../core/model";

/**
 * Read-only poll display (Reddit poll_data). Tallies render as proportional
 * bars when available; while a poll is open and you haven't voted, Reddit hides
 * per-option counts, so we show the options without bars. Casting a vote needs
 * Reddit's OAuth GraphQL endpoint, which the cookie transport can't reach — so
 * this is deliberately display-only, with an honest note.
 */
export function PollView({ poll }: { poll: PollData }) {
  const t = useTheme();
  const counts = poll.options.map((o) => o.voteCount ?? 0);
  const max = Math.max(1, ...counts);
  const haveTallies = poll.options.some((o) => o.voteCount !== undefined);
  const total = poll.totalVotes;

  const status = poll.closed ? "Final results" : "Open poll";

  return (
    <View
      style={[
        styles.wrap,
        { borderColor: t.colors.border, borderRadius: t.radius.md },
      ]}
    >
      {poll.options.map((o) => {
        const picked = o.id === poll.userSelection;
        const pct =
          haveTallies && total > 0
            ? Math.round(((o.voteCount ?? 0) / total) * 100)
            : undefined;
        return (
          <View key={o.id} style={styles.option}>
            {haveTallies ? (
              <View
                style={[
                  styles.bar,
                  {
                    width: `${Math.round(((o.voteCount ?? 0) / max) * 100)}%`,
                    backgroundColor: picked
                      ? t.colors.accent + "33"
                      : t.colors.bgElevated,
                    borderRadius: t.radius.sm,
                  },
                ]}
              />
            ) : null}
            <View style={styles.optionRow}>
              {picked ? (
                <Ionicons
                  name="checkmark-circle"
                  size={15}
                  color={t.colors.accent}
                  style={{ marginRight: 6 }}
                />
              ) : null}
              <Text
                style={[
                  t.type.meta,
                  {
                    color: t.colors.text,
                    fontWeight: picked ? "700" : "500",
                    flex: 1,
                  },
                ]}
                numberOfLines={2}
              >
                {o.text}
              </Text>
              {pct !== undefined ? (
                <Text
                  style={[
                    t.type.meta,
                    { color: t.colors.textSecondary, marginLeft: 8 },
                  ]}
                >
                  {pct}%
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
      <Text
        style={[t.type.small, { color: t.colors.textTertiary, marginTop: 8 }]}
      >
        {compactNumber(total)} vote{total === 1 ? "" : "s"} · {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth },
  option: { marginBottom: 8, justifyContent: "center", minHeight: 34 },
  bar: { ...StyleSheet.absoluteFillObject, right: undefined, height: "100%" },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
});
