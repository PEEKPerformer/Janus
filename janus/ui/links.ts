import { Linking } from "react-native";

/**
 * Open an external URL safely. Post/comment bodies are untrusted, so we
 * allowlist http(s)/mailto and never dispatch arbitrary schemes
 * (javascript:, tel:, app deep-links) to Linking. Returns false if the scheme
 * is disallowed or the open fails, so callers can show a fallback toast.
 */
const ALLOWED_SCHEME = /^(https?|mailto):/i;

export async function openExternal(url: string): Promise<boolean> {
  if (!url || !ALLOWED_SCHEME.test(url.trim())) return false;
  try {
    const target = url.trim();
    const ok = await Linking.canOpenURL(target);
    if (!ok) return false;
    await Linking.openURL(target);
    return true;
  } catch {
    return false;
  }
}

export function isHttpUrl(url?: string | null): boolean {
  return !!url && /^https?:\/\/\S+/i.test(url.trim());
}

export function hostname(url: string): string {
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m ? m[1].replace(/^www\./, "") : url;
}
