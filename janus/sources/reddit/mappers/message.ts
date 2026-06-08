/**
 * Maps Reddit private-message Things (t4) into the unified DirectMessage model
 * and groups a message list into Conversations. Reddit returns PM threads with
 * replies nested under `data.replies`; we flatten them so the thread view sees a
 * flat, time-ordered exchange. Pure + testable (no network).
 */
import type {
  DirectMessage,
  Conversation,
  AuthorRef,
} from "../../../core/model";
import { rid, rkey, richText, REDDIT_SOURCE, REDDIT_INSTANCE } from "./shared";

function userRef(name: string): AuthorRef {
  return { id: rid("user", name), username: name, handle: `u/${name}` };
}

/** Flatten a Reddit message listing (t4 things with nested `replies`). */
export function flattenRedditMessages(children: any[]): any[] {
  const out: any[] = [];
  const walk = (list: any[]) => {
    for (const c of list) {
      if (c?.kind !== "t4") continue;
      out.push(c.data);
      const replies = c.data?.replies?.data?.children;
      if (Array.isArray(replies)) walk(replies);
    }
  };
  walk(children ?? []);
  return out;
}

export function mapRedditMessage(d: any, myUsername: string): DirectMessage {
  const fromName: string = d?.author ?? "";
  const toName: string = d?.dest ?? "";
  const fromMe = fromName.toLowerCase() === myUsername.toLowerCase();
  return {
    id: rid("message", d?.name ?? ""),
    dedupKey: rkey(d?.name ?? ""),
    source: REDDIT_SOURCE,
    instance: REDDIT_INSTANCE,
    read: !d?.new,
    createdAt: (d?.created_utc ?? 0) * 1000,
    from: userRef(fromName),
    to: userRef(toName),
    body: richText(d?.body, d?.body_html),
    fromMe,
  };
}

/** The party in a message that ISN'T the signed-in user. */
function correspondentName(m: DirectMessage): string {
  return m.fromMe ? m.to.username : m.from.username;
}

/**
 * Group a flat, mapped message list into conversations keyed by correspondent,
 * newest activity first. Skips messages with no identifiable correspondent
 * (e.g. subreddit/system messages).
 */
export function groupConversations(messages: DirectMessage[]): Conversation[] {
  const byUser = new Map<string, DirectMessage[]>();
  for (const m of messages) {
    const name = correspondentName(m);
    if (!name) continue;
    const arr = byUser.get(name) ?? [];
    arr.push(m);
    byUser.set(name, arr);
  }
  const convos: Conversation[] = [];
  for (const [name, msgs] of byUser) {
    msgs.sort((a, b) => b.createdAt - a.createdAt);
    const last = msgs[0];
    const correspondent = last.fromMe ? last.to : last.from;
    convos.push({
      id: rid("user", name),
      source: REDDIT_SOURCE,
      instance: REDDIT_INSTANCE,
      correspondent,
      lastMessage: last,
      unreadCount: msgs.filter((m) => !m.read && !m.fromMe).length,
    });
  }
  convos.sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt);
  return convos;
}

/** Filter a mapped message list to one correspondent, oldest first. */
export function threadWith(
  messages: DirectMessage[],
  correspondent: string,
): DirectMessage[] {
  const want = correspondent.toLowerCase();
  return messages
    .filter((m) => correspondentName(m).toLowerCase() === want)
    .sort((a, b) => a.createdAt - b.createdAt);
}
