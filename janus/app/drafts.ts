import * as SecureStore from "expo-secure-store";

/**
 * Compose drafts — so a half-written post or reply survives navigating away or
 * an accidental dismiss. One post draft (the composer is single-target) plus a
 * map of comment drafts keyed by the reply target id. Source-agnostic.
 */

const KEY = "janus.drafts.v1";

export interface PostDraft {
  communityId?: string;
  title: string;
  body: string;
  /** Epoch ms, so the composer can show "restored draft from…". */
  ts: number;
}

interface Store {
  post?: PostDraft;
  comments?: Record<string, string>;
}

async function load(): Promise<Store> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

async function save(store: Store): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(store));
  } catch {
    /* non-fatal */
  }
}

export async function getPostDraft(): Promise<PostDraft | undefined> {
  return (await load()).post;
}

export async function savePostDraft(draft: PostDraft): Promise<void> {
  // An empty draft is the same as no draft — don't persist whitespace.
  if (!draft.title.trim() && !draft.body.trim()) return clearPostDraft();
  const store = await load();
  store.post = draft;
  await save(store);
}

export async function clearPostDraft(): Promise<void> {
  const store = await load();
  if (store.post) {
    delete store.post;
    await save(store);
  }
}

export async function getCommentDraft(
  targetId: string,
): Promise<string | undefined> {
  return (await load()).comments?.[targetId];
}

export async function saveCommentDraft(
  targetId: string,
  text: string,
): Promise<void> {
  const store = await load();
  const comments = { ...store.comments };
  if (text.trim()) comments[targetId] = text;
  else delete comments[targetId];
  store.comments = comments;
  await save(store);
}

export async function clearCommentDraft(targetId: string): Promise<void> {
  return saveCommentDraft(targetId, "");
}
