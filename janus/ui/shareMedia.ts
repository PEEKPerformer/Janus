import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";

/** Resolve an http(s) image URL to a local file:// path via expo-image's cache. */
async function localFileFor(url: string): Promise<string | null> {
  if (!url) return null;
  await Image.prefetch(url);
  const path = await Image.getCachePathAsync(url);
  if (!path) return null;
  return path.startsWith("file://") ? path : `file://${path}`;
}

/**
 * Share the actual image FILE (not a URL) via the native share sheet, so it can
 * be sent straight into a group chat, Messages, etc. We avoid adding
 * expo-file-system: expo-image already caches the bytes on disk when the image
 * is displayed, so we prefetch (a no-op if cached) and hand its local cache path
 * to expo-sharing. Returns false if sharing is unavailable or the bytes can't be
 * resolved, so callers can fall back.
 */
export async function shareImage(url: string): Promise<boolean> {
  try {
    if (!url || !(await Sharing.isAvailableAsync())) return false;
    const localUri = await localFileFor(url);
    if (!localUri) return false;
    await Sharing.shareAsync(localUri, {
      mimeType: "image/jpeg",
      UTI: "public.image",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Save the image to the device photo library. Requests add-only permission
 * (writeOnly) so we don't ask for full library access. Returns a status the
 * viewer can surface ("saved" / "denied" / "failed").
 */
export type SaveResult = "saved" | "denied" | "failed";

export async function saveImageToLibrary(url: string): Promise<SaveResult> {
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) return "denied";
    const localUri = await localFileFor(url);
    if (!localUri) return "failed";
    await MediaLibrary.saveToLibraryAsync(localUri);
    return "saved";
  } catch {
    return "failed";
  }
}
