import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { Image } from "expo-image";

import { useAdapters, type AdapterMap } from "./AdapterContext";
import { useSettings } from "./SettingsContext";
import type { SourceAdapter } from "../core/adapter";
import type { SourceKind } from "../core/ids";
import type { JanusSettings } from "../app/settingsStore";
import { isOffline } from "../app/offline";
import { getPackPrefs } from "../app/packPrefs";
import { getPackManifest } from "../app/offlinePack";
import { runPack, buildPackScope } from "../app/packer";
import { shouldAutoRefresh } from "../app/packAutoRefresh";
import {
  beginPacking,
  endPacking,
  reportPackProgress,
  isPackingNow,
} from "../app/packLock";
import { resolveCommentSort } from "../app/commentSortResolve";
import { aiLensStatus, checkTextWithAiLens } from "../app/aiLensService";

// How often we re-check staleness while you're using the app. The 6h staleness
// gate means almost every check is a cheap no-op (read a timestamp, compare) —
// in practice this packs about once per 6h of active use, plus on each return
// to the foreground.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
// Let launch settle (don't fight the first feed load) before the first check.
const INITIAL_DELAY_MS = 45 * 1000;

export interface AutoPackDeps {
  adapters: AdapterMap;
  adapterForEntity: (e: {
    source: SourceKind;
    instance: string;
  }) => SourceAdapter;
  settings: JanusSettings;
  /** Defaults to "stop if the app leaves the foreground". */
  shouldStop?: () => boolean;
}

/**
 * Run an AUTOMATIC pack refresh — the shared path for both triggers that aren't
 * the manual button (the on-open staleness check and the while-you-browse
 * timer). Always claims the slot as "background" so the UI shows the quiet
 * banner, never the full takeover (that's reserved for a pack the user
 * explicitly asked for). No-ops unless the user opted in, the pack is stale, the
 * device is online, and nothing else is packing.
 */
export async function maybeAutoPack(deps: AutoPackDeps): Promise<void> {
  if (isOffline()) return;
  if (
    !shouldAutoRefresh({
      mode: getPackPrefs().autoRefresh,
      manifest: getPackManifest(),
      now: Date.now(),
      online: true,
      packing: isPackingNow(),
    })
  )
    return;
  if (!beginPacking("background")) return;
  try {
    const aiReady = aiLensStatus() === "ready";
    const prefs = getPackPrefs();
    await runPack(buildPackScope(prefs, aiReady), {
      reddit: deps.adapters.reddit,
      lemmy: deps.adapters.lemmy,
      adapterForEntity: deps.adapterForEntity,
      resolveSort: (adapter, communityId) =>
        resolveCommentSort({
          sorts: adapter.capabilities.sorts.comment,
          preferred: deps.settings.defaultCommentSort,
          communityId,
          rememberCommunitySort: deps.settings.rememberCommunitySort,
        }),
      prefetchImage: (url) => Image.prefetch(url),
      judgeText:
        aiReady && prefs.aiScan
          ? (text) => checkTextWithAiLens(text)
          : undefined,
      feedLimit: prefs.feedLimit,
      onProgress: reportPackProgress,
      shouldStop: deps.shouldStop ?? (() => AppState.currentState !== "active"),
    });
  } catch {
    /* best-effort: a failed background refresh just tries again later */
  } finally {
    endPacking();
  }
}

/**
 * Keeps the Plane Mode pack fresh in the background WHILE YOU BROWSE (the in-app
 * refresher, not an iOS background task). The timer + foreground triggers only
 * fire in "background" mode; "onOpen" refreshes are driven by the Plane Mode
 * screen's focus instead. Mount once, near the app root, inside the providers.
 */
export function useBackgroundPack(): void {
  const { adapters, adapterForEntity } = useAdapters();
  const { settings } = useSettings();
  // Keep the latest deps without re-arming the timers every render.
  const deps = useRef({ adapters, adapterForEntity, settings });
  deps.current = { adapters, adapterForEntity, settings };

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (getPackPrefs().autoRefresh !== "background") return;
      void maybeAutoPack({
        ...deps.current,
        shouldStop: () => cancelled || AppState.currentState !== "active",
      });
    };
    const kick = setTimeout(tick, INITIAL_DELAY_MS);
    const timer = setInterval(tick, CHECK_INTERVAL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      cancelled = true;
      clearTimeout(kick);
      clearInterval(timer);
      sub.remove();
    };
  }, []);
}

/** Null component that runs {@link useBackgroundPack}; mount inside the providers. */
export function BackgroundPackService(): null {
  useBackgroundPack();
  return null;
}
