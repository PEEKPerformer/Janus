import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import type { SourceAdapter, AccountRef } from "../../core/adapter";
import { useTheme } from "../theme";

/**
 * Lemmy login is a plain credentials flow (unlike Reddit's WebView): the user
 * enters their username/email + password (+ a 2FA code if their account has it)
 * and we POST to the instance's /user/login for a JWT. This is the same shape
 * Voyager uses. The password never leaves the device except to the user's own
 * chosen instance.
 */
export function LemmyLoginModal({
  adapter,
  onSuccess,
  onClose,
}: {
  adapter: SourceAdapter;
  onSuccess: (account: AccountRef, jwt: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [showTotp, setShowTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const canSubmit =
    identifier.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      const { account, secret } = await adapter.completeLogin({
        mode: "credentials",
        usernameOrEmail: identifier,
        password,
        totp: totp.trim() || undefined,
      });
      if (secret.source !== "lemmy")
        throw new Error("Unexpected login result.");
      onSuccess(account, secret.jwt);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Login failed. Please try again.";
      // A 2FA prompt is a normal first-attempt outcome — reveal the field.
      if (/2fa|totp/i.test(msg)) setShowTotp(true);
      setError(msg);
      setBusy(false);
    }
  };

  const inputStyle = [
    styles.input,
    t.type.body,
    {
      color: t.colors.text,
      backgroundColor: t.colors.bgElevated,
      borderColor: t.colors.border,
      borderRadius: t.radius.md,
    },
  ];

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: t.colors.bg, zIndex: 100 },
      ]}
    >
      <SafeAreaView style={styles.fill}>
        <View style={[styles.bar, { borderBottomColor: t.colors.border }]}>
          <Text style={[t.type.title, { color: t.colors.text }]}>
            Log in to Lemmy
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Cancel login"
          >
            <Ionicons name="close" size={24} color={t.colors.text} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={[
                styles.instanceRow,
                {
                  backgroundColor: t.colors.bgElevated,
                  borderRadius: t.radius.md,
                  borderColor: t.colors.border,
                },
              ]}
            >
              <Ionicons
                name="server-outline"
                size={16}
                color={t.colors.lemmy}
              />
              <Text
                style={[
                  t.type.meta,
                  { color: t.colors.textSecondary, marginLeft: 8 },
                ]}
              >
                {adapter.instance}
              </Text>
            </View>

            <Text
              style={[
                t.type.meta,
                { color: t.colors.textSecondary, marginBottom: 6 },
              ]}
            >
              Username or email
            </Text>
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
              placeholder="yourname"
              placeholderTextColor={t.colors.textTertiary}
              style={inputStyle}
              accessibilityLabel="Username or email"
              editable={!busy}
            />

            <Text
              style={[
                t.type.meta,
                {
                  color: t.colors.textSecondary,
                  marginTop: 16,
                  marginBottom: 6,
                },
              ]}
            >
              Password
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              textContentType="password"
              returnKeyType={showTotp ? "next" : "go"}
              onSubmitEditing={showTotp ? undefined : submit}
              placeholder="••••••••"
              placeholderTextColor={t.colors.textTertiary}
              style={inputStyle}
              accessibilityLabel="Password"
              editable={!busy}
            />

            {showTotp ? (
              <>
                <Text
                  style={[
                    t.type.meta,
                    {
                      color: t.colors.textSecondary,
                      marginTop: 16,
                      marginBottom: 6,
                    },
                  ]}
                >
                  Two-factor code
                </Text>
                <TextInput
                  value={totp}
                  onChangeText={setTotp}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  placeholder="123456"
                  placeholderTextColor={t.colors.textTertiary}
                  style={inputStyle}
                  accessibilityLabel="Two-factor code"
                  editable={!busy}
                />
              </>
            ) : null}

            {error ? (
              <View style={styles.errorRow}>
                <Ionicons
                  name="alert-circle-outline"
                  size={16}
                  color={t.colors.danger}
                />
                <Text
                  style={[
                    t.type.meta,
                    { color: t.colors.danger, marginLeft: 6, flex: 1 },
                  ]}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Log in"
              accessibilityState={{ disabled: !canSubmit }}
              style={[
                styles.submit,
                {
                  borderRadius: t.radius.md,
                  backgroundColor: canSubmit
                    ? t.colors.lemmyActive
                    : t.colors.border,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text
                  style={[
                    t.type.title,
                    { color: canSubmit ? "#fff" : t.colors.textTertiary },
                  ]}
                >
                  Log in
                </Text>
              )}
            </Pressable>

            <Text
              style={[
                t.type.meta,
                {
                  color: t.colors.textTertiary,
                  textAlign: "center",
                  marginTop: 16,
                },
              ]}
            >
              Your password is sent only to {adapter.instance}.
            </Text>
          </ScrollView>
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
  body: { padding: 20 },
  instanceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 46,
  },
  errorRow: { flexDirection: "row", alignItems: "center", marginTop: 16 },
  submit: {
    marginTop: 24,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
});
