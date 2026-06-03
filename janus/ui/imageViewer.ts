/**
 * A tiny indirection so deeply-nested, navigation-free renderers (the markdown
 * renderer, used in posts/comments) can open the in-app image viewer without
 * threading a callback or `useNavigation` through every call site — mirroring
 * the {@link ./links} link-handler pattern. The app shell registers the opener
 * once (wired to navigation); callers just invoke {@link openImageViewer}.
 */
let opener: ((images: string[], index: number) => void) | null = null;

export function setImageViewerOpener(
  fn: ((images: string[], index: number) => void) | null,
): void {
  opener = fn;
}

export function openImageViewer(images: string[], index = 0): void {
  if (images.length) opener?.(images, index);
}
