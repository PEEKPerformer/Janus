import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { useTheme } from "../theme";
import { isHttpUrl } from "../links";

/**
 * Lazy inline video. Until the user taps play we render only a lightweight
 * poster + play badge — so a feed of video posts costs nothing until one is
 * actually watched. On tap we mount a real {@link VideoView} with the platform's
 * native transport controls and fullscreen affordance, which is what makes it
 * feel native on iOS (the same chrome Safari/Photos use).
 */
export function InlineVideo({
  uri,
  poster,
  aspectRatio = 1.2,
  obscured = false,
  obscureLabel = "NSFW",
}: {
  /** HLS (.m3u8) or progressive mp4 URL. */
  uri: string;
  poster?: string;
  aspectRatio?: number;
  obscured?: boolean;
  obscureLabel?: string;
}) {
  const t = useTheme();
  const [active, setActive] = useState(false);
  const ratio = Math.min(Math.max(aspectRatio, 0.5), 1.9);

  if (active) {
    return (
      <View
        style={[
          styles.frame,
          { aspectRatio: ratio, borderRadius: t.radius.md },
        ]}
      >
        <ActiveVideo uri={uri} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => setActive(true)}
      accessibilityRole="button"
      accessibilityLabel="Play video"
      style={[
        styles.frame,
        {
          aspectRatio: ratio,
          borderRadius: t.radius.md,
          backgroundColor: t.colors.skeleton,
        },
      ]}
    >
      {isHttpUrl(poster) ? (
        <Image
          source={{ uri: poster }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={obscured ? 55 : 0}
          transition={150}
        />
      ) : null}
      {obscured ? (
        <View style={styles.overlay} pointerEvents="none">
          <Ionicons name="eye-off" size={20} color="#fff" />
          <Text style={[t.type.meta, { color: "#fff", marginTop: 4 }]}>
            {obscureLabel} · tap to play
          </Text>
        </View>
      ) : (
        <View style={styles.playWrap} pointerEvents="none">
          <View style={styles.playBadge}>
            <Ionicons name="play" size={26} color="#fff" />
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** The mounted player — only ever rendered while watching. */
function ActiveVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = false;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      nativeControls
    />
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", overflow: "hidden", backgroundColor: "#000" },
  playWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  playBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 3,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
});
