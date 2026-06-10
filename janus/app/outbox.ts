import { createMMKV } from "react-native-mmkv";
import { parseId, type JanusId, type SourceKind } from "../core/ids";
import type { SourceAdapter } from "../core/adapter";
import type { Vote } from "../core/vote";

/**
 * The offline outbox — interact on the plane, send on landing. Two tiers,
 * because their failure modes differ:
 *
 *  - VOTES are absolute-state, idempotent ops (`vote(id, Up)` sets the state,
 *    it doesn't increment), so they queue silently and replay safely;
 *    re-voting the same target overwrites the queued entry (last-write-wins).
 *  - COMMENTS are visible in the outbox until sent. A failed send keeps the
 *    entry (with the error) instead of dropping it — a reply written over the
 *    Atlantic is never silently lost, and never double-sent.
 *
 * Cross-network like everything else: each entry replays through whichever
 * adapter owns its JanusId. MMKV-backed, synchronous reads.
 */

const store = createMMKV({ id: "janus.outbox.v1" });
const KEY = "entries";
const CAP = 200;

export type OutboxAction =
  | { kind: "vote"; target: string; vote: Vote }
  | {
      kind: "comment";
      postId: string;
      parentId: string;
      markdown: string;
      /** For display in the outbox list. */
      postTitle: string;
    };

export interface OutboxEntry {
  id: string;
  action: OutboxAction;
  queuedAt: number;
  status: "queued" | "failed";
  error?: string;
}

function load(): OutboxEntry[] {
  try {
    const raw = store.getString(KEY);
    const parsed = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries: OutboxEntry[]): void {
  try {
    store.set(KEY, JSON.stringify(entries.slice(-CAP)));
  } catch {
    /* best-effort */
  }
}

/** Oldest first — the order they'll send in. */
export function listOutbox(): OutboxEntry[] {
  return load().sort((a, b) => a.queuedAt - b.queuedAt);
}

export function outboxCount(): number {
  return load().length;
}

/** Queue a vote; re-voting the same target replaces the queued entry. */
export function enqueueVote(
  target: string,
  vote: Vote,
  now: number = Date.now(),
): void {
  const id = `vote:${target}`;
  const entries = load().filter((e) => e.id !== id);
  entries.push({
    id,
    action: { kind: "vote", target, vote },
    queuedAt: now,
    status: "queued",
  });
  save(entries);
}

let commentSeq = 0;

export function enqueueComment(
  input: {
    postId: string;
    parentId: string;
    markdown: string;
    postTitle: string;
  },
  now: number = Date.now(),
): void {
  const entries = load();
  entries.push({
    id: `comment:${now}:${commentSeq++}`,
    action: { kind: "comment", ...input },
    queuedAt: now,
    status: "queued",
  });
  save(entries);
}

export function removeOutboxEntry(id: string): void {
  save(load().filter((e) => e.id !== id));
}

export function clearOutbox(): void {
  save([]);
}

let draining = false;

/**
 * Send everything, oldest first, each entry through the adapter that owns it.
 * Successes are removed; failures stay marked "failed" (with the message) and
 * are retried on the next drain. Re-entrant calls no-op so a flappy
 * connection can't double-send.
 */
export async function drainOutbox(
  adapterForEntity: (e: {
    source: SourceKind;
    instance: string;
  }) => SourceAdapter,
): Promise<{ sent: number; failed: number }> {
  if (draining) return { sent: 0, failed: 0 };
  draining = true;
  try {
    let sent = 0;
    let failed = 0;
    for (const entry of listOutbox()) {
      const routeId =
        entry.action.kind === "vote"
          ? entry.action.target
          : entry.action.postId;
      try {
        const parts = parseId(routeId as JanusId);
        const adapter = adapterForEntity({
          source: parts.source as SourceKind,
          instance: parts.instance,
        });
        if (entry.action.kind === "vote") {
          await adapter.vote(entry.action.target as JanusId, entry.action.vote);
        } else {
          await adapter.submitComment({
            postId: entry.action.postId as JanusId,
            parentId: entry.action.parentId as JanusId,
            markdown: entry.action.markdown,
          });
        }
        removeOutboxEntry(entry.id);
        sent++;
      } catch (e) {
        const entries = load();
        const i = entries.findIndex((x) => x.id === entry.id);
        if (i >= 0) {
          entries[i] = {
            ...entries[i],
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
          };
          save(entries);
        }
        failed++;
      }
    }
    return { sent, failed };
  } finally {
    draining = false;
  }
}
