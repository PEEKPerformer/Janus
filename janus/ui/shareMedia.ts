import { Image } from "expo-image";
import * as Sharing from "expo-sharing";

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
    await Image.prefetch(url);
    const path = await Image.getCachePathAsync(url);
    if (!path) return false;
    const localUri = path.startsWith("file://") ? path : `file://${path}`;
    await Sharing.shareAsync(localUri, {
      mimeType: "image/jpeg",
      UTI: "public.image",
    });
    return true;
  } catch {
    return false;
  }
}
