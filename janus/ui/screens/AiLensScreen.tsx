import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useTheme } from "../theme";
import { openExternal } from "../links";
import { getHfToken, setHfToken, clearHfToken } from "../../app/pangramToken";
import {
  fetchRepoInfo,
  HubError,
  PANGRAM_LICENSE,
  PANGRAM_REPO,
  PANGRAM_REPO_URL,
  validateToken,
  type HubFetch,
} from "../../app/pangramHub";
import {
  AI_AUTO_MODES,
  AI_TREATMENTS,
  AUTO_CAP_OPTIONS,
  SCAN_CAP_OPTIONS,
  getAiLensPolicy,
  setAiLensPolicy,
  type AiAutoMode,
  type AiLensPolicy,
  type AiLevelKey,
  type AiTreatment,
} from "../../app/aiLensPolicy";
import {
  getPangramState,
  installPangram,
  recoverPangramState,
  subscribePangram,
  uninstallPangram,
  type PangramState,
} from "../../app/pangramModel";
import { createPangramFs } from "../../app/pangramFs";
import { loadGraphAsset } from "../../app/pangramGraphAsset";
import { COREML_MANIFEST, importCoreMlModel } from "../../app/coremlAssets";
import { buildCoreMlPackage } from "../../app/coremlBuild";
import {
  coreMlAvailable,
  resetCoreMlFence,
  unloadCoreMlEngine,
} from "../../app/coremlEngine";
import {
  engineAvailable,
  engineBackend,
  unloadPangramEngine,
} from "../../app/pangramEngine";
import { resetAiLensService } from "../../app/aiLensService";
import { aiQueue } from "../../app/aiLensQueue";
import { benchSummary, lastBench, runAiBench } from "../../app/aiLensBench";
import {
  clearApprovalReminder,
  markAwaitingApproval,
} from "../../app/aiLensReminder";

type Props = NativeStackScreenProps<RootStackParamList, "AiLens">;

const hubFetch: HubFetch = (url, init) => fetch(url, init);

const TREATMENT_LABELS: Record<AiTreatment, string> = {
  none: "Off",
  label: "Label",
  dim: "Dim",
  collapse: "Fold",
  hide: "Hide",
};

const AUTO_LABELS: Record<AiAutoMode, string> = {
  off: "Off",
  posts: "Open post",
  threads: "Open thread",
  ahead: "Everywhere",
};

const AUTO_DESCRIPTIONS: Record<AiAutoMode, string> = {
  off: 'Nothing automatic — judge only when you tap "AI?" or run a scan.',
  posts: "Judges a post's body when you open its thread.",
  threads: "Judges the post and its top comments when you open a thread.",
  ahead:
    "Labels the feed itself: posts (and busy threads' top comments) are judged as you browse, so AI chips appear on cards BEFORE you tap. Everything is cached forever.",
};

/**
 * AI Lens setup — on-device AI-writing detection via Open Pangram.
 *
 * The checkpoint is gated and non-commercial, so the flow is honest about
 * whose model this is and who downloads it: the user accepts the license on
 * huggingface.co with their own account, pastes a read token, and the 1.4 GB
 * checkpoint lands on their device straight from the Hub. After that,
 * everything — tokenizing, inference, verdicts — happens locally; no text
 * ever leaves the phone, and it works offline (plane-mode friendly).
 */
