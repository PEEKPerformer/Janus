import React, { useMemo } from "react";
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
import { useAggregateFeed, type AggregateSource } from "../hooks";
import { useTheme } from "../theme";
import { Markdown } from "../components/Markdown";
import { SourcePill } from "../components/SourcePill";
import { ErrorView, EmptyView, SkeletonFeed } from "../components/StateViews";
import { relativeTime } from "../format";
import type { Conversation } from "../../core/model";

type Props = NativeStackScreenProps<RootStackParamList, "Messages">;

/**
 * Cross-account direct-message inbox: every signed-in identity's conversation
 * threads, merged and sorted by latest activity. Each row is provenance-tagged
 * so a message from your Lemmy.world account is never confused with a Reddit DM.
 */
export function MessagesScreen({ navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { manager, accountVersion } = useAdapters();

  const signedIn = useMemo(
    () => manager.signedInAdapters(),

    [manager, accountVersion],
  );
  const sources = useMemo<AggregateSource<Conversation>[]>(
    () =>
      signedIn.map((a) => ({
        key: `${a.source}:${a.instance}`,
        fetch: (page) => a.getConversations(page),
      })),
    [signedIn],
  );

  const convos = useAggregateFeed<Conversation>(
    sources,
    (c) => c.id,
    (c) => c.lastMessage.createdAt,
    [sources.map((s) => s.key).join("|")],
  );

  const header = (
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
        style={[t.type.title, { color: t.colors.text, flex: 1, marginLeft: 8 }]}
      >
        Messages
      </Text>
    </View>
  );

  const renderItem = ({ item }: { item: Conversation }) => {
    const unread = item.unreadCount > 0;
    const last = item.lastMessage;
    return (
      <Pressable
        onPress={() =>
          navigation.navigate("MessageThread", {
            correspondentId: item.id,
            source: item.source,
            instance: item.instance,
            handle: item.correspondent.handle,
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`Conversation with ${item.correspondent.handle}${
          unread ? `, ${item.unreadCount} unread` : ""
        }`}
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
        <View style={styles.avatar}>
          <Ionicons name="person" size={18} color={t.colors.textTertiary} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.metaRow}>
            <Text
              style={[
                t.type.meta,
                {
                  color: t.colors.text,
                  fontWeight: unread ? "700" : "600",
                  flexShrink: 1,
                },
              ]}
              numberOfLines={1}
            >
              {item.correspondent.handle}
            </Text>
            <SourcePill
              source={item.source}
              instance={item.instance}
              size="xs"
            />
            <Text
              style={[
                t.type.small,
                { color: t.colors.textTertiary, marginLeft: 6 },
              ]}
            >
              {relativeTime(last.createdAt)}
            </Text>
          </View>
          <View style={{ marginTop: 2 }} pointerEvents="none">
            <Markdown
              source={`${last.fromMe ? "You: " : ""}${last.body.text ?? ""}`}
              numberOfLines={2}
              color={unread ? t.colors.text : t.colors.textSecondary}
            />
          </View>
        </View>
        {unread ? (
          <View style={[styles.badge, { backgroundColor: t.colors.accent }]}>
            <Text style={styles.badgeText}>
              {item.unreadCount > 9 ? "9+" : item.unreadCount}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  let body: React.ReactNode;
  if (convos.loading) body = <SkeletonFeed />;
  else if (convos.error && convos.items.length === 0)
    body = <ErrorView error={convos.error} onRetry={convos.refresh} />;
  else
    body = (
      <FlashList
        data={convos.items}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyView
            title="No messages"
            detail="Start a conversation from someone's profile."
            icon="chatbubbles-outline"
          />
        }
        onEndReached={convos.loadMore}
        onEndReachedThreshold={0.6}
        refreshing={convos.refreshing}
        onRefresh={convos.refresh}
        ListFooterComponent={
          convos.loadingMore ? (
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(127,127,127,0.15)",
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
