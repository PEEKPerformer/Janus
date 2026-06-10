import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

/**
 * The plane-mode packing animation: a gateway (Janus!) pulling your reading
 * in. Concentric accent rings collapse toward the center while a slow orbit
 * of content glyphs — a post, an image, a comment — spirals in around a
 * waiting airplane. Core `Animated` only (no extra deps), all loops on the
 * native driver.
 */

const RING_COUNT = 4;
const RING_CYCLE_MS = 2600;
const ORBIT_CYCLE_MS = 7000;

const ORBIT_GLYPHS = [
  "image-outline",
  "chatbubble-outline",
  "document-text-outline",
] as const;

export function Wormhole({ size = 220 }: { size?: number }) {
  const t = useTheme();
  const rings = useRef(
    Array.from({ length: RING_COUNT }, () => new Animated.Value(0)),
  ).current;
  const orbit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const running: Animated.CompositeAnimation[] = [];
    // Stagger the ring starts so there's always one mid-collapse.
    const timers = rings.map((v, i) =>
      setTimeout(
        () => {
          const loop = Animated.loop(
            Animated.timing(v, {
              toValue: 1,
              duration: RING_CYCLE_MS,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          );
          running.push(loop);
          loop.start();
        },
        (RING_CYCLE_MS / RING_COUNT) * i,
      ),
    );
    const spin = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: ORBIT_CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    running.push(spin);
    spin.start();
    return () => {
      timers.forEach(clearTimeout);
      running.forEach((a) => a.stop());
    };
  }, [rings, orbit]);

  const rotate = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const counterRotate = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ["360deg", "0deg"],
  });
  const orbitRadius = size * 0.34;

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityLabel="Packing for your flight"
    >
      {rings.map((v, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: t.colors.accent,
              opacity: v.interpolate({
                inputRange: [0, 0.15, 1],
                outputRange: [0, 0.55, 0],
              }),
              transform: [
                {
                  scale: v.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 0.08],
                  }),
                },
              ],
            },
          ]}
        />
      ))}

      {/* Content spiraling toward the gate. */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            alignItems: "center",
            justifyContent: "center",
            transform: [{ rotate }],
          },
        ]}
      >
        {ORBIT_GLYPHS.map((glyph, i) => {
          const angle = (i / ORBIT_GLYPHS.length) * Math.PI * 2;
          return (
            <Animated.View
              key={glyph}
              style={{
                position: "absolute",
                transform: [
                  { translateX: Math.cos(angle) * orbitRadius },
                  { translateY: Math.sin(angle) * orbitRadius },
                  // Keep each glyph upright while its orbit spins.
                  { rotate: counterRotate },
                ],
              }}
            >
              <Ionicons name={glyph} size={18} color={t.colors.textSecondary} />
            </Animated.View>
          );
        })}
      </Animated.View>

      <View
        style={[
          styles.core,
          {
            backgroundColor: t.colors.accent,
            width: size * 0.26,
            height: size * 0.26,
            borderRadius: size * 0.13,
          },
        ]}
      >
        <Ionicons name="airplane" size={size * 0.13} color={t.colors.bg} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: "absolute",
    borderWidth: 2,
  },
  core: {
    alignItems: "center",
    justifyContent: "center",
  },
});
