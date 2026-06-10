import React, { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useSettings } from "../SettingsContext";
import { useAsync, useOffline } from "../hooks";
import { useTheme } from "../theme";
import { relativeTime, compactNumber } from "../format";
import { EmptyView } from "../components/StateViews";
import { Wormhole } from "../components/Wormhole";
import { initReadLater, listReadLater } from "../../app/readLater";
import { initThreadSeries, listAllSeries } from "../../app/threadSeries";
import { resolveCommentSort } from "../../app/commentSortResolve";
import {
  runPack,
  estimatePackTotal,
  type PackProgress,
  type PackScope,
  type PackSummary,
} from "../../app/packer";
import {
  getPackManifest,
  getPackedPost,
  clearPack,
  type PackedItem,
} from "../../app/offlinePack";
import {
  listOutbox,
  removeOutboxEntry,
  drainOutbox,
  type OutboxEntry,
} from "../../app/outbox";

type Props = NativeStackScreenProps<RootStackParamList, "PlaneMode">;

const FEED_LIMIT = 50;
/** Rough wall-clock per packed thread (comments call + media), for the estimate. */
const EST_MS_PER_ITEM = 1500;

/**
 * Plane Mode — pack your reading before a flight, then read (and interact)
 * fully offline. Packing bulk-warms the same caches the app already reads:
 * comments into the shared SWR cache, images into expo-image's disk cache.
 * The packed list below doubles as the offline browsing surface, and the
 * outbox shows what will send when you're back online. Cross-network like
 * everything else: Reddit threads and Lemmy threads pack identically.
 */
