import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import type { WikiPage } from "../../core/model";
import { useTheme } from "../theme";
import { useAdapters } from "../AdapterContext";
import { useCachedAsync } from "../hooks";
import { createSwrCache } from "../../app/swrCache";
import { relativeTime } from "../format";
import { Markdown } from "../components/Markdown";
import { ErrorView, EmptyView, LoadingView } from "../components/StateViews";

type Props = NativeStackScreenProps<RootStackParamList, "Wiki">;

// Wikis are near-static prose — cache hard and serve from disk; a reopen within
// the day costs nothing. Pull-to-refresh (reload) still forces a fetch.
const WIKI_CACHE = createSwrCache("janus.wiki.v1");
const WIKI_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Community wiki viewer. Capability-gated to sources with a real wiki (Reddit) —
 * Lemmy never routes here. Loads the page natively (Reddit /wiki/{page}.json)
 * and renders the markdown through the shared renderer, rather than dropping the
 * user into a web view. Defaults to the wiki index.
 */
export function WikiScreen({ route, navigation }: Props) {
  const t = useTheme();
  const { adapterForEntity } = useAdapters();
  const { community, page } = route.params;
  const adapter = adapterForEntity(community);
  const slug = page ?? "index";

  const { data, loading, error, reload } = useCachedAsync<WikiPage | null>(
    WIKI_CACHE,
    `${community.id}:${slug}`,
    WIKI_TTL_MS,
    async () => {
      if (!adapter.getWikiPage) return null;
      return adapter.getWikiPage(community.id, slug);
    },
    [community.id, slug],
    { cacheFirst: true },
  );

  const content = data?.content?.markdown ?? data?.content?.text;
  const revised = data?.revisedAt
    ? `Updated ${relativeTime(data.revisedAt)}${data.revisedBy ? ` by ${data.revisedBy}` : ""}`
    : undefined;

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      <SafeAreaView
        edges={["top"]}
        style={{ backgroundColor: t.colors.bgElevated }}
      >
        <View style={[styles.appBar, { borderBottomColor: t.colors.border }]}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.barIcon}
          >
            <Ionicons name="chevron-back" size={26} color={t.colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text
              style={[t.type.title, { color: t.colors.text }]}
              numberOfLines={1}
            >
              Wiki
            </Text>
            <Text
              style={[t.type.small, { color: t.colors.textTertiary }]}
              numberOfLines={1}
            >
              {community.handle}
              {slug !== "index" ? ` · ${slug}` : ""}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {loading ? (
        <LoadingView label="Loading wiki…" />
      ) : error ? (
        <ErrorView error={error} onRetry={reload} />
      ) : !content ? (
        <EmptyView
          title="No wiki page"
          detail="This community doesn't have a wiki here yet."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Markdown source={content} />
          {revised ? (
            <Text
              style={[
                t.type.small,
                { color: t.colors.textTertiary, marginTop: 24 },
              ]}
            >
              {revised}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barIcon: { padding: 8 },
  body: { padding: 16, paddingBottom: 48 },
});
