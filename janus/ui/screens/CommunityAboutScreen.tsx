import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import type { Community, CommunityRule, RichText } from "../../core/model";
import { useTheme } from "../theme";
import { useAdapters } from "../AdapterContext";
import { useAsync, useCachedAsync } from "../hooks";
import { createSwrCache } from "../../app/swrCache";
import { compactNumber } from "../format";
import { isHttpUrl } from "../links";
import { Markdown } from "../components/Markdown";
import { CommunityTwinsCard } from "../components/CommunityTwinsCard";
import { ErrorView, LoadingView } from "../components/StateViews";

type Props = NativeStackScreenProps<RootStackParamList, "CommunityAbout">;

// A community's about/sidebar changes slowly — cache it so re-opening one is
// instant, with a background refetch keeping description/subscriber count fresh.
const COMMUNITY_CACHE = createSwrCache("janus.community.v1");
const COMMUNITY_TTL_MS = 60 * 60 * 1000; // 1h

/** Plain markdown source out of a RichText (both sources feed the renderer markdown). */
function textOf(rt?: RichText): string | undefined {
  const s = rt?.markdown ?? rt?.text;
  return s && s.trim() ? s : undefined;
}

/**
 * Cross-source community "sidebar" — the about page for a subreddit OR a Lemmy
 * community, rendered from the same unified model. Shows banner/icon, subscriber
 * count, the full description, and (where the source supports it) the rule list
 * and a link into the wiki. Rules/wiki are capability-gated, so a Lemmy
 * community simply shows description + stats with no empty rule shell.
 */
