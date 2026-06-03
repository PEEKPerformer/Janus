import React, { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import {
  POPULAR_LEMMY_INSTANCES,
  normalizeInstance,
} from "../../sources/lemmy/LemmyInstance";

/**
 * Lemmy instance chooser — pick a well-known instance or type a custom one.
 * The Fediverse has no single home server, so (like Voyager) the user selects
 * which instance to browse/post on.
 */
export function LemmyInstanceModal({
  current,
  onSelect,
  onClose,
}: {
  current: string;
  onSelect: (instance: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [custom, setCustom] = useState("");
  const customHost = normalizeInstance(custom);
  const customValid = customHost.includes(".") && !customHost.includes(" ");

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: t.colors.bg, zIndex: 110 },
      ]}
    >
      <SafeAreaView style={styles.fill}>
        <View style={[styles.bar, { borderBottomColor: t.colors.border }]}>
          <Text style={[t.type.title, { color: t.colors.text }]}>
            Choose instance
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Close instance picker"
          >
            <Ionicons name="close" size={24} color={t.colors.text} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.customWrap}>
            <View
              style={[
                styles.customBox,
                {
                  backgroundColor: t.colors.bgElevated,
                  borderColor: t.colors.border,
                  borderRadius: t.radius.md,
                },
              ]}
            >
              <Ionicons
                name="globe-outline"
                size={16}
                color={t.colors.textTertiary}
              />
              <TextInput
                value={custom}
                onChangeText={setCustom}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={() => customValid && onSelect(customHost)}
                placeholder="Custom instance (e.g. lemmy.zip)"
                placeholderTextColor={t.colors.textTertiary}
                style={[
                  t.type.body,
                  styles.customInput,
                  { color: t.colors.text },
                ]}
                accessibilityLabel="Custom instance"
              />
              {custom.length > 0 ? (
                <Pressable
                  onPress={() => customValid && onSelect(customHost)}
                  disabled={!customValid}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Use custom instance"
                >
                  <Ionicons
                    name="arrow-forward-circle"
                    size={22}
                    color={
                      customValid ? t.colors.accent : t.colors.textTertiary
                    }
                  />
                </Pressable>
              ) : null}
            </View>
          </View>

          <FlatList
            data={POPULAR_LEMMY_INSTANCES}
            keyExtractor={(i) => i}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <Text
                style={[
                  t.type.small,
                  styles.sectionHeader,
                  { color: t.colors.textTertiary },
                ]}
              >
                POPULAR INSTANCES
              </Text>
            }
            renderItem={({ item }) => {
              const active = item === current;
              return (
                <Pressable
                  onPress={() => onSelect(item)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={item}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderBottomColor: t.colors.border,
                      backgroundColor: pressed
                        ? t.colors.cardPressed
                        : "transparent",
                    },
                  ]}
                >
                  <Ionicons name="planet" size={18} color={t.colors.lemmy} />
                  <Text
                    style={[
                      t.type.body,
                      { color: t.colors.text, marginLeft: 12, flex: 1 },
                    ]}
                  >
                    {item}
                  </Text>
                  {active ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={t.colors.accent}
                    />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  customWrap: { padding: 16, paddingBottom: 8 },
  customBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 46,
    borderWidth: StyleSheet.hairlineWidth,
  },
  customInput: { flex: 1, marginLeft: 8, paddingVertical: 0 },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
