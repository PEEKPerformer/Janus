/**
 * Public Reddit-archive client — the data layer behind AI-Lens-adjacent
 * "recover what Reddit no longer serves" features:
 *
 *  - profile reconstruction, when a user hides their post/comment history
 *    (the listing endpoint 403s, but the posts were public when archived); and
 *  - in-thread recovery of `[removed]`/`[deleted]` comment bodies.
 *
 * This reads the *public record* the way the Reddit ecosystem long has
 * (Pushshift → its successors). Two providers, tried in order:
 *
 *  - Arctic Shift (arctic-shift.photon-reddit.com) — deep historical coverage.
 *  - PullPush (api.pullpush.io) — shallower (post-2023) but a near-drop-in
 *    Pushshift clone; the fallback when Arctic Shift is down or empty.
 *
 * Pure URL/JSON over an injected fetch — no IO of its own, no React Native —
 * so provider quirks and the fallback ladder are fully unit-tested. Mapping the
 * normalized records into the domain model lives in `mappers/archive.ts`.
 */

export type ArchiveKind = "posts" | "comments";
export type ArchiveProviderId = "arctic-shift" | "pullpush";

/** A provider-normalized archive record (a Reddit Thing.data subset). */
export interface ArchiveRecord {
  /** Reddit fullname: `t3_<id>` (post) or `t1_<id>` (comment). */
  fullname: string;
  id: string;
  author: string;
  /** Epoch ms (providers report created_utc in seconds; we normalize). */
  createdAt: number;
  subreddit: string;
  permalink?: string;
  score?: number;
  // Posts
  title?: string;
  selftext?: string;
  selftextHtml?: string;
  url?: string;
  // Comments
  body?: string;
  bodyHtml?: string;
  /** `t3_<id>` of the post this comment belongs to. */
  linkId?: string;
  parentId?: string;
}

export interface ArchivePage {
  items: ArchiveRecord[];
  /**
   * Epoch-ms cursor for the next (older) page — the created-time of the oldest
   * item, to pass as `before`. Undefined when the provider returned a short
   * page (nothing older to fetch).
   */
  nextBefore?: number;
  provider: ArchiveProviderId;
}

export interface ArchiveQuery {
  /** Page size (provider cap is ~100). */
  limit?: number;
  /** Epoch-ms upper bound (exclusive) for paging into older content. */
  before?: number;
  signal?: AbortSignal;
}

export type ArchiveFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

const DEFAULT_LIMIT = 50;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** Reddit base36 ids carry no kind; rebuild the fullname from id + kind. */
function fullname(kind: ArchiveKind, raw: Record<string, unknown>): string {
  const name = str(raw.name);
  if (name && /^t[0-9]_/.test(name)) return name;
  const prefix = kind === "posts" ? "t3_" : "t1_";
  const id = str(raw.id) ?? "";
  return id.startsWith(prefix) ? id : `${prefix}${id.replace(/^t[0-9]_/, "")}`;
}

function normalize(
  kind: ArchiveKind,
  raw: Record<string, unknown>,
): ArchiveRecord | null {
  const createdSec = num(raw.created_utc) ?? num(raw.created);
  const author = str(raw.author);
  if (createdSec == null || !author) return null; // unusable record
  const fn = fullname(kind, raw);
  const rec: ArchiveRecord = {
    fullname: fn,
    id: fn.replace(/^t[0-9]_/, ""),
    author,
    createdAt: createdSec * 1000,
    subreddit: str(raw.subreddit) ?? "",
    permalink: str(raw.permalink),
    score: num(raw.score),
  };
  if (kind === "posts") {
    rec.title = str(raw.title) ?? "";
    rec.selftext = str(raw.selftext);
    rec.selftextHtml = str(raw.selftext_html);
    rec.url = str(raw.url);
  } else {
    rec.body = str(raw.body);
    rec.bodyHtml = str(raw.body_html);
    rec.linkId = str(raw.link_id);
    rec.parentId = str(raw.parent_id);
  }
  return rec;
}

/** Both providers wrap results in `{ data: [...] }`. */
function records(kind: ArchiveKind, body: unknown): ArchiveRecord[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: ArchiveRecord[] = [];
  for (const r of data) {
    if (r && typeof r === "object") {
      const rec = normalize(kind, r as Record<string, unknown>);
      if (rec) out.push(rec);
    }
  }
  return out;
}

