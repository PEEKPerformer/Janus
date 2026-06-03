/**
 * Holds the live AccountManager (the adapter registry) and the UI's view state.
 *
 * Adapters are still INJECTED — the app entry builds a real {@link AccountManager};
 * tests pass a plain {reddit, lemmy} map which we wrap with
 * AccountManager.fromAdapters. This module never imports a concrete client, so
 * the whole UI tree stays unit-testable in node.
 *
 * Back-compat: the single-source surfaces (account button, single-source feed,
 * compose) keep reading `adapter`/`adapters.{reddit,lemmy}`. Multi-account
 * surfaces (the merged feed, scope picker, settings) use the new fields:
 * `accounts`, `lemmyAdapters`, and crucially `adapterForEntity(e)` — which routes
 * any read/write to the adapter that OWNS that entity's origin.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SourceAdapter } from "../core/adapter";
import type { SourceKind } from "../core/ids";
import { AccountManager } from "../app/AccountManager";
import { loadGroups, type FeedGroup } from "../app/feedGroups";
import { normalizeInstance } from "../sources/lemmy/LemmyInstance";

export interface AdapterMap {
  reddit: SourceAdapter;
  lemmy: SourceAdapter;
}

/** Which feed the user is looking at: the merged stream, or one source. */
export type FeedScope = "all" | SourceKind;

interface AdapterContextValue {
  /** The adapter registry / account store. */
  manager: AccountManager;
  /** Back-compat single-source view: reddit + the focused Lemmy instance. */
  adapters: AdapterMap;
  activeSource: SourceKind;
  setActiveSource: (s: SourceKind) => void;
  adapter: SourceAdapter;
  /** Route any read/write to the adapter that owns the entity's origin. */
  adapterForEntity: (e: {
    source: SourceKind;
    instance: string;
  }) => SourceAdapter;
  /** Every signed-in identity (Reddit + each Lemmy instance). */
  accounts: ReturnType<AccountManager["accounts"]>;
  /** All Lemmy adapters (one per known instance), signed-in or guest. */
  lemmyAdapters: SourceAdapter[];
  /** "all" = unified feed; otherwise scoped to one source. */
  feedScope: FeedScope;
  setFeedScope: (s: FeedScope) => void;
  loginSource: SourceKind | null;
  requestLogin: (s: SourceKind) => void;
  clearLogin: () => void;
  accountVersion: number;
  bumpAccountVersion: () => void;
  /** Current Lemmy home instance (the focused one) + a switcher. */
  lemmyInstance: string;
  changeLemmyInstance: (instance: string) => void;
  /** User-defined cross-source feed groups (shared between feed + settings). */
  groups: FeedGroup[];
  reloadGroups: () => Promise<void>;
}

const AdapterContext = createContext<AdapterContextValue | null>(null);

export function AdapterProvider({
  manager: managerProp,
  adapters: adaptersProp,
  initialSource = "lemmy",
  initialScope = "all",
  children,
}: {
  /** Real app path: a fully-built (and init()'d) AccountManager. */
  manager?: AccountManager;
  /** Test path: a plain {reddit, lemmy} map, wrapped synchronously. */
  adapters?: AdapterMap;
  initialSource?: SourceKind;
  initialScope?: FeedScope;
  children: React.ReactNode;
}) {
  const manager = useMemo(() => {
    if (managerProp) return managerProp;
    if (adaptersProp) return AccountManager.fromAdapters(adaptersProp);
    throw new Error("AdapterProvider needs either `manager` or `adapters`");
  }, [managerProp, adaptersProp]);

  const [activeSource, setActiveSource] = useState<SourceKind>(initialSource);
  const [feedScope, setFeedScopeState] = useState<FeedScope>(initialScope);
  const [loginSource, setLoginSource] = useState<SourceKind | null>(null);
  const [accountVersion, setAccountVersion] = useState(0);
  const [focusedLemmy, setFocusedLemmy] = useState<string>(
    () => manager.primaryLemmy()?.instance ?? manager.defaultLemmy,
  );
  const [groups, setGroups] = useState<FeedGroup[]>([]);

  const reloadGroups = useCallback(async () => {
    setGroups(await loadGroups());
  }, []);
  useEffect(() => {
    void reloadGroups();
  }, [reloadGroups]);

  // Selecting a single-source scope also makes it the active source, so the
  // account button / login target follow what the user is viewing. "All" keeps
  // whatever single source was last active for those source-specific affordances.
  const setFeedScope = useCallback((s: FeedScope) => {
    setFeedScopeState(s);
    if (s !== "all") setActiveSource(s);
  }, []);

  // Switching instance now just changes which Lemmy adapter is "focused" — every
  // instance keeps its own independent account, so this never logs anyone out.
  const changeLemmyInstance = useCallback(
    (raw: string) => {
      const instance = normalizeInstance(raw);
      if (!instance || instance === focusedLemmy) return;
      manager.ensureLemmyInstance(instance);
      setFocusedLemmy(instance);
      setAccountVersion((v) => v + 1);
    },
    [manager, focusedLemmy],
  );

  const value = useMemo<AdapterContextValue>(() => {
    const reddit = manager.reddit();
    const lemmy = manager.primaryLemmy(focusedLemmy);
    return {
      manager,
      adapters: { reddit, lemmy },
      activeSource,
      setActiveSource,
      adapter: activeSource === "reddit" ? reddit : lemmy,
      adapterForEntity: (e) => manager.adapterForEntity(e),
      accounts: manager.accounts(),
      lemmyAdapters: manager.lemmyAdapters(),
      feedScope,
      setFeedScope,
      loginSource,
      requestLogin: setLoginSource,
      clearLogin: () => setLoginSource(null),
      accountVersion,
      bumpAccountVersion: () => setAccountVersion((v) => v + 1),
      lemmyInstance: lemmy?.instance ?? focusedLemmy,
      changeLemmyInstance,
      groups,
      reloadGroups,
    };
    // accountVersion is included so post-login/instance-switch re-derives the
    // registry-backed views (accounts, lemmyAdapters, focused adapter).
  }, [
    manager,
    activeSource,
    feedScope,
    setFeedScope,
    loginSource,
    accountVersion,
    focusedLemmy,
    changeLemmyInstance,
    groups,
    reloadGroups,
  ]);

  return (
    <AdapterContext.Provider value={value}>{children}</AdapterContext.Provider>
  );
}

export function useAdapters(): AdapterContextValue {
  const ctx = useContext(AdapterContext);
  if (!ctx)
    throw new Error("useAdapters must be used within an AdapterProvider");
  return ctx;
}