export function CommunityAboutScreen({ route, navigation }: Props) {
  const t = useTheme();
  const { adapterForEntity } = useAdapters();
  const seed = route.params.community;
  const adapter = adapterForEntity(seed);
  const caps = adapter.capabilities;

  // Re-fetch the full community: search/drawer snapshots only carry the short
  // blurb, but getCommunity hits about.json for the full sidebar text.
  const {
    data: full,
    loading,
    error,
    reload,
  } = useCachedAsync<Community>(
    COMMUNITY_CACHE,
    `community:${seed.id}`,
    COMMUNITY_TTL_MS,
    () => adapter.getCommunity(seed.id),
    [seed.id],
  );
  const community = full ?? seed;

  const { data: rules } = useAsync<CommunityRule[]>(async () => {
    if (!caps.supportsRules || !adapter.getCommunityRules) return [];
    try {
      return await adapter.getCommunityRules(seed.id);
    } catch {
      return [];
    }
  }, [seed.id]);

  const sourceColor =
    community.source === "reddit" ? t.colors.reddit : t.colors.lemmy;
  const description = textOf(community.description);

  // Optimistic subscribe toggle. `override` wins over the fetched state once the
  // user acts; until then we reflect whatever the (re)fetched community says.
  const [override, setOverride] = useState<boolean | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const subscribed = override ?? community.subscription !== "none";
  const canSubscribe = !adapter.account.isGuest;
  const toggleSub = async () => {
    if (subBusy || !canSubscribe) return;
    setSubBusy(true);
    const next = !subscribed;
    setOverride(next);
    try {
      await adapter.setSubscription(community.id, next);
    } catch {
      setOverride(!next);
    } finally {
      setSubBusy(false);
    }
  };

  const header = (
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
        <Text
          style={[t.type.title, { color: t.colors.text, flex: 1 }]}
          numberOfLines={1}
        >
          {community.handle}
        </Text>
      </View>
    </SafeAreaView>
  );

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {header}
      {loading && !full ? (
        <LoadingView label="Loading community…" />
      ) : error && !full ? (
        <ErrorView error={error} onRetry={reload} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {isHttpUrl(community.banner) ? (
            <Image
              source={{ uri: community.banner }}
              style={styles.banner}
              contentFit="cover"
            />
          ) : (
            <View
              style={[styles.banner, { backgroundColor: t.colors.bgElevated }]}
            />
          )}

          <View style={styles.headRow}>
            {isHttpUrl(community.icon) ? (
              <Image
                source={{ uri: community.icon }}
                style={[styles.icon, { borderColor: sourceColor }]}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  styles.icon,
                  styles.iconFallback,
                  { backgroundColor: t.colors.bg, borderColor: sourceColor },
                ]}
              >
                <Ionicons
                  name={
                    community.source === "reddit" ? "logo-reddit" : "planet"
                  }
                  size={24}
                  color={sourceColor}
                />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text
                style={[t.type.title, { color: t.colors.text }]}
                numberOfLines={2}
              >
                {community.title || community.name}
              </Text>
              <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                {community.handle}
                {community.isNSFW ? " · NSFW" : ""}
              </Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[t.type.title, { color: t.colors.text }]}>
                {compactNumber(community.subscriberCount)}
              </Text>
              <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                {community.source === "reddit" ? "members" : "subscribers"}
              </Text>
            </View>
            {canSubscribe ? (
              <Pressable
                onPress={toggleSub}
                accessibilityRole="button"
                accessibilityLabel={
                  subscribed
                    ? `Leave ${community.handle}`
                    : `Join ${community.handle}`
                }
                accessibilityState={{ selected: subscribed }}
                style={[
                  styles.joinBtn,
                  {
                    borderRadius: t.radius.pill,
                    backgroundColor: subscribed
                      ? t.colors.bgElevated
                      : t.colors.accentActive,
                    borderColor: subscribed
                      ? t.colors.border
                      : t.colors.accentActive,
                  },
                ]}
              >
                <Text
                  style={[
                    t.type.body,
                    {
                      color: subscribed ? t.colors.textSecondary : "#fff",
                      fontWeight: "700",
                    },
                  ]}
                >
                  {subscribed ? "Joined" : "Join"}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Wiki entry — Reddit only (capability-gated). */}
          {caps.supportsWiki && adapter.getWikiPage ? (
            <Pressable
              onPress={() => navigation.navigate("Wiki", { community })}
              accessibilityRole="button"
              accessibilityLabel="Open community wiki"
              style={({ pressed }) => [
                styles.linkRow,
                {
                  borderColor: t.colors.border,
                  backgroundColor: pressed
                    ? t.colors.cardPressed
                    : t.colors.card,
                  borderRadius: t.radius.md,
                },
              ]}
            >
              <Ionicons name="book-outline" size={20} color={t.colors.accent} />
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.text, flex: 1, marginLeft: 12 },
                ]}
              >
                Wiki
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={t.colors.textTertiary}
              />
            </Pressable>
          ) : null}

          <CommunityTwinsCard
            community={community}
            onOpenCommunity={(c) =>
              navigation.navigate("Feed", { openCommunity: c })
            }
          />

          {description ? (
            <View style={styles.section}>
              <Text
                style={[
                  t.type.small,
                  styles.sectionTitle,
                  { color: t.colors.textTertiary },
                ]}
              >
                ABOUT
              </Text>
              <Markdown source={description} />
            </View>
          ) : null}

          {rules && rules.length > 0 ? (
            <View style={styles.section}>
              <Text
                style={[
                  t.type.small,
                  styles.sectionTitle,
                  { color: t.colors.textTertiary },
                ]}
              >
                RULES
              </Text>
              {rules.map((r, i) => (
                <RuleRow key={`${r.name}-${i}`} index={i + 1} rule={r} />
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function RuleRow({ index, rule }: { index: number; rule: CommunityRule }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const detail = textOf(rule.description);
  return (
    <View style={[styles.rule, { borderBottomColor: t.colors.border }]}>
      <Pressable
        onPress={() => detail && setOpen((o) => !o)}
        accessibilityRole={detail ? "button" : "text"}
        accessibilityLabel={`Rule ${index}: ${rule.name}`}
        style={styles.ruleHead}
      >
        <Text
          style={[t.type.meta, { color: t.colors.textTertiary, width: 22 }]}
        >
          {index}.
        </Text>
        <Text
          style={[
            t.type.body,
            { color: t.colors.text, flex: 1, fontWeight: "600" },
          ]}
        >
          {rule.name}
        </Text>
        {detail ? (
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={16}
            color={t.colors.textTertiary}
          />
        ) : null}
      </Pressable>
      {open && detail ? (
        <View style={{ marginLeft: 22, marginTop: 4 }}>
          <Markdown source={detail} color={t.colors.textSecondary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barIcon: { padding: 8 },
  banner: { width: "100%", height: 110 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: -24,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
  },
  iconFallback: { alignItems: "center", justifyContent: "center" },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: 14,
  },
  stat: { flex: 1 },
  joinBtn: {
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  section: { paddingHorizontal: 16, marginTop: 20 },
  sectionTitle: {
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  rule: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  ruleHead: { flexDirection: "row", alignItems: "center" },
});
