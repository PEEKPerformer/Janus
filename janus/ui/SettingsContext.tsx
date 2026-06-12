import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  updateSettings,
  type JanusSettings,
} from "../app/settingsStore";
import { setLinkPreferences } from "./links";
import { setAnalyticsEnabled } from "../app/analytics";

/**
 * App-wide preferences, loaded once at boot and persisted on every change. This
 * is the single source of truth both source adapters' screens read from — feed
 * defaults, swipe mapping, NSFW handling, link behaviour — so unification lives
 * here, not duplicated per source.
 *
 * `set` applies an optimistic in-memory patch immediately (so the UI is
 * instant) and writes through to the Keychain in the background.
 */
interface SettingsContextValue {
  settings: JanusSettings;
  set: (patch: Partial<JanusSettings>) => void;
  /** True until the persisted blob has loaded; render with defaults meanwhile. */
  ready: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  /** Test seam: skip the async load and start from a known value. */
  initial?: JanusSettings;
}) {
  const [settings, setSettings] = useState<JanusSettings>(
    initial ?? DEFAULT_SETTINGS,
  );
  const [ready, setReady] = useState(!!initial);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    void loadSettings().then((s) => {
      if (alive) {
        setSettings(s);
        setReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [initial]);

  // Push link behaviour down to the plain links module so openExternal() needn't
  // be threaded with settings at every call site.
  useEffect(() => {
    setLinkPreferences({
      linkHandling: settings.linkHandling,
      readerMode: settings.readerMode,
      externalBrowser: settings.externalBrowser,
    });
  }, [settings.linkHandling, settings.readerMode, settings.externalBrowser]);

  // Consent gate: analytics only run while the user has opted in. Waits for
  // `ready` so the persisted choice — not the default — drives the gate.
  useEffect(() => {
    if (ready) setAnalyticsEnabled(settings.shareUsageData);
  }, [ready, settings.shareUsageData]);

  const set = useCallback((patch: Partial<JanusSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    void updateSettings(patch);
  }, []);

  const value = useMemo(
    () => ({ settings, set, ready }),
    [settings, set, ready],
  );
  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * Read settings. Outside a provider (isolated unit tests) this returns defaults
 * with a no-op setter, so components that only *read* a preference stay
 * testable without wrapping.
 */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (ctx) return ctx;
  return { settings: DEFAULT_SETTINGS, set: () => {}, ready: true };
}
