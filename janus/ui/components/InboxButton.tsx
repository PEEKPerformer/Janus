import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useAdapters } from "../AdapterContext";
import { useAsync } from "../hooks";
import type { RootStackParamList } from "../types";

/**
 * Header bell with an unread badge. Sums unread counts across signed-in sources;
 * hidden entirely when browsing anonymously. Refetches after login (accountVersion).
 */
export function InboxButton() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { manager, accountVersion } = useAdapters();

  // Sum unread across EVERY signed-in account (Reddit + each Lemmy instance).
  const signedIn = manager.signedInAdapters();
  const { data: unread } = useAsync<number>(async () => {
    if (signedIn.length === 0) return 0;
    const counts = await Promise.all(
      signedIn.map((a) => a.getUnreadCount().catch(() => 0)),
    );
    return counts.reduce((a, b) => a + b, 0);
  }, [accountVersion]);

  if (signedIn.length === 0) return null;
  const count = unread ?? 0;

  return (
    <Pressable
      onPress={() => navigation.navigate("Inbox")}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Inbox, ${count} unread` : "Inbox"}
      style={styles.wrap}
    >
      <Ionicons name="notifications-outline" size={22} color={t.colors.text} />
      {count > 0 ? (
        <View style={[styles.badge, { backgroundColor: t.colors.accent }]}>
          <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginRight: 14, padding: 2 },
  badge: {
    position: "absolute",
    top: -3,
    right: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