export function PlaneModeScreen({ navigation }: Props) {
  const t = useTheme();
  const { adapters, adapterForEntity } = useAdapters();
  const { settings } = useSettings();
  const offline = useOffline();

  const [scope, setScope] = useState<PackScope>({
    readLater: true,
    series: true,
    feedSnapshot: true,
  });
  const [packing, setPacking] = useState(false);
  const [progress, setProgress] = useState<PackProgress | null>(null);
  const [summary, setSummary] = useState<PackSummary | null>(null);
  const [version, setVersion] = useState(0);
  const stopRef = useRef(false);

  const ready = useAsync(
    () => Promise.all([initReadLater(), initThreadSeries()]).then(() => true),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      setVersion((v) => v + 1);
    }, []),
  );

  const manifest = useMemo(() => {
    void version;
    void packing;
    return getPackManifest();
  }, [version, packing]);
  const outbox = useMemo(() => {
    void version;
    void offline;
    return listOutbox();
  }, [version, offline]);

  const readLaterCount = ready.data ? listReadLater().length : 0;
  const seriesCount = ready.data ? listAllSeries().length : 0;
  const estimate = ready.data ? estimatePackTotal(scope, FEED_LIMIT) : 0;
  const estimateMin = Math.max(
    1,
    Math.ceil((estimate * EST_MS_PER_ITEM) / 60_000),
  );

  const startPack = async () => {
    if (packing || offline) return;
    stopRef.current = false;
    setSummary(null);
    setPacking(true);
    try {
      await activateKeepAwakeAsync("janus-pack");
    } catch {
      /* keep-awake is best-effort */
    }
    try {
      const result = await runPack(scope, {
        reddit: adapters.reddit,
        lemmy: adapters.lemmy,
        adapterForEntity,
        resolveSort: (adapter, communityId) =>
          resolveCommentSort({
            sorts: adapter.capabilities.sorts.comment,
            preferred: settings.defaultCommentSort,
            communityId,
            rememberCommunitySort: settings.rememberCommunitySort,
          }),
        prefetchImage: (url) => Image.prefetch(url),
        feedLimit: FEED_LIMIT,
        onProgress: setProgress,
        shouldStop: () => stopRef.current,
      });
      setSummary(result);
    } finally {
      try {
        void deactivateKeepAwake("janus-pack");
      } catch {
        /* best-effort */
      }
      setPacking(false);
      setProgress(null);
      setVersion((v) => v + 1);
    }
  };

  const openPacked = (item: PackedItem) => {
    const post = getPackedPost(item.id);
    if (post) navigation.navigate("Post", { post });
    else
      Alert.alert(
        "Not packed",
        "This thread didn't finish packing — re-pack when you're online.",
      );
  };

  const confirmClear = () => {
    Alert.alert("Clear pack", "Remove all packed threads?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          clearPack();
          setVersion((v) => v + 1);
        },
      },
    ]);
  };

  const sendOutboxNow = async () => {
    const result = await drainOutbox(adapterForEntity);
    setVersion((v) => v + 1);
    if (result.failed > 0)
      Alert.alert(
        "Some didn't send",
        `${result.sent} sent, ${result.failed} failed — they'll retry next time.`,
      );
  };

  const sourceColor = (source: string) =>
    source === "reddit" ? t.colors.reddit : t.colors.lemmy;

  const items = manifest?.items ?? [];
  const pct =
    progress && progress.phase === "pack" && progress.total > 0
      ? progress.done / progress.total
      : 0;

  const scopeRow = (label: string, detail: string, key: keyof PackScope) => (
    <View style={[styles.scopeRow, { borderBottomColor: t.colors.border }]}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={[t.type.body, { color: t.colors.text }]}>{label}</Text>
        <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
          {detail}
        </Text>
      </View>
      <Switch
        value={scope[key]}
        onValueChange={(v) => setScope((s) => ({ ...s, [key]: v }))}
        trackColor={{ true: t.colors.accent }}
        disabled={packing}
        accessibilityLabel={label}
      />
    </View>
  );

  const outboxLabel = (entry: OutboxEntry): string => {
    if (entry.action.kind === "vote") {
      const v = entry.action.vote;
      return v > 0 ? "Upvote" : v < 0 ? "Downvote" : "Remove vote";
    }
    return `Reply on “${entry.action.postTitle}”`;
  };

  const header = (
    <View>
      {packing ? (
        <View style={styles.packingWrap}>
          <Wormhole />
          <Text
            style={[
              t.type.title,
              { color: t.colors.text, marginTop: 18, textAlign: "center" },
            ]}
          >
            Packing for your flight
          </Text>
          <Text
            style={[
              t.type.small,
              {
                color: t.colors.textSecondary,
                marginTop: 6,
                textAlign: "center",
              },
            ]}
          >
            Leave Janus open — about {estimateMin} min. Threads, comments and
            images are coming aboard.
          </Text>
          <View
            style={[styles.progressTrack, { backgroundColor: t.colors.border }]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: t.colors.accent,
                  width: `${Math.round(pct * 100)}%`,
                },
              ]}
            />
          </View>
          <Text
            style={[t.type.small, { color: t.colors.textTertiary }]}
            numberOfLines={1}
          >
            {progress
              ? progress.phase === "gather"
                ? `Gathering… ${progress.title}`
                : `${progress.done} / ${progress.total} · ${progress.title}`
              : "Starting…"}
          </Text>
          <Pressable
            onPress={() => {
              stopRef.current = true;
            }}
            accessibilityRole="button"
            accessibilityLabel="Stop packing"
            style={[styles.cancelBtn, { borderColor: t.colors.border }]}
          >
            <Text style={[t.type.body, { color: t.colors.textSecondary }]}>
              Stop
            </Text>
          </Pressable>
        </View>
      ) : (
        <View>
          {offline ? (
            <View
              style={[
                styles.offlineBanner,
                { backgroundColor: t.colors.bgElevated },
              ]}
            >
              <Ionicons name="airplane" size={15} color={t.colors.accent} />
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.textSecondary, marginLeft: 8, flex: 1 },
                ]}
              >
                You're offline — your pack is below.
                {outbox.length > 0
                  ? ` ${outbox.length} queued ${
                      outbox.length === 1 ? "action" : "actions"
                    } will send when you're back.`
                  : ""}
              </Text>
            </View>
          ) : null}

          {scopeRow(
            `Read Later (${readLaterCount})`,
            "Your queue — the flight reading list",
            "readLater",
          )}
          {scopeRow(
            `Followed series (${seriesCount})`,
            "Newest edition of each megathread",
            "series",
          )}
          {scopeRow(
            "Feed snapshot",
            `Top ${FEED_LIMIT} from each network's home feed`,
            "feedSnapshot",
          )}

          <Pressable
            onPress={() => void startPack()}
            disabled={offline || estimate === 0}
            accessibilityRole="button"
            accessibilityLabel="Pack for flight"
            style={({ pressed }) => [
              styles.packBtn,
              {
                backgroundColor:
                  offline || estimate === 0
                    ? t.colors.bgElevated
                    : pressed
                      ? t.colors.cardPressed
                      : t.colors.accent,
              },
            ]}
          >
            <Ionicons
              name="airplane"
              size={16}
              color={
                offline || estimate === 0 ? t.colors.textTertiary : t.colors.bg
              }
            />
            <Text
              style={[
                t.type.body,
                {
                  color:
                    offline || estimate === 0
                      ? t.colors.textTertiary
                      : t.colors.bg,
                  fontWeight: "700",
                  marginLeft: 8,
                },
              ]}
            >
              Pack for flight · ~{estimate} items · ~{estimateMin} min
            </Text>
          </Pressable>

          {summary ? (
            <Text
              style={[
                t.type.small,
                {
                  color: t.colors.textSecondary,
                  textAlign: "center",
                  marginBottom: 10,
                },
              ]}
            >
              {summary.cancelled ? "Stopped early — " : ""}
              {summary.packed} packed
              {summary.partial > 0 ? `, ${summary.partial} partial` : ""}
              {summary.failed > 0 ? `, ${summary.failed} unreachable` : ""}.
            </Text>
          ) : null}

          {outbox.length > 0 ? (
            <View style={{ marginBottom: 6 }}>
              <View style={styles.sectionHead}>
                <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                  OUTBOX — SENDS WHEN YOU'RE ONLINE
                </Text>
                {!offline ? (
                  <Pressable
                    onPress={() => void sendOutboxNow()}
                    accessibilityRole="button"
                    accessibilityLabel="Send outbox now"
                    hitSlop={8}
                  >
                    <Text
                      style={[
                        t.type.small,
                        { color: t.colors.accent, fontWeight: "700" },
                      ]}
                    >
                      Send now
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {outbox.map((entry) => (
                <View
                  key={entry.id}
                  style={[
                    styles.outboxRow,
                    { borderBottomColor: t.colors.border },
                  ]}
                >
                  <Ionicons
                    name={
                      entry.action.kind === "vote"
                        ? "arrow-up-circle-outline"
                        : "chatbubble-ellipses-outline"
                    }
                    size={16}
                    color={
                      entry.status === "failed"
                        ? t.colors.reddit
                        : t.colors.textSecondary
                    }
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text
                      style={[t.type.body, { color: t.colors.text }]}
                      numberOfLines={1}
                    >
                      {outboxLabel(entry)}
                    </Text>
                    {entry.status === "failed" ? (
                      <Text
                        style={[t.type.small, { color: t.colors.reddit }]}
                        numberOfLines={1}
                      >
                        Failed — will retry. {entry.error ?? ""}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => {
                      removeOutboxEntry(entry.id);
                      setVersion((v) => v + 1);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Discard queued action"
                    hitSlop={10}
                  >
                    <Ionicons
                      name="close-circle"
                      size={17}
                      color={t.colors.textTertiary}
                    />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {manifest ? (
            <View style={styles.sectionHead}>
              <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                PACKED {relativeTime(manifest.packedAt).toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );

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
          Plane Mode
        </Text>
        {items.length > 0 && !packing ? (
          <Pressable
            onPress={confirmClear}
            accessibilityRole="button"
            accessibilityLabel="Clear pack"
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
        data={packing ? [] : items}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openPacked(item)}
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
              {item.status !== "packed" ? (
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.textTertiary, marginLeft: 6 },
                  ]}
                >
                  {item.status === "partial" ? "partial" : "failed"}
                </Text>
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
          packing ? null : (
            <EmptyView
              title="No pack yet"
              detail="Choose what to bring and pack before you board — threads, comments and images, readable with zero signal."
              icon="airplane-outline"
            />
          )
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
  packingWrap: {
    alignItems: "center",
    paddingHorizontal: 32,
    paddingTop: 28,
    paddingBottom: 16,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    alignSelf: "stretch",
    marginTop: 18,
    marginBottom: 8,
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2 },
  cancelBtn: {
    marginTop: 16,
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  scopeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  packBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  outboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMeta: { flexDirection: "row", alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
});
