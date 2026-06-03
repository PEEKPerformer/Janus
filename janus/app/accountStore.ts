import * as SecureStore from "expo-secure-store";
import type { AccountRef, SecretBundle } from "../core/adapter";
import { buildId, type JanusId, type SourceKind } from "../core/ids";

/**
 * Multi-account persistence. Janus can hold several identities at once — one
 * Reddit and any number of Lemmy instances (hexbear.net, lemmy.ml, …) — so the
 * device Keychain stores an ARRAY of accounts, not a single session.
 *
 * Each account pairs a public-ish {@link AccountRef} (who/where) with its
 * opaque {@link SecretBundle} (the JWT or session cookie). The whole list lives
 * under one key; an explicit `version` lets us migrate the shape later.
 *
 * Browse instances are stored separately: Lemmy lets you read an instance
 * without an account, so we remember which instances the user has chosen to
 * browse even when logged out (the Fediverse has no single home).
 */

export interface StoredAccount {
  ref: AccountRef;
  secret: SecretBundle;
}

const ACCOUNTS_KEY = "janus.accounts.v1";
const INSTANCES_KEY = "janus.lemmyInstances.v1";

// Legacy single-session keys (pre-multi-account). Migrated once, then left
// alone — clearing them is unnecessary because migration is guarded on the new
// key being absent.
const LEGACY_SESSION_KEY = "lemmySession";
const LEGACY_INSTANCE_KEY = "lemmyInstance";

/** Canonical account id, e.g. "lemmy:hexbear.net:user:alice". */
export function accountId(
  source: SourceKind,
  instance: string,
  username: string,
): JanusId {
  return buildId({
    source,
    instance: instance.toLowerCase(),
    kind: "user",
    nativeId: username.toLowerCase(),
  });
}

function isStoredAccount(v: unknown): v is StoredAccount {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  const ref = a.ref as Record<string, unknown> | undefined;
  const secret = a.secret as Record<string, unknown> | undefined;
  return (
    !!ref &&
    typeof ref.id === "string" &&
    (ref.source === "reddit" || ref.source === "lemmy") &&
    typeof ref.instance === "string" &&
    !!secret &&
    (secret.source === "reddit" || secret.source === "lemmy")
  );
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadAccounts(): Promise<StoredAccount[]> {
  const parsed = await readJson<unknown>(ACCOUNTS_KEY, []);
  return Array.isArray(parsed) ? parsed.filter(isStoredAccount) : [];
}

async function writeAccounts(list: StoredAccount[]): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(list));
}

/** Add or replace an account (keyed by ref.id), then persist. */
export async function upsertAccount(account: StoredAccount): Promise<void> {
  const list = await loadAccounts();
  const next = [...list.filter((a) => a.ref.id !== account.ref.id), account];
  await writeAccounts(next);
}

export async function removeAccount(id: string): Promise<void> {
  const list = await loadAccounts();
  await writeAccounts(list.filter((a) => a.ref.id !== id));
}

export async function loadBrowseInstances(): Promise<string[]> {
  const parsed = await readJson<unknown>(INSTANCES_KEY, []);
  return Array.isArray(parsed)
    ? parsed.filter((s): s is string => typeof s === "string")
    : [];
}

export async function saveBrowseInstances(instances: string[]): Promise<void> {
  const unique = Array.from(
    new Set(instances.map((i) => i.toLowerCase()).filter(Boolean)),
  );
  await SecureStore.setItemAsync(INSTANCES_KEY, JSON.stringify(unique));
}

export async function addBrowseInstance(instance: string): Promise<string[]> {
  const next = [...(await loadBrowseInstances()), instance.toLowerCase()];
  const unique = Array.from(new Set(next));
  await saveBrowseInstances(unique);
  return unique;
}

/**
 * One-time import of the pre-multi-account Lemmy session + instance into the new
 * store. Runs only when the new accounts key is still absent, so it's
 * idempotent and never clobbers real multi-account data.
 */
export async function migrateLegacyIfNeeded(): Promise<void> {
  const existing = await SecureStore.getItemAsync(ACCOUNTS_KEY);
  if (existing) return; // already on the new store

  const legacyInstance = await SecureStore.getItemAsync(LEGACY_INSTANCE_KEY);
  if (legacyInstance) await addBrowseInstance(legacyInstance);

  const sessionRaw = await SecureStore.getItemAsync(LEGACY_SESSION_KEY);
  if (!sessionRaw) {
    await writeAccounts([]); // mark migration done even with no session
    return;
  }
  try {
    const s = JSON.parse(sessionRaw) as {
      instance?: string;
      username?: string;
      jwt?: string;
    };
    if (s.jwt && s.instance && s.username) {
      const ref: AccountRef = {
        id: accountId("lemmy", s.instance, s.username),
        source: "lemmy",
        instance: s.instance.toLowerCase(),
        username: s.username,
        isGuest: false,
      };
      await writeAccounts([{ ref, secret: { source: "lemmy", jwt: s.jwt } }]);
      await addBrowseInstance(s.instance);
      return;
    }
  } catch {
    /* corrupt legacy session — fall through */
  }
  await writeAccounts([]);
}
