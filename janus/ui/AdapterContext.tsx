/**
 * Holds the live SourceAdapters and the active source. Adapters are INJECTED
 * (the app entry builds the real ones; tests pass mocks), so this module never
 * imports a concrete client — keeping the whole UI tree unit-testable in node.
 *
 * It also tracks login intent (which source's login flow is requested) and an
 * `accountVersion` that bumps after login so consumers re-read adapter.account.
 * The actual WebView login modal lives in JanusApp (kept out of here so this
 * stays RN-import-free).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { SourceAdapter } from "../core/adapter";
import type { SourceKind } from "../core/ids";

export interface AdapterMap {
  reddit: SourceAdapter;
  lemmy: SourceAdapter;
}

/** Which feed the user is looking at: the merged stream, or one source. */
export type FeedScope = "all" | SourceKind;

interface AdapterContextValue {
  adapters: AdapterMap;
  activeSource: SourceKind;
  setActiveSource: (s: SourceKind) => void;
  adapter: SourceAdapter;
  /** "all" = unified feed; otherwise scoped to one source. */
  feedScope: FeedScope;
  setFeedScope: (s: FeedScope) => void;
  loginSource: SourceKind | null;
  requestLogin: (s: SourceKind) => void;
  clearLogin: () => void;
  accountVersion: number;
  bumpAccountVersion: () => void;
}

const AdapterContext = createContext<AdapterContextValue | null>(null);

export function AdapterProvider({
  adapters,
  initialSource = "lemmy",
  initialScope = "all",
  children,
}: {
  adapters: AdapterMap;
  initialSource?: SourceKind;
  initialScope?: FeedScope;
  children: React.ReactNode;
}) {
  const [activeSource, setActiveSource] = useState<SourceKind>(initialSource);
  const [feedScope, setFeedScopeState] = useState<FeedScope>(initialScope);
  const [loginSource, setLoginSource] = useState<SourceKind | null>(null);
  const [accountVersion, setAccountVersion] = useState(0);

  // Selecting a single-source scope also makes it the active source, so the
  // account button / login target follow what the user is viewing. "All" keeps
  // whatever single source was last active for those source-specific affordances.
  const setFeedScope = useCallback((s: FeedScope) => {
    setFeedScopeState(s);
    if (s !== "all") setActiveSource(s);
  }, []);

  const value = useMemo<AdapterContextValue>(
    () => ({
      adapters,
      activeSource,
      setActiveSource,
      adapter: adapters[activeSource],
      feedScope,
      setFeedScope,
      loginSource,
      requestLogin: setLoginSource,
      clearLogin: () => setLoginSource(null),
      accountVersion,
      bumpAccountVersion: () => setAccountVersion((v) => v + 1),
    }),
    [
      adapters,
      activeSource,
      feedScope,
      setFeedScope,
      loginSource,
      accountVersion,
    ],
  );
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
