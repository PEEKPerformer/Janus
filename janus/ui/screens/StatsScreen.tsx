import React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useTheme } from "../theme";
import { useAsync } from "../hooks";
import { compactNumber, relativeTime } from "../format";
import {
  loadUsageStats,
  resetUsageStats,
  type UsageStats,
} from "../../app/usageStats";

type Props = NativeStackScreenProps<RootStackParamList, "Stats">;

const CARDS: {
  key: keyof UsageStats;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "postsOpened", label: "Posts read", icon: "book-outline" },
  { key: "votesCast", label: "Votes cast", icon: "arrow-up-circle-outline" },
  { key: "commentsPosted", label: "Comments", icon: "chatbubble-outline" },
  { key: "postsCreated", label: "Posts made", icon: "create-outline" },
];

/**
 * Your activity — fully on-device, private tallies of how you use Janus across
 * both networks. A small "year in review" surface, never uploaded anywhere.
 */
export function StatsScreen({ navigation }: Props) {
  const t = useTheme();
  const { data, reload } = useAsync<UsageStats>(() => loadUsageStats(), []);
  const stats = data;

  const reset = () => {
    Alert.alert("Reset stats", "Clear all your activity counters?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          await resetUsageStats();
          reload();
        },
      },
    ]);
  };

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      <SafeAreaView style={styles.fill} edges={["top"]}>
        <View style={[styles.bar, { borderBottomColor: t.colors.border }]}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={26} color={t.colors.text} />
          </Pressable>
          <Text style={[t.type.title, { color: t.colors.text }]}>
            Your activity
          </Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={styles.grid}>
            {CARDS.map((c) => (
              <View
                key={c.key}
                style={[
                  styles.card,
                  {
                    backgroundColor: t.colors.card,
                    borderColor: t.colors.border,
                    borderRadius: t.radius.lg,
                  },
                ]}
              >
                <Ionicons name={c.icon} size={22} color={t.colors.accent} />
                <Text style={[styles.stat, { color: t.colors.text }]}>
                  {compactNumber(stats ? (stats[c.key] as number) : 0)}
                </Text>
                <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                  {c.label}
                </Text>
              </View>
            ))}
          </View>

          <Text
            style={[
              t.type.small,
              {
                color: t.colors.textTertiary,
                textAlign: "center",
                marginTop: 18,
              },
            ]}
          >
            {stats?.since
              ? `Since ${relativeTime(stats.since)} · on this device only`
              : "Counts start as you browse — stored only on this device."}
          </Text>

          <Pressable
            onPress={reset}
            accessibilityRole="button"
            accessibilityLabel="Reset stats"
            style={styles.resetBtn}
          >
            <Text style={[t.type.meta, { color: t.colors.danger }]}>
              Reset counters
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: {
    width: "47%",
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stat: { fontSize: 30, fontWeight: "800", marginTop: 8 },
  resetBtn: { alignSelf: "center", marginTop: 28, padding: 10 },
});
