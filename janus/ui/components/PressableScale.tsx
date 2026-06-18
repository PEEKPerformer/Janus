import React from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { SPRING, PRESS_SCALE } from "../motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A Pressable that dips slightly under the finger and springs back — the quiet
 * press state that's on every cell and button in a native-feeling app, and whose
 * absence reads (subconsciously) as "web". Scale is a transform, so it never
 * disturbs layout. Drop-in for a Pressable with a static `style`.
 *
 * Forwards all Pressable props; `onPressIn`/`onPressOut` still fire after the
 * scale is kicked off. For tappables that pass a `style` *function* (per-`pressed`
 * styling), keep a plain Pressable — this takes a static style only.
 */
export function PressableScale({
  children,
  style,
  scaleTo = PRESS_SCALE,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style"> & {
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => {
        scale.value = withSpring(scaleTo, SPRING.snappy);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        scale.value = withSpring(1, SPRING.snappy);
        onPressOut?.(e);
      }}
      style={[style, animStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