function page(
  kind: ArchiveKind,
  provider: ArchiveProviderId,
  body: unknown,
  limit: number,
): ArchivePage {
  const items = records(kind, body).sort((a, b) => b.createdAt - a.createdAt);
  // A full page implies more may exist; cursor on the oldest item's time.
  const nextBefore =
    items.length >= limit ? items[items.length - 1].createdAt : undefined;
  return { items, nextBefore, provider };
}

interface ProviderUrls {
  id: ArchiveProviderId;
  author(kind: ArchiveKind, author: string, q: ArchiveQuery): string;
  thread(linkId: string, q: ArchiveQuery): string;
}

const beforeSec = (q: ArchiveQuery): string =>
  q.before ? `&before=${Math.floor(q.before / 1000)}` : "";

const PROVIDERS: ProviderUrls[] = [
  {
    id: "arctic-shift",
    author: (kind, author, q) =>
      `https://arctic-shift.photon-reddit.com/api/${
        kind === "posts" ? "posts" : "comments"
      }/search?author=${encodeURIComponent(author)}&sort=desc&limit=${
        q.limit ?? DEFAULT_LIMIT
      }${beforeSec(q)}`,
    thread: (linkId, q) =>
      `https://arctic-shift.photon-reddit.com/api/comments/search?link_id=${encodeURIComponent(
        linkId,
      )}&limit=${q.limit ?? 100}`,
  },
  {
    id: "pullpush",
    author: (kind, author, q) =>
      `https://api.pullpush.io/reddit/search/${
        kind === "posts" ? "submission" : "comment"
      }/?author=${encodeURIComponent(author)}&sort=desc&sort_type=created_utc&size=${
        q.limit ?? DEFAULT_LIMIT
      }${beforeSec(q)}`,
    thread: (linkId, q) =>
      `https://api.pullpush.io/reddit/search/comment/?link_id=${encodeURIComponent(
        linkId.replace(/^t3_/, ""),
      )}&size=${q.limit ?? 100}`,
  },
];

async function tryProviders(
  kind: ArchiveKind,
  q: ArchiveQuery,
  url: (p: ProviderUrls) => string,
  fetchImpl: ArchiveFetch,
): Promise<ArchivePage> {
  const limit =
    (kind === "posts" || kind === "comments") && q.limit
      ? q.limit
      : DEFAULT_LIMIT;
  let lastErr: unknown;
  for (const provider of PROVIDERS) {
    try {
      const res = await fetchImpl(url(provider), { signal: q.signal });
      if (res.status !== 200) {
        lastErr = new Error(`${provider.id} HTTP ${res.status}`);
        continue;
      }
      const result = page(kind, provider.id, await res.json(), limit);
      // An up-but-empty primary still falls through to the fallback: a hidden
      // profile with zero Arctic Shift hits may have PullPush coverage.
      if (
        result.items.length === 0 &&
        provider.id !== PROVIDERS[PROVIDERS.length - 1].id
      ) {
        lastErr = new Error(`${provider.id} returned no records`);
        continue;
      }
      return result;
    } catch (e) {
      if (q.signal?.aborted) throw e;
      lastErr = e;
    }
  }
  if (lastErr instanceof Error && /no records$/.test(lastErr.message)) {
    return { items: [], provider: PROVIDERS[PROVIDERS.length - 1].id };
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("All archive providers failed");
}

/** Page a user's archived posts or comments, newest first. */
export function archiveAuthorContent(
  kind: ArchiveKind,
  author: string,
  q: ArchiveQuery,
  fetchImpl: ArchiveFetch,
): Promise<ArchivePage> {
  return tryProviders(kind, q, (p) => p.author(kind, author, q), fetchImpl);
}

/** Fetch every archived comment for one thread (to recover removed bodies). */
export function archiveThreadComments(
  linkId: string,
  q: ArchiveQuery,
  fetchImpl: ArchiveFetch,
): Promise<ArchivePage> {
  return tryProviders("comments", q, (p) => p.thread(linkId, q), fetchImpl);
}
