/**
 * Federation display helper.
 *
 * A federated Lemmy entity is fetched through whichever account subscribes to /
 * reaches it — so its `instance` is THAT account's host (e.g. hexbear.net),
 * which is correct for routing (that account can act on it) but wrong for
 * showing WHERE the thing lives. The home is carried in the handle: remote
 * actors are "name@home" (Voyager's rule), locals are a bare "name" (home ==
 * the instance we fetched from). This is display-only — never use it for
 * routing, which must keep using `instance`.
 */
export function lemmyHome(handle: string, instance: string): string {
  const at = handle.lastIndexOf("@");
  return at >= 0 ? handle.slice(at + 1) : instance;
}
