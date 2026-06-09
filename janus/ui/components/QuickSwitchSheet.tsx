import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { useAdapters, type FeedScope } from "../AdapterContext";

const SCOPES: {
  id: FeedScope;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { id: "all", label: "Everything", icon: "layers" },
  { id: "reddit", label: "Reddit", icon: "logo-reddit" },
  { id: "lemmy", label: "Lemmy", icon: "planet" },
];

/**
 * Quick identity / scope switcher — the "who am I browsing as" tray. Janus runs
 * one Reddit account alongside several Lemmy instances at once, so switching is
 * really about which surface is focused: the merged feed vs a single source, and
 * which Lemmy instance is the active home. Tapping the drawer's account row opens
 * this instead of burying it in Settings.
 */
export function QuickSwitchSheet({
  visible,
  onClose,
  onAddAccount,
  onOpenSettings,
}: {
  visible: boolean;
  onClose: () => void;
  onAddAccount: (source: "reddit" | "lemmy") => void;
  onOpenSettings: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const {
    adapters,
    lemmyAdapters,
    lemmyInstance,
    changeLemmyInstance,
    feedScope,
    setFeedScope,
  } = useAdapters();

  const reddit = adapters.reddit.account;

  const close = onClose;
  const pick = (fn: () => void) => {
    fn();
    close();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              paddingBottom: insets.bottom + 8,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle}>
            <View style={[styles.grip, { backgroundColor: t.colors.border }]} />
          </View>

          <Text
            style={[
              t.type.small,
              styles.header,
              { color: t.colors.textTertiary },
            ]}
          >
            BROWSE
          </Text>
          <View style={styles.scopeRow}>
            {SCOPES.map((s) => {
              const active = feedScope === s.id;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => pick(() => setFeedScope(s.id))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={s.label}
                  style={[
                    styles.scopeChip,
                    {
                      borderRadius: t.radius.md,
                      backgroundColor: active
                        ? t.colors.accentActive
                        : t.colors.bg,
                      borderColor: active
                        ? t.colors.accentActive
                        : t.colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={s.icon}
                    size={18}
                    color={active ? "#fff" : t.colors.textSecondary}
                  />
                  <Text
                    style={[
                      t.type.small,
                      {
                        color: active ? "#fff" : t.colors.textSecondary,
                        marginTop: 4,
                        fontWeight: "600",
                      },
                    ]}
                  >
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text
            style={[
              t.type.small,
              styles.header,
              { color: t.colors.textTertiary },
            ]}
          >
            REDDIT
          </Text>
          <View style={styles.row}>
            <Ionicons name="logo-reddit" size={20} color={t.colors.reddit} />
            <Text
              style={[
                t.type.body,
                { color: t.colors.text, flex: 1, marginLeft: 12 },
              ]}
              numberOfLines={1}
            >
              {reddit.isGuest ? "Browsing as guest" : reddit.username}
            </Text>
            {reddit.isGuest ? (
              <Pressable
                onPress={() => pick(() => onAddAccount("reddit"))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Sign in to Reddit"
              >
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.accent, fontWeight: "700" },
                  ]}
                >
                  Sign in
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Text
            style={[
              t.type.small,
              styles.header,
              { color: t.colors.textTertiary },
            ]}
          >
            LEMMY INSTANCE
          </Text>
          {lemmyAdapters.map((a) => {
            const focused = a.instance === lemmyInstance;
            return (
              <Pressable
                key={a.instance}
                onPress={() => pick(() => changeLemmyInstance(a.instance))}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={`Focus ${a.instance}`}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed
                      ? t.colors.cardPressed
                      : "transparent",
                  },
                ]}
              >
                <Ionicons name="planet" size={18} color={t.colors.lemmy} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text
                    style={[t.type.body, { color: t.colors.text }]}
                    numberOfLines={1}
                  >
                    {a.instance}
                  </Text>
                  <Text
                    style={[t.type.small, { color: t.colors.textTertiary }]}
                  >
                    {a.account.isGuest ? "Guest" : a.account.username}
                  </Text>
                </View>
                {focused ? (
                  <Ionicons
                    name="checkmark"
                    size={18}
                    color={t.colors.accent}
                  />
                ) : null}
              </Pressable>
            );
          })}

          <View style={[styles.footer, { borderTopColor: t.colors.border }]}>
            <Pressable
              onPress={() => pick(() => onAddAccount("lemmy"))}
              accessibilityRole="button"
              accessibilityLabel="Add an account"
              style={styles.footerBtn}
            >
              <Ionicons name="add" size={18} color={t.colors.accent} />
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.accent, fontWeight: "700" },
                ]}
              >
                Add account
              </Text>
            </Pressable>
            <Pressable
              onPress={() => pick(onOpenSettings)}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              style={styles.footerBtn}
            >
              <Ionicons
                name="settings-outline"
                size={18}
                color={t.colors.textSecondary}
              />
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.textSecondary, fontWeight: "600" },
                ]}
              >
                Settings
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  handle: { alignItems: "center", paddingVertical: 8 },
  grip: { width: 38, height: 5, borderRadius: 3 },
  header: {
    fontWeight: "700",
    letterSpacing: 0.4,
    paddingHorizontal: 4,
    paddingTop: 14,
    paddingBottom: 8,
  },
  scopeRow: { flexDirection: "row", gap: 8 },
  scopeChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: 6 },
});
