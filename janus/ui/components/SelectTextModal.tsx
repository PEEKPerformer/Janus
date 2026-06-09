import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";

/**
 * A full-screen sheet that presents text with native selection enabled, so the
 * user can copy a passage out of a post or comment (RN's inline rendering
 * otherwise makes precise selection fiddly). Source-agnostic — it just shows
 * whatever plain text the caller hands it.
 */
export function SelectTextModal({
  visible,
  text,
  onClose,
}: {
  visible: boolean;
  text: string;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
        <View
          style={[
            styles.bar,
            {
              borderBottomColor: t.colors.border,
              paddingTop: insets.top + 8,
            },
          ]}
        >
          <Text style={[t.type.title, { color: t.colors.text, flex: 1 }]}>
            Select text
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={26} color={t.colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text
            selectable
            style={[t.type.body, { color: t.colors.text, lineHeight: 24 }]}
          >
            {text}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { padding: 16, paddingBottom: 48 },
});
