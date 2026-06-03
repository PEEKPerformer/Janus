import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useAsync, useFeed } from "../hooks";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
import { Markdown } from "../components/Markdown";
import { ErrorView, EmptyView, SkeletonFeed } from "../components/StateViews";
import { compactNumber, relativeTime } from "../format";
import { isHttpUrl } from "../links";
import type { Post, Comment, User } from "../../core/model";
import type { UserContentKind } from "../../core/adapter";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

const TABS: { id: UserContentKind; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "posts", label: "Posts" },
  { id: "comments", label: "Comments" },
];

function isPost(item: Post | Comment): item is Post {
  return "title" in item;
}

export function ProfileScreen({ route, navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { userId, source, handle } = route.params;
  const { adapters } = useAdapters();
  const adapter = adapters[source];

  const [tab, setTab] = useState<UserContentKind>("overview");
  const user = useAsync<User>(() => adapter.getUser(userId), [userId]);
  const content = useFeed<Post | Comment>(
    (page) => adapter.getUserContent(userId, tab, page),
    [userId, tab],
  );

  const sourceColor = source === "reddit" ? t.colors.reddit : t.colors.lemmy;

  const openPost = (post: Post) => navigation.navigate("Post", { post });

  const header = (
    <View>
      <View style={{ padding: t.spacing.lg, alignItems: "center" }}>
        {user.data && isHttpUrl(user.data.avatar) ? (
          <Image
            source={{ uri: user.data.avatar }}
            style={[styles.avatar, { borderColor: sourceColor }]}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.avatar,
              styles.avatarFallback,
              {
                backgroundColor: t.colors.bgElevated,
                borderColor: sourceColor,
              },
            ]}
          >
            <Ionicons name="person" size={28} color={sourceColor} />
          </View>
        )}
        <Text
          style={[
            t.type.title,
            { color: t.colors.text, fontSize: 18, marginTop: 10 },
          ]}
          numberOfLines={1}
        >
          {handle}
        </Text>
        {user.data ? (
          <View style={styles.karmaRow}>
            {user.data.postScore !== undefined ? (
              <Text style={[t.type.meta, { color: t.colors.textSecondary }]}>
                {compactNumber(user.data.postScore)}{" "}
                {source === "reddit" ? "post karma" : "posts"}
              </Text>
            ) : null}
            {user.data.commentScore !== undefined ? (
              <Text
                style={[
                  t.type.meta,
                  { color: t.colors.textSecondary, marginLeft: 14 },
                ]}
              >
                {compactNumber(user.data.commentScore)}{" "}
                {source === "reddit" ? "comment karma" : "comments"}
              </Text>
            ) : null}
          </View>
        ) : null}
        {user.data?.createdAt ? (
          <Text
            style={[
              t.type.small,
              { color: t.colors.textTertiary, marginTop: 4 },
            ]}
          >
            Joined {relativeTime(user.data.createdAt)}
          </Text>
        ) : null}
        {user.data?.bio?.text ? (
          <View
            style={{ marginTop: 10, alignSelf: "stretch" }}
            pointerEvents="none"
          >
            <Markdown
              source={user.data.bio.text}
              numberOfLines={3}
              color={t.colors.textSecondary}
            />
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.tabs,
          {
            borderBottomColor: t.colors.border,
            borderTopColor: t.colors.border,
          },
        ]}
      >
        {TABS.map((tabDef) => {
          const active = tabDef.id === tab;
          return (
            <Pressable
              key={tabDef.id}
              onPress={() => setTab(tabDef.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tabDef.label}
              style={[
                styles.tab,
                active && { borderBottomColor: t.colors.accent },
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
                {tabDef.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderComment = (comment: Comment) => (
    <View
      style={[
        styles.commentCard,
        {
          backgroundColor: t.colors.card,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
        },
      ]}
    >
      <View style={styles.commentMeta}>
        <Ionicons
          name="chatbubble-outline"
          size={13}
          color={t.colors.textTertiary}
        />
        <Text
          style={[
            t.type.small,
            { color: t.colors.textTertiary, marginLeft: 6, flex: 1 },
          ]}
          numberOfLines={1}
        >
          {compactNumber(comment.score)} points ·{" "}
          {relativeTime(comment.createdAt)}
        </Text>
      </View>
      {comment.body.text ? (
        <View style={{ marginTop: 4 }} pointerEvents="none">
          <Markdown
            source={comment.body.text}
            numberOfLines={4}
            color={t.colors.text}
          />
        </View>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (content.loading) {
    body = <SkeletonFeed />;
  } else if (content.error && content.items.length === 0) {
    body = (
      <ErrorView
        error={content.error}
        onRetry={content.refresh}
        sourceLabel={adapter.instance}
      />
    );
  } else {
    body = (
      <FlashList
        data={content.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) =>
          isPost(item) ? (
            <PostCard
              post={item}
              onPress={() => openPost(item)}
              compact
              showSource={false}
            />
          ) : (
            renderComment(item)
          )
        }
        ListEmptyComponent={
          <EmptyView title="Nothing here yet" detail={`No ${tab} to show.`} />
        }
        onEndReached={content.loadMore}
        onEndReachedThreshold={0.6}
        refreshing={content.refreshing}
        onRefresh={content.refresh}
        ListFooterComponent={
          content.loadingMore ? (
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
  }

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {header}
      <View style={styles.fill}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 2 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  karmaRow: { flexDirection: "row", marginTop: 8 },
  tabs: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  commentCard: {
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 12,
    borderWidth: 1,
  },
  commentMeta: { flexDirection: "row", alignItems: "center" },
});
