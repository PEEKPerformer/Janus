import * as SecureStore from "expo-secure-store";

/**
 * Persists the Lemmy JWT (+ which instance/username it belongs to) in the
 * device Keychain. Unlike Reddit — whose session lives in the shared cookie
 * jar — Lemmy auth is a bearer token we hold ourselves, so we stash it here and
 * rehydrate the adapter on launch via adapter.restore().
 */
const KEY = "lemmySession";

export interface StoredLemmySession {
  instance: string;
  username: string;
  jwt: string;
}

const LemmySession = {
  async save(session: StoredLemmySession): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  },

  async load(): Promise<StoredLemmySession | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.jwt && parsed?.instance) return parsed as StoredLemmySession;
    } catch {
      /* corrupt entry — treat as no session */
    }
    return null;
  },

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  },
};

export default LemmySession;
