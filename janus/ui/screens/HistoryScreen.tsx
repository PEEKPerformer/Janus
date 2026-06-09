import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useAsync } from "../hooks";
import { useTheme } from "../theme";
import { relativeTime, compactNumber } from "../format";
import { EmptyView } from "../components/StateViews";
import {
  initThreadVisits,
  listHistory,
  clearHistory,
  type ThreadVisit,
} from "../../app/threadVisits";
import { parseId, type JanusId } from "../../core/ids";
import type { SourceKind } from "../../core/ids";

type Props = NativeStackScreenProps<RootStackParamList, "History">;

/**
 * Browsing history — "what was that post from last night?", answered. Every
 * thread you've opened, most recent first, searchable by title/community.
 * Cross-network by construction: entries are keyed by JanusId, and tapping one
 * routes to whichever adapter (Reddit or any Lemmy instance) owns the post.
 */
export function HistoryScreen({ navigation }: Props) {
  const t = useTheme();
  const { adapterForEntity } = useAdapters();
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const ready = useAsync(
    () => initThreadVisits().then(() => true),
    [],
  );

  const entries = useMemo(() => {
    void ready.data;
    void version;
    const all = listHistory();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.community.toLowerCase().includes(q),
    );
  }, [ready.data, query, version]);

  const open = async (entry: ThreadVisit) => {
    if (openingId) return;
    setOpeningId(entry.id);
    try {
      const id = entry.id as JanusId;
      const parts = parseId(id);
      const adapter = adapterForEntity({
        source: parts.source as SourceKind,
        instance: parts.instance,
      });
      const post = await adapter.getPost(id);
      navigation.navigate("Post", { post });
    } catch {
      Alert.alert(
        "Couldn't open",
        "This post may have been deleted, or its network is unreachable.",
      );
    } finally {
      setOpeningId(null);
    }
  };

  const confirmClear = () => {
    Alert.alert("Clear history", "Remove all browsing history?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          clearHistory();
          setVersion((v) => v + 1);
        },
      },
    ]);
  };

  const sourceColor = (source: string) =>
    source === "reddit" ? t.colors.reddit : t.colors.lemmy;

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
          History
        </Text>
        {entries.length > 0 || query ? (
          <Pressable
            onPress={confirmClear}
            accessibilityRole="button"
            accessibilityLabel="Clear history"
            hitSlop={8}
          >
            <Ionicons
              name="trash-outline"
              size={19}
              color={t.colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      <View
        style={[
          styles.searchRow,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            marginHorizontal: t.spacing.lg,
          },
        ]}
      >
        <Ionicons name="search" size={15} color={t.colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search history…"
          placeholderTextColor={t.colors.textTertiary}
          autoCorrect={false}
          accessibilityLabel="Search history"
          style={[t.type.meta, styles.searchInput, { color: t.colors.text }]}
        />
        {query ? (
          <Pressable
            onPress={() => setQuery("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons
              name="close-circle"
              size={16}
              color={t.colors.textTertiary}
            />
          </Pressable>
        ) : null}
      </View>

      <FlashList
        data={entries}
        keyExtractor={(e) => e.id}
        extraData={openingId}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title}`}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? t.colors.cardPressed : t.colors.bg,
                borderBottomColor: t.colors.border,
                paddingHorizontal: t.spacing.lg,
              },
            ]}
          >
            <View style={styles.rowMeta}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: sourceColor(item.source) },
                ]}
              />
              <Text
                style={[t.type.small, { color: t.colors.textSecondary }]}
                numberOfLines={1}
              >
                {item.community}
              </Text>
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.textTertiary, marginLeft: 6 },
                ]}
              >
                · {relativeTime(item.visitedAt)}
              </Text>
              <View style={{ flex: 1 }} />
              <Ionicons
                name="chatbubble-outline"
                size={12}
                color={t.colors.textTertiary}
              />
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.textTertiary, marginLeft: 4 },
                ]}
              >
                {compactNumber(item.commentCount)}
              </Text>
              {openingId === item.id ? (
                <ActivityIndicator
                  size="small"
                  color={t.colors.accent}
                  style={{ marginLeft: 8 }}
                />
              ) : null}
            </View>
            <Text
              style={[t.type.body, { color: t.colors.text, marginTop: 2 }]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyView
            title={query ? "No matches" : "No history yet"}
            detail={
              query
                ? "Try a different search."
                : "Threads you open will show up here."
            }
            icon="time-outline"
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  searchInput: { flex: 1, marginLeft: 8, paddingVertical: 0 },
  row: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMeta: { flexDirection: "row", alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
});
