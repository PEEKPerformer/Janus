import React, { useEffect, useRef, useState } from "react";
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
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useTheme } from "../theme";
import { CommunityPicker } from "../components/CommunityPicker";
import { MarkdownInput } from "../components/MarkdownInput";
import { popularEmojiFor } from "../emojiPopular";
import { isHttpUrl } from "../links";
import { getPostDraft, savePostDraft, clearPostDraft } from "../../app/drafts";
import { bumpUsage } from "../../app/usageStats";
import type { Community, CustomEmoji, PostFlairChoice } from "../../core/model";
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [emojis, setEmojis] = useState<CustomEmoji[]>([]);
  const [flairs, setFlairs] = useState<PostFlairChoice[]>([]);
  const [flairId, setFlairId] = useState<string>();
  const [draftRestored, setDraftRestored] = useState(false);

  // Restore a saved draft once on mount, then auto-save as you type. Keeps a
  // half-written post alive across an accidental dismiss or navigating away.
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    void getPostDraft().then((d) => {
      if (!d) return;
      if (d.title) setTitle(d.title);
      if (d.body) setBodyText(d.body);
      if (d.title || d.body) setDraftRestored(true);
    });
  }, []);
  useEffect(() => {
    const id = setTimeout(() => {
      void savePostDraft({
        communityId: community?.id,
        title,
        body: bodyText,
        ts: Date.now(),
      });
    }, 600);
    return () => clearTimeout(id);
  }, [title, bodyText, community?.id]);

  // Load the selected community's post flairs (Reddit link flair). Reset the
  // choice whenever the community changes.
  useEffect(() => {
    let alive = true;
    setFlairId(undefined);
    const adapter = community ? adapters[community.source] : null;
    if (community && adapter?.getPostFlairs) {
      adapter
        .getPostFlairs(community.id)
        .then((f) => alive && setFlairs(f))
        .catch(() => alive && setFlairs([]));
    } else {
      setFlairs([]);
    }
    return () => {
      alive = false;
    };
  }, [community, adapters]);

  // Load the selected community's custom emoji so the body editor can offer them.
  useEffect(() => {
    let alive = true;
    const adapter = community ? adapters[community.source] : null;
    if (adapter?.getCustomEmojis) {
      adapter
        .getCustomEmojis()
        .then((e) => alive && setEmojis(e))
        .catch(() => alive && setEmojis([]));
    } else {
      setEmojis([]);
    }
    return () => {
      alive = false;
    };
  }, [community, adapters]);

  // Pick an image from the library and upload it (pict-rs on Lemmy, Reddit's
  // media-lease + S3 flow on Reddit), then mark the post as an image post.
  const attachImage = async () => {
    if (!community) {
      setError("Choose a community first.");
      return;
    }
    if (!adapters[community.source].capabilities.supportsImageUpload) {
      setError("Image upload isn't supported here.");
      return;
    }
    try {
      const ImagePicker = await import("expo-image-picker");
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Photo library access is needed to attach an image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      setError(undefined);
      const { url: uploaded } = await adapters[community.source].uploadImage({
        uri: asset.uri,
        name: asset.fileName ?? "image.jpg",
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      setKind("image");
      setUrl(uploaded);
    } catch {
      setError("Image upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  };

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
        url: kind === "link" || kind === "image" ? url.trim() : undefined,
        nsfw,
        flairId,
      });
      void clearPostDraft();
      void bumpUsage("postsCreated", Date.now());
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

        {/* Flair picker (Reddit link flair) — tap to select, tap again to clear */}
        {flairs.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.flairRow}
            keyboardShouldPersistTaps="handled"
          >
            {flairs.map((f) => {
              const active = f.id === flairId;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setFlairId(active ? undefined : f.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Flair: ${f.text}`}
                  style={[
                    styles.flairPill,
                    {
                      borderRadius: t.radius.pill,
                      borderColor: active
                        ? t.colors.accentActive
                        : t.colors.border,
                      backgroundColor: active
                        ? t.colors.accentActive
                        : f.backgroundColor || t.colors.bgElevated,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.type.small,
                      {
                        fontWeight: "600",
                        color: active
                          ? "#fff"
                          : f.textColor || t.colors.textSecondary,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {f.text}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

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

        <Pressable
          onPress={attachImage}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel="Attach image"
          style={[
            styles.attach,
            { borderColor: t.colors.border, borderRadius: t.radius.md },
          ]}
        >
          {uploading ? (
            <ActivityIndicator color={t.colors.accent} />
          ) : (
            <>
              <Ionicons
                name="image-outline"
                size={16}
                color={t.colors.accent}
              />
              <Text
                style={[
                  t.type.meta,
                  { color: t.colors.accent, marginLeft: 8, fontWeight: "600" },
                ]}
              >
                Attach image
              </Text>
            </>
          )}
        </Pressable>

        {draftRestored ? (
          <View
            style={[
              styles.draftBanner,
              {
                backgroundColor: t.colors.bgElevated,
                borderColor: t.colors.border,
                borderRadius: t.radius.md,
              },
            ]}
          >
            <Ionicons
              name="document-text-outline"
              size={15}
              color={t.colors.textSecondary}
            />
            <Text
              style={[
                t.type.small,
                { color: t.colors.textSecondary, marginLeft: 8, flex: 1 },
              ]}
            >
              Restored your draft
            </Text>
            <Pressable
              onPress={() => {
                setTitle("");
                setBodyText("");
                setDraftRestored(false);
                void clearPostDraft();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Discard draft"
            >
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.danger, fontWeight: "600" },
                ]}
              >
                Discard
              </Text>
            </Pressable>
          </View>
        ) : null}

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
          <View style={{ marginTop: 12 }}>
            <MarkdownInput
              value={bodyText}
              onChangeValue={setBodyText}
              placeholder="Body (optional, Markdown supported)"
              accessibilityLabel="Post body"
              source={community?.source}
              customEmojis={emojis}
              popularEmoji={
                community
                  ? popularEmojiFor(adapters[community.source].instance)
                  : []
              }
              emojiInstance={
                community ? adapters[community.source].instance : undefined
              }
              minHeight={140}
              editable={!submitting}
              inputStyle={[styles.bodyInput, input]}
            />
          </View>
        ) : kind === "image" ? (
          <View style={{ marginTop: 12 }}>
            <Image
              source={{ uri: url }}
              style={[styles.imagePreview, { borderRadius: t.radius.md }]}
              contentFit="cover"
              accessibilityLabel="Attached image preview"
            />
            <Pressable
              onPress={() => {
                setUrl("");
                setKind("self");
              }}
              accessibilityRole="button"
              accessibilityLabel="Remove image"
              style={[
                styles.removeImage,
                { backgroundColor: t.colors.bgElevated },
              ]}
            >
              <Ionicons name="close" size={16} color={t.colors.text} />
            </Pressable>
          </View>
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
  draftBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  flairRow: { gap: 8, paddingVertical: 12, paddingRight: 4 },
  flairPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
  },
  attach: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
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
  imagePreview: { width: "100%", aspectRatio: 1.4 },
  removeImage: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
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
