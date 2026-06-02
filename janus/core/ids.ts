/**
 * JanusId — the universal, namespaced identifier for every entity in Janus.
 *
 * Reddit ids (t3_abc) and Lemmy ids (numeric) collide with each other, and Lemmy
 * ids collide ACROSS federated instances. So every id is namespaced as
 * `${source}:${instance}:${kind}:${nativeId}`, e.g.
 *   "reddit:www.reddit.com:post:t3_abc123"
 *   "lemmy:lemmy.world:community:42"
 *
 * IMPORTANT (federation): the JanusId is the *canonical* id, keyed on the local
 * instance you fetched from — it is what routing/display use. It is NOT a safe
 * cross-instance dedup key, because the same federated Lemmy object is reachable
 * under many instance-qualified ids. For dedup/merge, entities also carry a
 * separate `dedupKey` (the federation ap_id for Lemmy; identical to the native
 * fullname for Reddit, which has no federation). See model.ts.
 */

export type SourceKind = "reddit" | "lemmy";

export type EntityKind =
  | "post"
  | "comment"
  | "community"
  | "user"
  | "message"
  | "multireddit";

/** Opaque branded string. Build/parse only through this module. */
export type JanusId = string & { readonly __brand: "JanusId" };

/**
 * The federation-stable dedup key. For Lemmy this is the object's `ap_id`
 * (e.g. "https://lemmy.ml/c/asklemmy"); for Reddit it is just the native
 * fullname (which is already globally unique within Reddit).
 */
export type DedupKey = string & { readonly __brand: "DedupKey" };

export interface IdParts {
  source: SourceKind;
  instance: string;
  kind: EntityKind;
  nativeId: string;
}

const SEP = ":";

export function buildId(parts: IdParts): JanusId {
  const { source, instance, kind, nativeId } = parts;
  return `${source}${SEP}${instance}${SEP}${kind}${SEP}${nativeId}` as JanusId;
}

export function parseId(id: JanusId): IdParts {
  const segments = id.split(SEP);
  if (segments.length < 4) {
    throw new Error(`Malformed JanusId: ${id}`);
  }
  const [source, instance, kind, ...rest] = segments;
  return {
    source: source as SourceKind,
    instance,
    kind: kind as EntityKind,
    // nativeId may itself contain ':' in edge cases — rejoin the tail.
    nativeId: rest.join(SEP),
  };
}

export function dedupKey(value: string): DedupKey {
  return value as DedupKey;
}

/** Convenience accessors that avoid a full parse at call sites. */
export function sourceOf(id: JanusId): SourceKind {
  return parseId(id).source;
}

export function instanceOf(id: JanusId): string {
  return parseId(id).instance;
}
