import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useAdapters } from "../AdapterContext";
import { useAsync } from "../hooks";
import { buildId } from "../../core/ids";
import type { Community } from "../../core/model";
import {
  curatedTwinsFor,
  suggestTwinSearch,
  isAcceptableSuggestion,
  type TwinSuggestion,
} from "../../app/communityTwins";
import { track } from "../../app/analytics";

const REDDIT_INSTANCE = "www.reddit.com";

/**
 * "There's a home for this on the other network too." The signature
 * cross-network nudge: verified curated twins shown with confidence, plus a
 * single threshold-gated *suggested* fallback (clearly labelled) when no curated
 * mapping exists. Resolving a twin to a routable Community is async — Reddit via
 * getCommunity, Lemmy via federation resolve — so each row shows its own spinner.
 */
export function CommunityTwinsCard({
  community,
  onOpenCommunity,
}: {
  community: Community;
  onOpenCommunity: (c: Community) => void;
}) {
  const t = useTheme();
  const { adapters } = useAdapters();
  const lookupName =
    community.source === "reddit" ? community.name : community.handle;

  const curated = useMemo(
    () => curatedTwinsFor({ source: community.source, name: lookupName }),
    [community.source, lookupName],
  );

  // Suggested tier — only when there's no curated entry, and only if a same-name
  // community on the other network clears the activity threshold.
  const { data: suggested } = useAsync<TwinSuggestion | null>(async () => {
    if (curated.length) return null;
    const { otherSource, query } = suggestTwinSearch({
      source: community.source,
      name: lookupName,
    });
    try {
      const page = await adapters[otherSource].searchCommunities(query, {
        limit: 5,
      });
      const hit = page.items.find((c) =>
        isAcceptableSuggestion(
          { name: c.name, subscriberCount: c.subscriberCount },
          query,
        ),
      );
      if (!hit) return null;
      return {
        source: otherSource,
        handle: hit.handle,
        name: hit.name,
        instance: otherSource === "lemmy" ? hit.instance : undefined,
        verified: false,
      };
    } catch {
      return null;
    }
  }, [community.id, curated.length]);

  const twins: TwinSuggestion[] = curated.length
    ? curated
    : suggested
      ? [suggested]
      : [];
  const [opening, setOpening] = useState<string | null>(null);

  if (twins.length === 0) return null;

  const open = async (s: TwinSuggestion) => {
    if (opening) return;
    track("community_twin_opened", {
      from_source: community.source,
      twin_source: s.source,
      verified: s.verified,
    });
    setOpening(s.handle);
    try {
      if (s.source === "reddit") {
        const c = await adapters.reddit.getCommunity(
          buildId({
            source: "reddit",
            instance: REDDIT_INSTANCE,
            kind: "community",
            nativeId: s.name,
          }),
        );
        onOpenCommunity(c);
      } else {
        const lemmy = adapters.lemmy;
        const resolved = await lemmy.resolveRemoteUrl(
          `https://${s.instance}/c/${s.name}`,
        );
        if (resolved.kind === "community") {
          onOpenCommunity(await lemmy.getCommunity(resolved.id));
        }
      }
    } catch {
      /* couldn't resolve — leave the user where they are */
    } finally {
      setOpening(null);
    }
  };

  const otherColor =
    twins[0].source === "reddit" ? t.colors.reddit : t.colors.lemmy;

  return (
    <View style={styles.section}>
      <Text
        style={[t.type.small, styles.header, { color: t.colors.textTertiary }]}
      >
        {community.source === "reddit" ? "ALSO ON LEMMY" : "ALSO ON REDDIT"}
      </Text>
      {twins.map((s) => (
        <Pressable
          key={s.handle}
          onPress={() => open(s)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${s.handle} on ${s.source}${
            s.verified ? ", verified twin" : ", suggested"
          }`}
          style={({ pressed }) => [
            styles.row,
            {
              borderColor: t.colors.border,
              backgroundColor: pressed ? t.colors.cardPressed : t.colors.card,
              borderRadius: t.radius.md,
            },
          ]}
        >
          <View
            style={[
              styles.icon,
              { backgroundColor: t.colors.bg, borderColor: otherColor },
            ]}
          >
            <Ionicons
              name={s.source === "reddit" ? "logo-reddit" : "planet"}
              size={15}
              color={otherColor}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text
              style={[t.type.body, { color: t.colors.text, fontWeight: "600" }]}
              numberOfLines={1}
            >
              {s.handle}
            </Text>
            <View style={styles.tagRow}>
              <Ionicons
                name={s.verified ? "checkmark-circle" : "sparkles-outline"}
                size={12}
                color={s.verified ? t.colors.lemmy : t.colors.textTertiary}
              />
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.textTertiary, marginLeft: 4 },
                ]}
              >
                {s.verified ? "Verified twin" : "Suggested match"}
              </Text>
            </View>
          </View>
          {opening === s.handle ? (
            <ActivityIndicator color={t.colors.accent} />
          ) : (
            <Ionicons
              name="chevron-forward"
              size={16}
              color={t.colors.textTertiary}
            />
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, marginTop: 20 },
  header: { fontWeight: "700", letterSpacing: 0.5, marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  tagRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
});
