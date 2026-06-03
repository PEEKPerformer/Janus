import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useFeed } from "../hooks";
import { useTheme } from "../theme";
import { Markdown } from "../components/Markdown";
import { ErrorView, EmptyView, SkeletonFeed } from "../components/StateViews";
import { relativeTime } from "../format";
import type { Notification } from "../../core/model";
import type { JanusId, SourceKind } from "../../core/ids";

type Props = NativeStackScreenProps<RootStackParamList, "Inbox">;
type Filter = "all" | "replies" | "mentions" | "messages";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "replies", label: "Replies" },
  { id: "mentions", label: "Mentions" },
  { id: "messages", label: "Messages" },
];

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  commentReply: "chatbubble-ellipses-outline",
  postReply: "chatbubble-ellipses-outline",
  mention: "at-outline",
  privateMessage: "mail-outline",
  modAction: "shield-outline",
  subscribed: "notifications-outline",
};

export function InboxScreen({ navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { adapters, activeSource } = useAdapters();

  // Inbox is account-specific: use the active source if signed in, else whichever is.
  const src: SourceKind = !adapters[activeSource].account.isGuest
    ? activeSource
    : adapters.reddit.account.isGuest
      ? "lemmy"
      : "reddit";
  const adapter = adapters[src];

  const [filter, setFilter] = useState<Filter>("all");
  const [readIds, setReadIds] = useState<Set<JanusId>>(new Set());
  const inbox = useFeed<Notification>(
    (page) => adapter.getInbox(filter, page),
    [src, filter],
  );

  const markRead = async (n: Notification) => {
    if (readIds.has(n.id) || n.read) return;
    setReadIds((prev) => new Set(prev).add(n.id));
    try {
      await adapter.markRead(n.id, true);
    } catch {
      setReadIds((prev) => {
        const next = new Set(prev);
        next.delete(n.id);
        return next;
      });
    }
  };

  const markAll = async () => {
    try {
      await adapter.markAllRead();
      setReadIds(new Set(inbox.items.map((n) => n.id)));
    } catch {
      /* ignore */
    }
  };

  const header = (
    <View>
      <View
        style={[
          styles.bar,
          { paddingTop: insets.top + 8, borderBottomColor: t.colors.border },
        ]}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={t.colors.text} />
        </Pressable>
        <Text
          style={[
            t.type.title,
            { color: t.colors.text, flex: 1, marginLeft: 8 },
          ]}
        >
          Inbox
        </Text>
        <Pressable
          onPress={markAll}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Mark all as read"
        >
          <Text
            style={[t.type.meta, { color: t.colors.accent, fontWeight: "600" }]}
          >
            Mark all read
          </Text>
        </Pressable>
      </View>
      <View style={styles.tabs}>
        {FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={f.label}
              style={[
                styles.tab,
                { borderBottomColor: active ? t.colors.accent : "transparent" },
              ]}
            >
              <Text
                style={[
                  t.type.meta,
                  {
                    color: active ? t.colors.text : t.colors.textTertiary,
                    fontWeight: active ? "700" : "500",
                  },
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderItem = ({ item }: { item: Notification }) => {
    const unread = !item.read && !readIds.has(item.id);
    return (
      <Pressable
        onPress={() => markRead(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.kind} from ${item.author?.handle ?? "unknown"}${unread ? ", unread" : ""}`}
        style={({ pressed }) => [
          styles.row,
          {
            borderBottomColor: t.colors.border,
            backgroundColor: pressed
              ? t.colors.cardPressed
              : unread
                ? t.colors.bgElevated
                : "transparent",
          },
        ]}
      >
        <Ionicons
          name={KIND_ICON[item.kind] ?? "notifications-outline"}
          size={18}
          color={unread ? t.colors.accent : t.colors.textTertiary}
          style={{ marginTop: 2 }}
        />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.metaRow}>
            <Text
              style={[
                t.type.meta,
                {
                  color: t.colors.text,
                  fontWeight: unread ? "700" : "500",
                  flexShrink: 1,
                },
              ]}
              numberOfLines={1}
            >
              {item.author?.handle ?? "Reddit"}
            </Text>
            <Text
              style={[
                t.type.small,
                { color: t.colors.textTertiary, marginLeft: 8 },
              ]}
            >
              {relativeTime(item.createdAt)}
            </Text>
          </View>
          {item.subject ? (
            <Text
              style={[
                t.type.small,
                { color: t.colors.textSecondary, marginTop: 1 },
              ]}
              numberOfLines={1}
            >
              {item.subject}
            </Text>
          ) : null}
          {item.body.text ? (
            <View style={{ marginTop: 3 }} pointerEvents="none">
              <Markdown
                source={item.body.text}
                numberOfLines={3}
                color={t.colors.textSecondary}
              />
            </View>
          ) : null}
        </View>
        {unread ? (
          <View style={[styles.dot, { backgroundColor: t.colors.accent }]} />
        ) : null}
      </Pressable>
    );
  };

  let body: React.ReactNode;
  if (inbox.loading) body = <SkeletonFeed />;
  else if (inbox.error && inbox.items.length === 0)
    body = (
      <ErrorView
        error={inbox.error}
        onRetry={inbox.refresh}
        sourceLabel={adapter.instance}
      />
    );
  else
    body = (
      <FlashList
        data={inbox.items}
        keyExtractor={(n) => n.id}
        extraData={readIds.size}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyView
            title="Inbox zero"
            detail="No messages here."
            icon="mail-open-outline"
          />
        }
        onEndReached={inbox.loadMore}
        onEndReachedThreshold={0.6}
        refreshing={inbox.refreshing}
        onRefresh={inbox.refresh}
        ListFooterComponent={
          inbox.loadingMore ? (
            <ActivityIndicator
              color={t.colors.accent}
              style={{ marginVertical: 20 }}
            />
          ) : (
            <View style={{ height: 20 }} />
          )
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      />
    );

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {header}
      <View style={styles.fill}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "transparent",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderBottomWidth: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaRow: { flexDirection: "row", alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8, marginTop: 6 },
});
