import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
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
  initReadLater,
  listReadLater,
  removeReadLater,
  clearReadLater,
  type ReadLaterEntry,
} from "../../app/readLater";
import { getVisit } from "../../app/threadVisits";
import { isOffline } from "../../app/offline";
import { getPackedPost } from "../../app/offlinePack";
import { parseId, type JanusId, type SourceKind } from "../../core/ids";

type Props = NativeStackScreenProps<RootStackParamList, "ReadLater">;

/**
 * The Read Later queue — local, account-free bookmarks that work signed-out
 * and span both networks. Tapping refetches the post through whichever
 * adapter owns it (Reddit or any Lemmy instance); the row badges "+N" when
 * the thread has grown since you last opened it.
 */
export function ReadLaterScreen({ navigation }: Props) {
  const t = useTheme();
  const { adapterForEntity } = useAdapters();
  const [version, setVersion] = useState(0);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const ready = useAsync(() => initReadLater().then(() => true), []);

  const entries = useMemo(() => {
    void ready.data;
    void version;
    return listReadLater();
  }, [ready.data, version]);

  const open = async (entry: ReadLaterEntry) => {
    if (openingId) return;
    // Offline: a plane-mode packed snapshot opens with zero network.
    if (isOffline()) {
      const packed = getPackedPost(entry.id);
      if (packed) {
        navigation.navigate("Post", { post: packed });
        return;
      }
    }
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
      const packed = getPackedPost(entry.id);
      if (packed) {
        navigation.navigate("Post", { post: packed });
      } else {
        Alert.alert(
          "Couldn't open",
          "This post may have been deleted, or its network is unreachable.",
        );
      }
    } finally {
      setOpeningId(null);
    }
  };

  const remove = (id: string) => {
    removeReadLater(id);
    setVersion((v) => v + 1);
  };

  const confirmClear = () => {
    Alert.alert("Clear Read Later", "Remove everything from the queue?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          clearReadLater();
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
          Read Later
        </Text>
        {entries.length > 0 ? (
          <Pressable
            onPress={confirmClear}
            accessibilityRole="button"
            accessibilityLabel="Clear Read Later"
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

      <FlashList
        data={entries}
        keyExtractor={(e) => e.id}
        extraData={openingId}
        renderItem={({ item }) => {
          // Has the thread grown since you last opened it?
          const visit = getVisit(item.id);
          const grown = visit
            ? Math.max(0, item.commentCount - visit.commentCount)
            : 0;
          return (
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
                  · added {relativeTime(item.addedAt)}
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
                {grown > 0 ? (
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
                    +{compactNumber(grown)}
                  </Text>
                ) : null}
                {openingId === item.id ? (
                  <ActivityIndicator
                    size="small"
                    color={t.colors.accent}
                    style={{ marginLeft: 8 }}
                  />
                ) : (
                  <Pressable
                    onPress={() => remove(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.title} from Read Later`}
                    hitSlop={10}
                    style={{ marginLeft: 10 }}
                  >
                    <Ionicons
                      name="close-circle"
                      size={17}
                      color={t.colors.textTertiary}
                    />
                  </Pressable>
                )}
              </View>
              <Text
                style={[t.type.body, { color: t.colors.text, marginTop: 2 }]}
                numberOfLines={2}
              >
                {item.title}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyView
            title="Nothing queued"
            detail="Tap the clock on any post to save it for later — no account needed."
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
  row: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMeta: { flexDirection: "row", alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
});
