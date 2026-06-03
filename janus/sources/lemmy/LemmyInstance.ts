import * as SecureStore from "expo-secure-store";

/**
 * Persists the user's chosen Lemmy home instance (Voyager lets you pick/switch
 * instances; the Fediverse has no single home). Stored separately from the
 * session JWT since switching instances invalidates the session.
 */
const KEY = "lemmyInstance";

/** A few well-known general-purpose instances, surfaced in the picker. */
export const POPULAR_LEMMY_INSTANCES = [
  "hexbear.net",
  "lemmygrad.ml",
  "lemmy.ml",
  "lemmy.world",
  "beehaw.org",
  "sh.itjust.works",
  "lemm.ee",
  "programming.dev",
  "feddit.org",
  "lemmy.ca",
];

/** Normalize user input ("https://Lemmy.World/") to a bare host ("lemmy.world"). */
export function normalizeInstance(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

const LemmyInstance = {
  async load(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY);
  },
  async save(instance: string): Promise<void> {
    await SecureStore.setItemAsync(KEY, instance);
  },
};

export default LemmyInstance;
