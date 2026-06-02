/**
 * Holds the live SourceAdapters and the active source. Adapters are INJECTED
 * (the app entry builds the real ones; tests pass mocks), so this module never
 * imports a concrete client — keeping the whole UI tree unit-testable in node.
 */
import React, { createContext, useContext, useMemo, useState } from "react";
import type { SourceAdapter } from "../core/adapter";
import type { SourceKind } from "../core/ids";

export interface AdapterMap {
  reddit: SourceAdapter;
  lemmy: SourceAdapter;
}

interface AdapterContextValue {
  adapters: AdapterMap;
  activeSource: SourceKind;
  setActiveSource: (s: SourceKind) => void;
  adapter: SourceAdapter;
}

const AdapterContext = createContext<AdapterContextValue | null>(null);

export function AdapterProvider({
  adapters,
  initialSource = "lemmy",
  children,
}: {
  adapters: AdapterMap;
  initialSource?: SourceKind;
  children: React.ReactNode;
}) {
  const [activeSource, setActiveSource] = useState<SourceKind>(initialSource);
  const value = useMemo<AdapterContextValue>(
    () => ({ adapters, activeSource, setActiveSource, adapter: adapters[activeSource] }),
    [adapters, activeSource],
  );
  return <AdapterContext.Provider value={value}>{children}</AdapterContext.Provider>;
}

export function useAdapters(): AdapterContextValue {
  const ctx = useContext(AdapterContext);
  if (!ctx) throw new Error("useAdapters must be used within an AdapterProvider");
  return ctx;
}
