import * as SecureStore from "expo-secure-store";
import type { SourceKind } from "../core/ids";

/**
 * Feed groups — Janus's cross-source "multireddit". A group is a named set of
 * community addresses that can span Reddit AND any number of Lemmy instances,
 * e.g. Privacy = [r/privacy, lemmy.ml/c/privacy, hexbear.net/c/technology].
 * Viewing a group fans out one getFeed per member (see groupFeed.ts) and merges.
 *
 * Members are stored as ADDRESSES (source + instance + name), not resolved
 * Communities, so a group survives even if an instance is temporarily down or
 * the user isn't browsing it — resolution happens lazily at feed time.
 */

export interface CommunityAddress {
  source: SourceKind;
  /** Lemmy instance host; omitted/derived for Reddit (single host). */
  instance?: string;
  /** Bare community/subreddit name (no r/ or c/ prefix, no @instance). */
  name: string;
}

export interface FeedGroup {
  id: string;
  name: string;
  members: CommunityAddress[];
}

const KEY = "janus.feedGroups.v1";

function stripWww(host: string): string {
  return host.replace(/^www\./i, "");
}

/**
 * Parse a community address from the many forms a user might type or paste:
 *   r/privacy · /r/privacy            → Reddit
 *   c/privacy                         → Lemmy on the default instance
 *   privacy@lemmy.ml                  → Lemmy (remote)
 *   https://lemmy.ml/c/privacy        → Lemmy on lemmy.ml
 *   https://hexbear.net/c/technology  → Lemmy on hexbear.net
 *   https://reddit.com/r/privacy      → Reddit
 * Ambiguous bare words ("privacy") return null — the caller should require a
 * recognizable form rather than guess the source.
 */
export function parseCommunityAddress(
  raw: string,
  defaultLemmyInstance?: string,
): CommunityAddress | null {
  const input = raw.trim();
  if (!input) return null;

  // Full URL.
  if (/^https?:\/\//i.test(input)) {
    try {
      const u = new URL(input);
      const host = stripWww(u.hostname.toLowerCase());
      const m = u.pathname.match(/\/(r|c)\/([^/?#]+)/i);
      if (!m) return null;
      const [, kind, name] = m;
      if (kind.toLowerCase() === "r")
        return { source: "reddit", name: decodeURIComponent(name) };
      return {
        source: "lemmy",
        instance: host,
        name: decodeURIComponent(name),
      };
    } catch {
      return null;
    }
  }

  // r/name (Reddit).
  const r = input.match(/^\/?r\/([^/\s@]+)$/i);
  if (r) return { source: "reddit", name: r[1] };

  // name@instance (Lemmy remote).
  const at = input.match(/^([^/\s@]+)@([^/\s@]+)$/);
  if (at)
    return { source: "lemmy", instance: at[2].toLowerCase(), name: at[1] };

  // c/name (Lemmy, default instance).
  const c = input.match(/^\/?c\/([^/\s@]+)$/i);
  if (c) {
    if (!defaultLemmyInstance) return null;
    return {
      source: "lemmy",
      instance: defaultLemmyInstance.toLowerCase(),
      name: c[1],
    };
  }

  return null; // ambiguous bare word — make the user be explicit
}

/** Human-facing label for a member, e.g. "r/privacy" or "privacy@lemmy.ml". */
export function addressLabel(a: CommunityAddress): string {
  if (a.source === "reddit") return `r/${a.name}`;
  return a.instance ? `${a.name}@${a.instance}` : `c/${a.name}`;
}

function isAddress(v: unknown): v is CommunityAddress {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    (a.source === "reddit" || a.source === "lemmy") &&
    typeof a.name === "string"
  );
}

function isGroup(v: unknown): v is FeedGroup {
  if (!v || typeof v !== "object") return false;
  const g = v as Record<string, unknown>;
  return (
    typeof g.id === "string" &&
    typeof g.name === "string" &&
    Array.isArray(g.members) &&
    g.members.every(isAddress)
  );
}

export async function loadGroups(): Promise<FeedGroup[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isGroup) : [];
  } catch {
    return [];
  }
}

async function writeGroups(groups: FeedGroup[]): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(groups));
}

/** Add or replace a group (by id), then persist; returns the new list. */
export async function saveGroup(group: FeedGroup): Promise<FeedGroup[]> {
  const list = await loadGroups();
  const next = [...list.filter((g) => g.id !== group.id), group];
  await writeGroups(next);
  return next;
}

export async function removeGroup(id: string): Promise<FeedGroup[]> {
  const next = (await loadGroups()).filter((g) => g.id !== id);
  await writeGroups(next);
  return next;
}
