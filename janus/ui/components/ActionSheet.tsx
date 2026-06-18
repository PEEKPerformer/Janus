import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { SPRING } from "../motion";
import { playHaptic } from "../haptics";

export interface ActionItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
}

// Past this drag (or with enough downward flick velocity) on release, dismiss.
const DISMISS_DY = 110;
const DISMISS_VY = 800;

/**
 * Generic bottom action sheet (native-iOS feel). The caller assembles the
 * applicable {@link ActionItem}s — source/entity differences are decided there,
 * so this stays presentation-only and reusable across post/comment/community
 * long-press menus.
 *
 * Motion (Reanimated, UI thread): springs up on open with the shared `gentle`
 * spring; drag it down to dismiss; a short drag snaps back inheriting your
 * release velocity, a long drag or firm flick throws it closed. The backdrop
 * fades with the drag. Closing is a single path — every dismisser just requests
 * `onClose`, and the slide-out plays when `visible` flips false. A nested
 * GestureHandlerRootView is required because the Modal mounts in its own native
 * hierarchy, outside the app's root.
 */
export function ActionSheet({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title?: string;
  items: ActionItem[];
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // Stay mounted through the close animation so the slide-out can play.
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(0);
  const sheetH = useSharedValue(600);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = sheetH.value; // start just below its own height
      translateY.value = withSpring(0, SPRING.gentle);
    } else if (mounted) {
      translateY.value = withTiming(sheetH.value, { duration: 190 }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [visible, mounted, translateY, sheetH]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DY || e.velocityY > DISMISS_VY) {
        runOnJS(onClose)(); // visible → false drives the slide-out
      } else {
        translateY.value = withSpring(0, {
          ...SPRING.snappy,
          velocity: e.velocityY,
        });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => {
    const h = sheetH.value || 1;
    const progress = 1 - Math.min(1, Math.max(0, translateY.value / h));
    return { opacity: 0.45 * progress };
  });

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.fill}>
        <View style={styles.fill}>
          <Animated.View
            style={[styles.backdropFill, backdropStyle]}
            pointerEvents="none"
          />
          <Pressable
            style={styles.fill}
            onPress={onClose}
            accessibilityLabel="Dismiss menu"
          />
          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={(e) => {
                sheetH.value = e.nativeEvent.layout.height || sheetH.value;
              }}
              style={[
                styles.sheet,
                sheetStyle,
                {
                  backgroundColor: t.colors.bgElevated,
                  borderColor: t.colors.border,
                  paddingBottom: insets.bottom + 8,
                },
              ]}
            >
              <View style={styles.handle}>
                <View
                  style={[styles.grip, { backgroundColor: t.colors.border }]}
                />
              </View>
              {title ? (
                <Text
                  style={[
                    t.type.small,
                    styles.title,
                    { color: t.colors.textTertiary },
                  ]}
                  numberOfLines={2}
                >
                  {title}
                </Text>
              ) : null}
              {items.map((item, i) => (
                <Pressable
                  key={`${item.label}-${i}`}
                  onPress={() => {
                    playHaptic("selection");
                    onClose();
                    item.onPress();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: pressed
                        ? t.colors.cardPressed
                        : "transparent",
                    },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={20}
                    color={item.destructive ? t.colors.danger : t.colors.text}
                  />
                  <Text
                    style={[
                      t.type.body,
                      {
                        marginLeft: 14,
                        color: item.destructive
                          ? t.colors.danger
                          : t.colors.text,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
  },
  handle: { alignItems: "center", paddingVertical: 8 },
  grip: { width: 38, height: 5, borderRadius: 3 },
  title: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
});
