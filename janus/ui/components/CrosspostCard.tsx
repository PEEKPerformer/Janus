import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { isHttpUrl } from "../links";
import { compactNumber, relativeTime } from "../format";
import type { Post } from "../../core/model";

/**
 * Nested preview of a Reddit crosspost's ORIGINAL post. Reddit crossposts are
 * first-class posts whose own body is empty — the content lives in the parent.
 * We render that parent as a tappable bordered card so the crosspost isn't a
 * bare title with nothing under it.
 */
export function CrosspostCard({
  post,
  onPress,
}: {
  post: Post;
  onPress?: () => void;
}) {
  const t = useTheme();
  const image = post.media.find(
    (m) => m.kind === "image" || m.kind === "gallery",
  );
  const thumb = isHttpUrl(image?.thumbnailUrl)
    ? image!.thumbnailUrl
    : isHttpUrl(image?.url)
      ? image!.url
      : undefined;
  const isVideo = post.media.some((m) => m.kind === "video");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Crossposted from ${post.community.handle}: ${post.title}`}
      style={({ pressed }) => [
        styles.card,
        {
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          backgroundColor: pressed ? t.colors.cardPressed : t.colors.bgElevated,
        },
      ]}
    >
      <View style={styles.labelRow}>
        <Ionicons name="repeat" size={12} color={t.colors.textTertiary} />
        <Text
          style={[t.type.small, { color: t.colors.textTertiary, marginLeft: 5 }]}
          numberOfLines={1}
        >
          Crossposted from {post.community.handle}
        </Text>
      </View>
      <View style={styles.body}>
        {thumb ? (
          <View style={styles.thumbWrap}>
            <Image
              source={{ uri: thumb }}
              style={[styles.thumb, { backgroundColor: t.colors.skeleton }]}
              contentFit="cover"
            />
            {isVideo ? (
              <View style={styles.play} pointerEvents="none">
                <Ionicons name="play" size={14} color="#fff" />
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text
            style={[t.type.meta, { color: t.colors.text, fontWeight: "600" }]}
            numberOfLines={3}
          >
            {post.title}
          </Text>
          <Text
            style={[
              t.type.small,
              { color: t.colors.textTertiary, marginTop: 3 },
            ]}
            numberOfLines={1}
          >
            {compactNumber(post.score)} points ·{" "}
            {compactNumber(post.commentCount)} comments ·{" "}
            {relativeTime(post.createdAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  labelRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  body: { flexDirection: "row", alignItems: "flex-start" },
  thumbWrap: { marginRight: 10 },
  thumb: { width: 64, height: 64, borderRadius: 8 },
  play: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
