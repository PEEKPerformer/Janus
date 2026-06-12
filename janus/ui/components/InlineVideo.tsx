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
  autoplay = false,
  gif = false,
}: {
  /** HLS (.m3u8) or progressive mp4 URL. */
  uri: string;
  poster?: string;
  aspectRatio?: number;
  obscured?: boolean;
  obscureLabel?: string;
  /** Start playing immediately (muted) instead of tap-to-play. */
  autoplay?: boolean;
  /** GIF semantics: muted loop, no transport bar, tap pauses/resumes. */
  gif?: boolean;
}) {
  const t = useTheme();
  // Autoplay starts active+muted, unless the post is obscured (NSFW/spoiler).
  const [active, setActive] = useState((autoplay || gif) && !obscured);
  const ratio = Math.min(Math.max(aspectRatio, 0.5), 1.9);

  if (active) {
    return (
      <View
        style={[
          styles.frame,
          { aspectRatio: ratio, borderRadius: t.radius.md },
        ]}
      >
        <ActiveVideo uri={uri} muted={autoplay} gif={gif} />
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
function ActiveVideo({
  uri,
  muted = false,
  gif = false,
}: {
  uri: string;
  muted?: boolean;
  gif?: boolean;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = muted || gif; // autoplayed (muted) clips and gifs loop
    p.muted = muted || gif;
    p.play();
  });
  const [paused, setPaused] = useState(false);

  const video = (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      fullscreenOptions={{ enable: !gif }}
      nativeControls={!gif}
    />
  );
  if (!gif) return video;
  // GIF: no transport chrome — a tap freezes/resumes the loop instead.
  return (
    <Pressable
      onPress={() => {
        try {
          if (paused) player.play();
          else player.pause();
        } catch {
          /* released */
        }
        setPaused(!paused);
      }}
      accessibilityRole="button"
      accessibilityLabel={paused ? "Resume gif" : "Pause gif"}
      style={StyleSheet.absoluteFill}
    >
      {video}
      {paused ? (
        <View style={styles.playWrap} pointerEvents="none">
          <View style={styles.playBadge}>
            <Ionicons name="play" size={26} color="#fff" />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", overflow: "hidden", backgroundColor: "#000" },
  playWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
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
