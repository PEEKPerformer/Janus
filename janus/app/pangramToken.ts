import * as SecureStore from "expo-secure-store";

/**
 * The user's Hugging Face read token, kept in the keychain (SecureStore),
 * never in MMKV — it grants access to everything on their HF account, not
 * just the Pangram repo.
 */

const KEY = "janus.hf.token";

export async function getHfToken(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(KEY)) || null;
  } catch {
    return null;
  }
}

export async function setHfToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) return clearHfToken();
  await SecureStore.setItemAsync(KEY, trimmed);
}

export async function clearHfToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* best-effort */
  }
}
