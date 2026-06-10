import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useTheme } from "../theme";
import { relativeTime, compactNumber } from "../format";
import { EmptyView } from "../components/StateViews";
import { initThreadSeries } from "../../app/threadSeries";
import { initSavedSearches } from "../../app/savedSearches";
import { initThreadVisits } from "../../app/threadVisits";
import {
  buildBriefing,
  briefingNewsCount,
  type SeriesBriefing,
} from "../briefing";

type Props = NativeStackScreenProps<RootStackParamList, "Briefing">;

/** Don't re-check on every focus — megathreads move fast but not THAT fast. */
const REFRESH_MIN_MS = 3 * 60_000;

/**
 * The Briefing — mission control for megathread-heavy communities. One card
 * per followed series: today's edition, what changed since YOU last looked
 * (new edition / +N comments / unseen watch matches), and the top-scored
 * comments you haven't seen. Open the thread and the existing new-comment
 * highlighting takes over; come back and the card says "caught up".
 */
export function BriefingScreen({ navigation }: Props) {
  const t = useTheme();
  const { adapters, adapterForEntity } = useAdapters();

  const [items, setItems] = useState<SeriesBriefing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const lastRun = useRef(0);
  const runningRef = useRef(false);

  const refresh = useCallback(
    async (force: boolean) => {
      if (runningRef.current) return;
      if (!force && Date.now() - lastRun.current < REFRESH_MIN_MS) return;
      runningRef.current = true;
      setLoading(true);
      try {
        await Promise.all([
          initThreadSeries(),
          initSavedSearches(),
          initThreadVisits(),
        ]);
        const result = await buildBriefing({
          reddit: adapters.reddit,
          lemmy: adapters.lemmy,
          adapterForEntity,
        });
        setItems(result);
        lastRun.current = Date.now();
      } finally {
        runningRef.current = false;
        setLoading(false);
      }
    },
    [adapters, adapterForEntity],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh(false);
    }, [refresh]),
  );

  const newsCount = items ? briefingNewsCount(items) : 0;
  const sourceColor = (source: string) =>
    source === "reddit" ? t.colors.reddit : t.colors.lemmy;

  const card = (b: SeriesBriefing) => {
    const hasNews =
      b.newEdition || b.newComments > 0 || b.watches.some((w) => w.unseen > 0);
    const status = !b.edition
      ? "Couldn't find today's edition"
      : b.newEdition
        ? `New edition · ${compactNumber(b.edition.commentCount)} comments`
        : b.newComments > 0
          ? `+${compactNumber(b.newComments)} since your visit`
          : "You're caught up";
    return (
      <Pressable
        key={b.series.id}
        onPress={() =>
          b.edition && navigation.navigate("Post", { post: b.edition })
        }
        disabled={!b.edition}
        accessibilityRole="button"
        accessibilityLabel={`${b.series.label} in ${b.series.communityHandle}. ${status}.`}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: pressed
              ? t.colors.cardPressed
              : t.colors.bgElevated,
            borderColor: hasNews ? t.colors.accent : t.colors.border,
          },
        ]}
      >
        <View style={styles.cardHead}>
          <View
            style={[
              styles.dot,
              { backgroundColor: sourceColor(b.series.source) },
            ]}
          />
          <Text
            style={[t.type.small, { color: t.colors.textSecondary }]}
            numberOfLines={1}
          >
            {b.series.communityHandle}
          </Text>
          {b.edition ? (
            <Text
              style={[
                t.type.small,
                { color: t.colors.textTertiary, marginLeft: 6 },
              ]}
            >
              · {relativeTime(b.edition.createdAt)}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {hasNews ? (
            <View
              style={[styles.newPip, { backgroundColor: t.colors.accent }]}
            />
          ) : (
            <Ionicons
              name="checkmark-circle"
              size={15}
              color={t.colors.textTertiary}
            />
          )}
        </View>

        <Text
          style={[t.type.body, { color: t.colors.text, fontWeight: "700" }]}
          numberOfLines={1}
        >
          {b.series.label}
        </Text>
        <Text
          style={[
            t.type.small,
            {
              color: hasNews ? t.colors.accent : t.colors.textTertiary,
              marginTop: 2,
              fontWeight: hasNews ? "700" : "400",
            },
          ]}
        >
          {status}
        </Text>

        {b.watches.length > 0 ? (
          <View style={styles.watchRow}>
            {b.watches.map((w) => (
              <Pressable
                key={w.watch.id}
                onPress={() =>
                  navigation.navigate("WatchResults", { id: w.watch.id })
                }
                accessibilityRole="button"
                accessibilityLabel={`Watch "${w.watch.query}", ${w.unseen} new`}
                style={[
                  styles.watchChip,
                  {
                    backgroundColor: t.colors.bg,
                    borderColor:
                      w.unseen > 0 ? t.colors.accent : t.colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="notifications-outline"
                  size={11}
                  color={w.unseen > 0 ? t.colors.accent : t.colors.textTertiary}
                />
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.textSecondary, marginLeft: 4 },
                  ]}
                  numberOfLines={1}
                >
                  {w.watch.query}
                </Text>
                {w.unseen > 0 ? (
                  <Text
                    style={[
                      t.type.small,
                      {
                        color: t.colors.accent,
                        fontWeight: "700",
                        marginLeft: 4,
                      },
                    ]}
                  >
                    {w.unseen}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {b.topNew.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <Text
              style={[
                t.type.small,
                { color: t.colors.textTertiary, marginBottom: 2 },
              ]}
            >
              TOP NEW
            </Text>
            {b.topNew.map((c) => (
              <Pressable
                key={c.id}
                onPress={() =>
                  b.edition &&
                  navigation.navigate("Post", {
                    post: b.edition,
                    focusCommentId: c.id,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Top new comment by ${c.author.handle}`}
                style={styles.topNewRow}
              >
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.accent, fontWeight: "700" },
                  ]}
                >
                  ▲{compactNumber(c.score)}
                </Text>
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.textSecondary, flex: 1, marginLeft: 6 },
                  ]}
                  numberOfLines={2}
                >
                  {c.body.text ?? ""}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      style={[styles.fill, { backgroundColor: t.colors.bg }]}
      edges={["top"]}
    >
      <View style={[styles.topBar, { paddingHorizontal: t.spacing.lg }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color={t.colors.accent} />
        </Pressable>
        <Text
          style={[
            t.type.title,
            { color: t.colors.text, flex: 1, marginLeft: 8 },
          ]}
        >
          Briefing
        </Text>
        {loading ? (
          <ActivityIndicator size="small" color={t.colors.accent} />
        ) : items ? (
          <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
            {newsCount > 0 ? `${newsCount} to catch up` : "All caught up"}
          </Text>
        ) : null}
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={loading && items !== null}
            onRefresh={() => void refresh(true)}
            tintColor={t.colors.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {items === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.colors.accent} />
            <Text
              style={[
                t.type.small,
                { color: t.colors.textTertiary, marginTop: 10 },
              ]}
            >
              Checking your megathreads…
            </Text>
          </View>
        ) : items.length === 0 ? (
          <EmptyView
            title="No series followed yet"
            detail="Follow a recurring megathread (the pin icon on a daily thread) and the Briefing will track every edition for you — new comments, your keyword watches, and the top datapoints since your last look."
            icon="newspaper-outline"
          />
        ) : (
          items.map(card)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  center: { alignItems: "center", paddingTop: 80 },
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  newPip: { width: 9, height: 9, borderRadius: 5 },
  watchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    gap: 6,
  },
  watchChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 11,
    borderWidth: 1,
    maxWidth: 200,
  },
  topNewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 3,
  },
});