export function AiLensScreen({ navigation }: Props) {
  const t = useTheme();
  const [state, setState] = useState<PangramState>(() => getPangramState());
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    note: string;
    frac: number;
  } | null>(null);
  const [accessNote, setAccessNote] = useState<string | null>(null);
  const [policy, setPolicyState] = useState<AiLensPolicy>(() =>
    getAiLensPolicy(),
  );
  const [bench, setBench] = useState(() => lastBench());
  const [benchRunning, setBenchRunning] = useState(false);
  const runBench = async () => {
    if (benchRunning) return;
    setBenchRunning(true);
    try {
      setBench(await runAiBench((text) => aiQueue.run(text, 0)));
    } catch (e) {
      Alert.alert(
        "Speed test failed",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBenchRunning(false);
    }
  };

  useEffect(() => subscribePangram(setState), []);
  useEffect(() => {
    // Heal a stale "downloading"/"preparing" left by a mid-install app kill,
    // so the screen never mounts permanently disabled.
    setState(recoverPangramState());
    void getHfToken().then((tok) => setTokenSaved(!!tok));
  }, []);

  const saveToken = async () => {
    const token = tokenInput.trim();
    if (!token) return;
    setBusy(true);
    try {
      const who = await validateToken(token, hubFetch);
      if (!who.ok) {
        Alert.alert(
          "Token rejected",
          "Hugging Face didn't accept that token. It needs to be a read token from huggingface.co/settings/tokens.",
        );
        return;
      }
      await setHfToken(token);
      setTokenSaved(true);
      setTokenInput("");
      setUsername(who.username ?? null);
    } catch {
      Alert.alert(
        "Couldn't reach Hugging Face",
        "Check your connection and retry.",
      );
    } finally {
      setBusy(false);
    }
  };

  const startDownload = async () => {
    const token = await getHfToken();
    if (!token) return;
    setBusy(true);
    setProgress({ note: "Starting…", frac: 0 });
    const fs = createPangramFs();
    try {
      // The transfer itself rides an OS background session (survives lock),
      // but the verify + rehydrate steps are JS work — keep the screen on
      // so the whole install lands in one visible pass.
      await activateKeepAwakeAsync("janus-ailens");
    } catch {
      /* best-effort */
    }
    const coreml = COREML_MANIFEST; // capture for closure narrowing
    try {
      await installPangram({
        token,
        fs,
        fetchImpl: hubFetch,
        loadGraph: () => loadGraphAsset(fs),
        buildCoreMl: coreml
          ? async (index, onProgress) => {
              await buildCoreMlPackage(
                fs,
                coreml,
                index,
                (dest) => importCoreMlModel(fs, dest),
                onProgress,
              );
              resetCoreMlFence(); // fresh weights — fresh chance at the ANE
              return coreml.weightBinSize;
            }
          : undefined,
        onProgress: (note, frac) => setProgress({ note, frac }),
      });
    } catch (e) {
      if (e instanceof HubError && e.gate === "gate-not-accepted")
        markAwaitingApproval();
      Alert.alert(
        e instanceof HubError ? "Access needed" : "Install failed",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      try {
        void deactivateKeepAwake("janus-ailens");
      } catch {
        /* best-effort */
      }
      setBusy(false);
      setProgress(null);
    }
  };

  // Low-stakes approval poll: the gate is approved by hand on Pangram's
  // side (days, sometimes weeks), so this answers "am I in yet?" inline
  // without the ceremony of a failed download.
  const checkAccess = async () => {
    const token = await getHfToken();
    if (!token) return;
    setBusy(true);
    setAccessNote("Checking…");
    try {
      await fetchRepoInfo(token, hubFetch);
      clearApprovalReminder();
      setAccessNote("Access granted — you're approved. Download below.");
    } catch (e) {
      if (e instanceof HubError && e.gate === "gate-not-accepted") {
        markAwaitingApproval();
        setAccessNote(
          "Still pending. Pangram reviews requests manually — this can take days, sometimes weeks. Your token is saved — Janus will keep checking and flag you in the feed when access opens.",
        );
      } else if (e instanceof HubError) setAccessNote(e.message);
      else setAccessNote("Couldn't reach Hugging Face — try again later.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete model", "Remove the AI Lens engine from this device?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            await unloadPangramEngine();
            unloadCoreMlEngine();
            await uninstallPangram(createPangramFs());
            resetAiLensService();
          })();
        },
      },
    ]);
  };

  const installed = state.phase === "ready" || state.phase === "downloaded";
  const working =
    busy || state.phase === "downloading" || state.phase === "preparing";

  const step = (n: string, title: string, body: React.ReactNode) => (
    <View style={[styles.step, { borderBottomColor: t.colors.border }]}>
      <View
        style={[styles.stepBadge, { backgroundColor: t.colors.bgElevated }]}
      >
        <Text
          style={[t.type.small, { color: t.colors.accent, fontWeight: "700" }]}
        >
          {n}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[t.type.body, { color: t.colors.text, fontWeight: "600" }]}
        >
          {title}
        </Text>
        {body}
      </View>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.fill, { backgroundColor: t.colors.bg }]}
      edges={["top"]}
    >
      <View style={[styles.topBar, { paddingHorizontal: t.spacing.lg }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color={t.colors.accent} />
        </Pressable>
        <Text
          style={[
            t.type.title,
            { color: t.colors.text, flex: 1, marginLeft: 8 },
          ]}
        >
          AI Lens
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View style={[styles.intro, { backgroundColor: t.colors.bgElevated }]}>
          <Ionicons name="scan-outline" size={18} color={t.colors.accent} />
          <Text
            style={[
              t.type.small,
              { color: t.colors.textSecondary, marginLeft: 10, flex: 1 },
            ]}
          >
            Ask "was this written by AI?" about any post or comment — judged
            entirely on this device by Open Pangram (EditLens, roberta-large).
            Nothing you check ever leaves your phone, and it works offline.
            English text only; verdicts are probabilistic, not proof.
          </Text>
        </View>

        {state.phase === "ready" ? (
          <View style={[styles.statusCard, { borderColor: t.colors.border }]}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={t.colors.accent}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.text, fontWeight: "600" },
                ]}
              >
                Ready
                {engineAvailable() ? "" : " — engine missing in this build"}
              </Text>
              <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                {state.numLabels} levels · rev {state.sha?.slice(0, 7)} ·{" "}
                {Math.round(
                  ((state.dataBytes ?? state.weightsBytes ?? 0) +
                    (state.coremlBytes ?? 0)) /
                    1e6,
                )}{" "}
                MB on disk
              </Text>
              <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                {bench
                  ? benchSummary(bench)
                  : engineBackend()
                    ? `running on ${engineBackend()}`
                    : "speed untested this session"}
              </Text>
              {COREML_MANIFEST &&
              coreMlAvailable() &&
              state.coremlBytes !== COREML_MANIFEST.weightBinSize ? (
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.textSecondary, marginTop: 4 },
                  ]}
                >
                  This build added a Neural Engine model (~10× faster).
                  Re-download the model to build it — your token is saved.
                </Text>
              ) : null}
              <Pressable
                onPress={() => void runBench()}
                disabled={benchRunning}
                accessibilityRole="button"
                accessibilityLabel="Run an AI Lens speed test"
                style={[styles.inlineBtn, { borderColor: t.colors.border }]}
              >
                <Ionicons
                  name="speedometer-outline"
                  size={14}
                  color={t.colors.accent}
                />
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.accent, marginLeft: 6 },
                  ]}
                >
                  {benchRunning ? "Timing two checks…" : "Run speed test"}
                </Text>
              </Pressable>
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.textSecondary, marginTop: 4 },
                ]}
              >
                Tap "AI?" under any comment or post body, use the scan pill in a
                thread's comment bar to judge the top comments in one go, or
                turn on the AI Lens scan in Plane Mode to land with chips
                already on.
              </Text>
            </View>
          </View>
        ) : null}
        {state.phase === "downloaded" ? (
          <View style={[styles.statusCard, { borderColor: t.colors.border }]}>
            <Ionicons
              name="cube-outline"
              size={18}
              color={t.colors.textSecondary}
            />
            <Text
              style={[
                t.type.small,
                { color: t.colors.textSecondary, marginLeft: 10, flex: 1 },
              ]}
            >
              Checkpoint downloaded and verified, but this build doesn't bundle
              the inference graph yet — a future build will finish setup without
              re-downloading.
            </Text>
          </View>
        ) : null}
        {state.phase === "error" && state.error ? (
          <View style={[styles.statusCard, { borderColor: t.colors.border }]}>
            <Ionicons
              name="warning-outline"
              size={18}
              color={t.colors.reddit}
            />
            <Text
              style={[
                t.type.small,
                { color: t.colors.reddit, marginLeft: 10, flex: 1 },
              ]}
            >
              {state.error}
            </Text>
          </View>
        ) : null}

        {installed ? (
          <>
            <Text
              style={[
                t.type.small,
                {
                  color: t.colors.textTertiary,
                  marginHorizontal: 16,
                  marginTop: 14,
                  fontWeight: "700",
                },
              ]}
            >
              WHAT A VERDICT DOES
            </Text>
            <Text
              style={[
                t.type.small,
                {
                  color: t.colors.textSecondary,
                  marginHorizontal: 16,
                  marginTop: 4,
                  marginBottom: 4,
                },
              ]}
            >
              The detector only labels — you decide what each level does to a
              comment: a quiet chip, a faded body, a folded stub, or hidden
              behind a hairline. Anything folded or hidden stays one tap from
              visible, and uncertain verdicts never escalate past a label.
            </Text>
            {(
              [
                ["Fully AI-generated", "full"],
                ["Moderately AI-assisted", "moderate"],
                ["Lightly AI-assisted", "light"],
              ] as [string, AiLevelKey][]
            ).map(([title, key]) => (
              <View
                key={key}
                style={[styles.step, { borderBottomColor: t.colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[t.type.body, { color: t.colors.text }]}>
                    {title}
                  </Text>
                  <View style={styles.chipRow}>
                    {AI_TREATMENTS.map((tr: AiTreatment) => (
                      <Pressable
                        key={tr}
                        onPress={() =>
                          setPolicyState(setAiLensPolicy({ [key]: tr }))
                        }
                        accessibilityRole="button"
                        accessibilityState={{ selected: policy[key] === tr }}
                        accessibilityLabel={`${title}: ${TREATMENT_LABELS[tr]}`}
                        style={[
                          styles.chip,
                          {
                            backgroundColor:
                              policy[key] === tr
                                ? t.colors.accent
                                : t.colors.bgElevated,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            t.type.small,
                            {
                              color:
                                policy[key] === tr
                                  ? t.colors.bg
                                  : t.colors.textSecondary,
                              fontWeight: "700",
                            },
                          ]}
                        >
                          {TREATMENT_LABELS[tr]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            ))}

            <Text
              style={[
                t.type.small,
                {
                  color: t.colors.textTertiary,
                  marginHorizontal: 16,
                  marginTop: 14,
                  fontWeight: "700",
                },
              ]}
            >
              AUTOMATIC CHECKS
            </Text>
            <Text
              style={[
                t.type.small,
                {
                  color: t.colors.textSecondary,
                  marginHorizontal: 16,
                  marginTop: 4,
                  marginBottom: 4,
                },
              ]}
            >
              Judge content as you read, without tapping: the post body when you
              open a thread, or that plus an automatic comment scan. Everything
              runs on-device and is cached forever — fast on recent phones, but
              it does spend battery; leave it off on older hardware.
            </Text>
            <View style={[styles.step, { borderBottomColor: t.colors.border }]}>
              <View style={{ flex: 1 }}>
                <View style={[styles.chipRow, { marginTop: 0 }]}>
                  {AI_AUTO_MODES.map((mode: AiAutoMode) => (
                    <Pressable
                      key={mode}
                      onPress={() =>
                        setPolicyState(setAiLensPolicy({ auto: mode }))
                      }
                      accessibilityRole="button"
                      accessibilityState={{ selected: policy.auto === mode }}
                      accessibilityLabel={`Automatic checks: ${AUTO_LABELS[mode]}`}
                      style={[
                        styles.chip,
                        {
                          backgroundColor:
                            policy.auto === mode
                              ? t.colors.accent
                              : t.colors.bgElevated,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          t.type.small,
                          {
                            color:
                              policy.auto === mode
                                ? t.colors.bg
                                : t.colors.textSecondary,
                            fontWeight: "700",
                          },
                        ]}
                      >
                        {AUTO_LABELS[mode]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.textSecondary, marginTop: 8 },
                  ]}
                >
                  {AUTO_DESCRIPTIONS[policy.auto]}
                </Text>
              </View>
            </View>

            {(
              [
                [
                  "Working indicator",
                  "Feed cards show \u201cjudging\u2026\u201d while their check is queued — so you can tell AI Lens is on the job.",
                  "showActivity",
                ],
                [
                  "Flag humans too",
                  "Judged-human content gets a quiet green chip, so a clean card means \u201cnot judged yet\u201d, never \u201csecretly fine\u201d.",
                  "showHuman",
                ],
              ] as [string, string, "showActivity" | "showHuman"][]
            ).map(([title, detail, key]) => (
              <View
                key={key}
                style={[styles.step, { borderBottomColor: t.colors.border }]}
              >
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={[t.type.body, { color: t.colors.text }]}>
                    {title}
                  </Text>
                  <Text
                    style={[
                      t.type.small,
                      { color: t.colors.textTertiary, marginTop: 2 },
                    ]}
                  >
                    {detail}
                  </Text>
                </View>
                <Switch
                  value={policy[key]}
                  onValueChange={(v) =>
                    setPolicyState(setAiLensPolicy({ [key]: v }))
                  }
                  trackColor={{ true: t.colors.accent }}
                  accessibilityLabel={title}
                />
              </View>
            ))}

            <Text
              style={[
                t.type.small,
                {
                  color: t.colors.textTertiary,
                  marginHorizontal: 16,
                  marginTop: 14,
                  fontWeight: "700",
                },
              ]}
            >
              SCAN DEPTH
            </Text>
            {(
              [
                ["Scan pill (per tap)", "scanCap", SCAN_CAP_OPTIONS],
                ["Automatic (per visit)", "autoCap", AUTO_CAP_OPTIONS],
              ] as [string, "scanCap" | "autoCap", number[]][]
            ).map(([title, key, options]) => (
              <View
                key={key}
                style={[styles.step, { borderBottomColor: t.colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[t.type.body, { color: t.colors.text }]}>
                    {title}
                  </Text>
                  <View style={styles.chipRow}>
                    {options.map((n) => (
                      <Pressable
                        key={n}
                        onPress={() =>
                          setPolicyState(setAiLensPolicy({ [key]: n }))
                        }
                        accessibilityRole="button"
                        accessibilityState={{ selected: policy[key] === n }}
                        accessibilityLabel={`${title}: ${n} comments`}
                        style={[
                          styles.chip,
                          {
                            backgroundColor:
                              policy[key] === n
                                ? t.colors.accent
                                : t.colors.bgElevated,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            t.type.small,
                            {
                              color:
                                policy[key] === n
                                  ? t.colors.bg
                                  : t.colors.textSecondary,
                              fontWeight: "700",
                            },
                          ]}
                        >
                          {n}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            ))}
          </>
        ) : null}

        {!installed ? (
          <>
            {step(
              "1",
              "Accept the license on Hugging Face",
              <>
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.textTertiary, marginTop: 2 },
                  ]}
                >
                  {PANGRAM_REPO} is gated: sign in with your own HF account and
                  agree to the {PANGRAM_LICENSE} terms. Heads up — Pangram
                  approves requests by hand, and it can take days, sometimes
                  weeks. Save your token below now; everything here will be
                  waiting when access opens.
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  <Pressable
                    onPress={() => void openExternal(PANGRAM_REPO_URL)}
                    accessibilityRole="button"
                    accessibilityLabel="Open the model page"
                    style={[styles.inlineBtn, { borderColor: t.colors.border }]}
                  >
                    <Ionicons
                      name="open-outline"
                      size={14}
                      color={t.colors.accent}
                    />
                    <Text
                      style={[
                        t.type.small,
                        { color: t.colors.accent, marginLeft: 6 },
                      ]}
                    >
                      Open model page
                    </Text>
                  </Pressable>
                  {tokenSaved ? (
                    <Pressable
                      onPress={() => void checkAccess()}
                      disabled={working}
                      accessibilityRole="button"
                      accessibilityLabel="Check whether your access request was approved"
                      style={[
                        styles.inlineBtn,
                        { borderColor: t.colors.border, marginLeft: 8 },
                      ]}
                    >
                      <Ionicons
                        name="refresh-outline"
                        size={14}
                        color={t.colors.accent}
                      />
                      <Text
                        style={[
                          t.type.small,
                          { color: t.colors.accent, marginLeft: 6 },
                        ]}
                      >
                        Check approval status
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {accessNote ? (
                  <Text
                    style={[
                      t.type.small,
                      {
                        color: accessNote.startsWith("Access granted")
                          ? t.colors.accent
                          : t.colors.textSecondary,
                        marginTop: 8,
                      },
                    ]}
                  >
                    {accessNote}
                  </Text>
                ) : null}
              </>,
            )}
            {step(
              "2",
              tokenSaved
                ? `Token saved${username ? ` (${username})` : ""}`
                : "Paste a read token",
              <>
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.textTertiary, marginTop: 2 },
                  ]}
                >
                  From huggingface.co → Settings → Access Tokens. Stored in the
                  keychain, used only to download this model.
                </Text>
                <View style={styles.tokenRow}>
                  <TextInput
                    value={tokenInput}
                    onChangeText={setTokenInput}
                    placeholder={tokenSaved ? "Replace token…" : "hf_…"}
                    placeholderTextColor={t.colors.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    accessibilityLabel="Hugging Face read token"
                    style={[
                      styles.tokenInput,
                      {
                        color: t.colors.text,
                        borderColor: t.colors.border,
                        backgroundColor: t.colors.bgElevated,
                      },
                    ]}
                  />
                  <Pressable
                    onPress={() => void saveToken()}
                    disabled={working || !tokenInput.trim()}
                    accessibilityRole="button"
                    accessibilityLabel="Save token"
                    style={[
                      styles.saveBtn,
                      {
                        backgroundColor: tokenInput.trim()
                          ? t.colors.accent
                          : t.colors.bgElevated,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        t.type.small,
                        {
                          color: tokenInput.trim()
                            ? t.colors.bg
                            : t.colors.textTertiary,
                          fontWeight: "700",
                        },
                      ]}
                    >
                      Save
                    </Text>
                  </Pressable>
                </View>
              </>,
            )}
            {step(
              "3",
              "Download the model",
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.textTertiary, marginTop: 2 },
                ]}
              >
                ~1.4 GB download, straight from the Hub — Wi-Fi strongly
                recommended. The transfer rides an iOS background session, and
                the screen stays awake while Janus builds its int8 engine and
                deletes the download. Briefly needs ~2 GB free; settles at ~510
                MB.
              </Text>,
            )}

            {working && progress ? (
              <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
                <View
                  style={[
                    styles.progressTrack,
                    { backgroundColor: t.colors.border },
                  ]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: t.colors.accent,
                        width: `${Math.round(progress.frac * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.textTertiary, marginTop: 6 },
                  ]}
                  numberOfLines={1}
                >
                  {progress.note}
                </Text>
              </View>
            ) : null}

            <Pressable
              onPress={() => void startDownload()}
              disabled={working || !tokenSaved}
              accessibilityRole="button"
              accessibilityLabel="Download and install the model"
              style={[
                styles.bigBtn,
                {
                  backgroundColor:
                    working || !tokenSaved
                      ? t.colors.bgElevated
                      : t.colors.accent,
                },
              ]}
            >
              <Ionicons
                name="cloud-download-outline"
                size={16}
                color={
                  working || !tokenSaved ? t.colors.textTertiary : t.colors.bg
                }
              />
              <Text
                style={[
                  t.type.body,
                  {
                    color:
                      working || !tokenSaved
                        ? t.colors.textTertiary
                        : t.colors.bg,
                    fontWeight: "700",
                    marginLeft: 8,
                  },
                ]}
              >
                {working ? "Installing…" : "Download model (1.4 GB)"}
              </Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={confirmDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete the model"
            style={[styles.bigBtn, { backgroundColor: t.colors.bgElevated }]}
          >
            <Ionicons name="trash-outline" size={16} color={t.colors.reddit} />
            <Text
              style={[
                t.type.body,
                { color: t.colors.reddit, fontWeight: "700", marginLeft: 8 },
              ]}
            >
              Delete model from device
            </Text>
          </Pressable>
        )}

        {installed ? (
          <Pressable
            onPress={() => {
              void (async () => {
                await clearHfToken();
                setTokenSaved(false);
                setUsername(null);
              })();
            }}
            accessibilityRole="button"
            accessibilityLabel="Forget the Hugging Face token"
            style={{ alignSelf: "center", marginTop: 4, padding: 8 }}
          >
            <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
              {tokenSaved ? "Forget HF token (no longer needed)" : ""}
            </Text>
          </Pressable>
        ) : null}

        <View style={{ margin: 16, marginTop: 20 }}>
          <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
            Detection is Open Pangram — research by Pangram Labs (the EditLens
            paper, ICLR 2026), released under {PANGRAM_LICENSE} for personal,
            non-commercial use. Janus adapts the model on your device (int8
            quantization and float16 conversion for the Neural Engine); the
            weights themselves come only from Pangram, via your own download. AI
            detectors make mistakes; treat a verdict as a signal, never as an
            accusation.
          </Text>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}
          >
            {(
              [
                ["Pangram Labs", "https://www.pangram.com"],
                ["EditLens paper", "https://arxiv.org/abs/2510.03154"],
                ["Model weights", PANGRAM_REPO_URL],
                [
                  "CC BY-NC-SA 4.0",
                  "https://creativecommons.org/licenses/by-nc-sa/4.0/",
                ],
              ] as [string, string][]
            ).map(([label, url]) => (
              <Pressable
                key={label}
                onPress={() => void openExternal(url)}
                accessibilityRole="link"
                accessibilityLabel={label}
                hitSlop={6}
                style={{ marginRight: 14, marginTop: 2 }}
              >
                <Text style={[t.type.small, { color: t.colors.accent }]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  intro: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 10,
    padding: 12,
    borderRadius: 10,
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    marginTop: 1,
  },
  inlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  tokenRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  tokenInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  saveBtn: {
    marginLeft: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  bigBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 13,
  },
});
