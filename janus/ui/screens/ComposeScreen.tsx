import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useTheme } from "../theme";
import { CommunityPicker } from "../components/CommunityPicker";
import { isHttpUrl } from "../links";
import type { Community } from "../../core/model";
import type { SubmitKind } from "../../core/adapter";

type Props = NativeStackScreenProps<RootStackParamList, "Compose">;

export function ComposeScreen({ route, navigation }: Props) {
  const t = useTheme();
  const { adapters, feedScope } = useAdapters();

  const [community, setCommunity] = useState<Community | null>(
    route.params?.presetCommunity ?? null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [kind, setKind] = useState<SubmitKind>("self");
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [url, setUrl] = useState("");
  const [nsfw, setNsfw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const linkValid = kind !== "link" || isHttpUrl(url.trim());
  const canSubmit =
    !!community && title.trim().length > 0 && linkValid && !submitting;

  const submit = async () => {
    if (!community || !canSubmit) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const post = await adapters[community.source].submitPost({
        communityId: community.id,
        title: title.trim(),
        kind,
        markdown: kind === "self" ? bodyText : undefined,
        url: kind === "link" ? url.trim() : undefined,
        nsfw,
      });
      navigation.replace("Post", { post });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't post — please try again.",
      );
      setSubmitting(false);
    }
  };

  const input = {
    color: t.colors.text,
    backgroundColor: t.colors.bgElevated,
    borderColor: t.colors.border,
    borderRadius: t.radius.md,
  };

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: t.colors.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {/* Community selector */}
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            community
              ? `Posting to ${community.handle}. Change community.`
              : "Choose a community to post to"
          }
          style={[
            styles.communityBtn,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.md,
            },
          ]}
        >
          <Ionicons
            name={
              community
                ? community.source === "reddit"
                  ? "logo-reddit"
                  : "planet"
                : "people-outline"
            }
            size={18}
            color={
              community
                ? community.source === "reddit"
                  ? t.colors.reddit
                  : t.colors.lemmy
                : t.colors.textTertiary
            }
          />
          <Text
            style={[
              t.type.body,
              {
                color: community ? t.colors.text : t.colors.textTertiary,
                marginLeft: 10,
                flex: 1,
                fontWeight: "600",
              },
            ]}
            numberOfLines={1}
          >
            {community ? community.handle : "Choose a community"}
          </Text>
          <Ionicons
            name="chevron-down"
            size={16}
            color={t.colors.textTertiary}
          />
        </Pressable>

        {/* Self / Link toggle */}
        <View
          style={[
            styles.segment,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.md,
            },
          ]}
        >
          {(["self", "link"] as const).map((k) => {
            const active = kind === k;
            return (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={k === "self" ? "Text post" : "Link post"}
                style={[
                  styles.segmentItem,
                  { borderRadius: t.radius.sm },
                  active && { backgroundColor: t.colors.accentActive },
                ]}
              >
                <Ionicons
                  name={k === "self" ? "document-text-outline" : "link-outline"}
                  size={15}
                  color={active ? "#fff" : t.colors.textSecondary}
                />
                <Text
                  style={[
                    t.type.meta,
                    {
                      color: active ? "#fff" : t.colors.textSecondary,
                      marginLeft: 6,
                    },
                  ]}
                >
                  {k === "self" ? "Text" : "Link"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          placeholderTextColor={t.colors.textTertiary}
          style={[t.type.body, styles.input, input, { fontWeight: "600" }]}
          accessibilityLabel="Post title"
          multiline
          editable={!submitting}
        />

        {kind === "self" ? (
          <TextInput
            value={bodyText}
            onChangeText={setBodyText}
            placeholder="Body (optional, Markdown supported)"
            placeholderTextColor={t.colors.textTertiary}
            style={[t.type.body, styles.input, styles.bodyInput, input]}
            accessibilityLabel="Post body"
            multiline
            editable={!submitting}
          />
        ) : (
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://…"
            placeholderTextColor={t.colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[t.type.body, styles.input, input]}
            accessibilityLabel="Link URL"
            editable={!submitting}
          />
        )}
        {kind === "link" && url.trim().length > 0 && !linkValid ? (
          <Text
            style={[t.type.small, { color: t.colors.danger, marginTop: 6 }]}
          >
            Enter a valid http(s) URL.
          </Text>
        ) : null}

        <View style={styles.nsfwRow}>
          <Text style={[t.type.body, { color: t.colors.text }]}>
            Mark as NSFW
          </Text>
          <Switch
            value={nsfw}
            onValueChange={setNsfw}
            accessibilityLabel="Mark as NSFW"
          />
        </View>

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
          accessibilityLabel="Submit post"
          accessibilityState={{ disabled: !canSubmit }}
          style={[
            styles.submit,
            {
              borderRadius: t.radius.md,
              backgroundColor: canSubmit
                ? t.colors.accentActive
                : t.colors.border,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text
              style={[
                t.type.title,
                { color: canSubmit ? "#fff" : t.colors.textTertiary },
              ]}
            >
              Post
            </Text>
          )}
        </Pressable>
      </ScrollView>

      {pickerOpen ? (
        <CommunityPicker
          adapters={adapters}
          scope={feedScope}
          current={community}
          onSelect={(sel) => {
            if (sel && sel !== "subscribed") setCommunity(sel);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { padding: 16 },
  communityBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
  },
  segment: {
    flexDirection: "row",
    marginTop: 12,
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    minHeight: 48,
  },
  bodyInput: { minHeight: 140, textAlignVertical: "top" },
  nsfwRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  errorRow: { flexDirection: "row", alignItems: "center", marginTop: 14 },
  submit: {
    marginTop: 20,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
});
