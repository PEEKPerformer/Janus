import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { Image } from "expo-image";

import { useAdapters } from "./AdapterContext";
import { useSettings } from "./SettingsContext";
import { isOffline } from "../app/offline";
import { getPackPrefs } from "../app/packPrefs";
import { getPackManifest } from "../app/offlinePack";
import { runPack, buildPackScope } from "../app/packer";
import { shouldAutoRefresh } from "../app/packAutoRefresh";
import {
  acquirePackLock,
  releasePackLock,
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

/**
 * Keeps the Plane Mode pack fresh in the background WHILE YOU BROWSE (this is
 * the in-app refresher, not an iOS background task). Only does anything when
 * autoRefresh is "background", the pack is stale, you're online, and no pack is
 * already running. It shares the global pack lock with the manual button so the
 * two never double up the request load, and it bails the moment the app leaves
 * the foreground. Mount once, near the app root, inside the providers.
 */
export function useBackgroundPack(): void {
  const { adapters, adapterForEntity } = useAdapters();
  const { settings } = useSettings();
  // Keep the latest deps without re-arming the timers every render.
  const deps = useRef({ adapters, adapterForEntity, settings });
  deps.current = { adapters, adapterForEntity, settings };

  useEffect(() => {
    let cancelled = false;

    const maybePack = async () => {
      if (cancelled) return;
      if (getPackPrefs().autoRefresh !== "background") return;
      if (isOffline()) return;
      if (
        !shouldAutoRefresh({
          mode: "background",
          manifest: getPackManifest(),
          now: Date.now(),
          online: true,
          packing: isPackingNow(),
        })
      )
        return;
      if (!acquirePackLock()) return;
      try {
        const {
          adapters: a,
          adapterForEntity: route,
          settings: s,
        } = deps.current;
        const aiReady = aiLensStatus() === "ready";
        const prefs = getPackPrefs();
        await runPack(buildPackScope(prefs, aiReady), {
          reddit: a.reddit,
          lemmy: a.lemmy,
          adapterForEntity: route,
          resolveSort: (adapter, communityId) =>
            resolveCommentSort({
              sorts: adapter.capabilities.sorts.comment,
              preferred: s.defaultCommentSort,
              communityId,
              rememberCommunitySort: s.rememberCommunitySort,
            }),
          prefetchImage: (url) => Image.prefetch(url),
          judgeText:
            aiReady && prefs.aiScan
              ? (text) => checkTextWithAiLens(text)
              : undefined,
          feedLimit: prefs.feedLimit,
          onProgress: () => {},
          // Yield if the app backgrounds mid-refresh — never hold work the OS
          // is about to suspend anyway.
          shouldStop: () => cancelled || AppState.currentState !== "active",
        });
      } catch {
        /* best-effort: a failed background refresh just tries again later */
      } finally {
        releasePackLock();
      }
    };

    const kick = setTimeout(() => void maybePack(), INITIAL_DELAY_MS);
    const timer = setInterval(() => void maybePack(), CHECK_INTERVAL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void maybePack();
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
