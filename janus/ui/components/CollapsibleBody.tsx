import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

/**
 * Clamps a tall body to `collapsedHeight` with a Read more / Show less toggle.
 * The inner view reports its natural height via onLayout even while the outer is
 * clipped, so we can detect "is this long enough to bother collapsing?" without
 * measuring twice. Short bodies render untouched (no toggle).
 */
export function CollapsibleBody({
  children,
  collapsedHeight = 360,
}: {
  children: React.ReactNode;
  collapsedHeight?: number;
}) {
  const t = useTheme();
  const [fullHeight, setFullHeight] = useState(0);
  const [collapsed, setCollapsed] = useState(true);
  const tall = fullHeight > collapsedHeight + 48;

  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h && Math.abs(h - fullHeight) > 1) setFullHeight(h);
  };

  return (
    <View>
      <View
        style={
          tall && collapsed
            ? { height: collapsedHeight, overflow: "hidden" }
            : null
        }
      >
        <View onLayout={onLayout}>{children}</View>
      </View>
      {tall ? (
        <Pressable
          onPress={() => setCollapsed((c) => !c)}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? "Read more" : "Show less"}
          style={[styles.toggle, { borderTopColor: t.colors.border }]}
        >
          <Ionicons
            name={collapsed ? "chevron-down" : "chevron-up"}
            size={15}
            color={t.colors.accent}
          />
          <Text
            style={[
              t.type.meta,
              { color: t.colors.accent, fontWeight: "700", marginLeft: 6 },
            ]}
          >
            {collapsed ? "Read more" : "Show less"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
