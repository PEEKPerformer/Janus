import type { SourceAdapter, AccountRef, SecretBundle } from "../core/adapter";
import type { SourceKind } from "../core/ids";
import {
  loadAccounts,
  loadBrowseInstances,
  migrateLegacyIfNeeded,
  upsertAccount,
  removeAccount,
  addBrowseInstance,
  accountId,
  type StoredAccount,
} from "./accountStore";

/**
 * AccountManager — the unification keystone.
 *
 * Instead of a fixed {reddit, lemmy} pair, Janus keeps a REGISTRY of adapters
 * keyed by origin (`source:instance`). One Reddit adapter (single host) plus one
 * adapter per Lemmy instance the user has an account on OR has chosen to browse.
 *
 * The single most important method is {@link adapterForEntity}: every read/write
 * resolves to the adapter that OWNS that entity's origin, using the entity's own
 * `source`+`instance`. That's what makes actions correct in a merged feed — a
 * vote on a hexbear post goes through the hexbear account, a vote on a lemmy.ml
 * post through lemmy.ml — without any global "active source" deciding it.
 *
 * Boundary: at most one account per `source:instance` (two accounts on the SAME
 * instance is out of scope; everything else — many instances, Reddit + many
 * Lemmies — is supported).
 *
 * Framework-free and factory-injected so the whole thing unit-tests in node.
 */

export type AdapterKey = string;

export function adapterKey(source: SourceKind, instance: string): AdapterKey {
  return `${source}:${instance.toLowerCase()}`;
}

/** The registry key that owns an entity, derived from its origin. */
export function keyForEntity(e: {
  source: SourceKind;
  instance: string;
}): AdapterKey {
  return adapterKey(e.source, e.instance);
}

export interface AdapterFactories {
  createReddit: () => SourceAdapter;
  createLemmy: (instance: string, jwt?: string) => SourceAdapter;
}

export interface AccountManagerOptions {
  factories: AdapterFactories;
  /** Always-available Lemmy instance so the app is never empty when logged out. */
  defaultLemmyInstance: string;
  /**
   * Optional shell hook run just before an account's adapter.restore() — e.g.
   * re-injecting Reddit's session cookie into the WebView jar on cold launch.
   * Keeps RN/Keychain specifics out of this framework-free module.
   */
  onBeforeRestore?: (account: AccountRef) => Promise<void>;
}

export class AccountManager {
  private registry = new Map<AdapterKey, SourceAdapter>();
  private factories: AdapterFactories;
  private defaultLemmyInstance: string;
  private onBeforeRestore?: (account: AccountRef) => Promise<void>;
  /** Cached so callers don't have to re-derive it; set during init(). */
  private redditKeyCache: AdapterKey | null = null;

  constructor(opts: AccountManagerOptions) {
    this.factories = opts.factories;
    this.defaultLemmyInstance = opts.defaultLemmyInstance.toLowerCase();
    this.onBeforeRestore = opts.onBeforeRestore;
  }

  /**
   * Synchronous construction from already-built adapters — the bridge for unit
   * tests (and any host that builds adapters eagerly). Skips init()/persistence;
   * the registry is seeded directly. Factories are no-ops since nothing new gets
   * created lazily except guest Lemmy adapters for unknown instances.
   */
  static fromAdapters(adapters: {
    reddit: SourceAdapter;
    lemmy: SourceAdapter | SourceAdapter[];
  }): AccountManager {
    const lemmies = Array.isArray(adapters.lemmy)
      ? adapters.lemmy
      : [adapters.lemmy];
    const mgr = new AccountManager({
      factories: {
        createReddit: () => adapters.reddit,
        createLemmy: () => {
          throw new Error("fromAdapters: cannot create Lemmy adapters lazily");
        },
      },
      defaultLemmyInstance: lemmies[0]?.instance ?? "lemmy.ml",
    });
    mgr.redditKeyCache = adapterKey("reddit", adapters.reddit.instance);
    mgr.registry.set(mgr.redditKeyCache, adapters.reddit);
    for (const l of lemmies)
      mgr.registry.set(adapterKey("lemmy", l.instance), l);
    return mgr;
  }

  get defaultLemmy(): string {
    return this.defaultLemmyInstance;
  }

  /**
   * Build the always-present Reddit adapter + a Lemmy adapter for every instance
   * we know about (default + browse list + every stored account), then rehydrate
   * each stored account's secret. Stale secrets are dropped silently — the app
   * falls back to guest browsing for that instance.
   */
  async init(): Promise<void> {
    const reddit = this.factories.createReddit();
    this.redditKeyCache = adapterKey("reddit", reddit.instance);
    this.registry.set(this.redditKeyCache, reddit);

    await migrateLegacyIfNeeded();
    const [stored, browse] = await Promise.all([
      loadAccounts(),
      loadBrowseInstances(),
    ]);

    const lemmyInstances = new Set<string>([
      this.defaultLemmyInstance,
      ...browse.map((i) => i.toLowerCase()),
      ...stored
        .filter((a) => a.ref.source === "lemmy")
        .map((a) => a.ref.instance.toLowerCase()),
    ]);
    for (const inst of lemmyInstances) this.ensureLemmy(inst);

    await Promise.all(stored.map((acc) => this.restoreStored(acc)));
  }

  private async restoreStored(acc: StoredAccount): Promise<void> {
    const adapter = this.registry.get(
      adapterKey(acc.ref.source, acc.ref.instance),
    );
    if (!adapter) return;
    try {
      if (this.onBeforeRestore) await this.onBeforeRestore(acc.ref);
      const account = await adapter.restore(acc.secret);
      if (account.isGuest) await removeAccount(acc.ref.id); // secret was stale
    } catch {
      await removeAccount(acc.ref.id);
    }
  }

  /** Create + register a Lemmy adapter for `instance` if not already present. */
  private ensureLemmy(instance: string): SourceAdapter {
    const key = adapterKey("lemmy", instance);
    let adapter = this.registry.get(key);
    if (!adapter) {
      adapter = this.factories.createLemmy(instance.toLowerCase());
      this.registry.set(key, adapter);
    }
    return adapter;
  }

  get redditKey(): AdapterKey {
    if (!this.redditKeyCache)
      throw new Error("AccountManager.init() must run before redditKey");
    return this.redditKeyCache;
  }

  reddit(): SourceAdapter {
    const a = this.registry.get(this.redditKey);
    if (!a) throw new Error("Reddit adapter missing — init() not run");
    return a;
  }

  get(key: AdapterKey): SourceAdapter | undefined {
    return this.registry.get(key);
  }

  /**
   * Resolve the adapter that owns an entity's origin. For a Lemmy instance we've
   * never seen, lazily spin up a guest adapter so federated content from
   * unknown instances is still at least readable.
   */
  adapterForEntity(e: { source: SourceKind; instance: string }): SourceAdapter {
    const existing = this.registry.get(keyForEntity(e));
    if (existing) return existing;
    if (e.source === "lemmy") return this.ensureLemmy(e.instance);
    return this.reddit();
  }

  allAdapters(): SourceAdapter[] {
    return Array.from(this.registry.values());
  }

  lemmyAdapters(): SourceAdapter[] {
    return this.allAdapters().filter((a) => a.source === "lemmy");
  }

  /** Every adapter currently signed in (non-guest) — the fan-out set for "Subscribed". */
  signedInAdapters(): SourceAdapter[] {
    return this.allAdapters().filter((a) => !a.account.isGuest);
  }

  /** Public, de-duplicated list of signed-in identities for the UI. */
  accounts(): AccountRef[] {
    return this.signedInAdapters().map((a) => a.account);
  }

  /** Add a Lemmy instance to browse without (yet) logging in. */
  async addBrowseInstance(instance: string): Promise<SourceAdapter> {
    const adapter = this.ensureLemmy(instance);
    await addBrowseInstance(instance);
    return adapter;
  }

  /** Synchronously ensure a Lemmy adapter exists (persisting the choice in the background). */
  ensureLemmyInstance(instance: string): SourceAdapter {
    const adapter = this.ensureLemmy(instance);
    void addBrowseInstance(instance);
    return adapter;
  }

  /**
   * The Lemmy adapter back-compat single-source UI should treat as "the" Lemmy
   * adapter: a signed-in one if any, else the default instance, else whatever
   * exists. Multi-account surfaces (feed/scope/settings) ignore this and use the
   * full {@link lemmyAdapters} list instead.
   */
  primaryLemmy(preferInstance?: string): SourceAdapter {
    const all = this.lemmyAdapters();
    if (preferInstance) {
      const pinned = this.get(adapterKey("lemmy", preferInstance));
      if (pinned) return pinned;
    }
    return (
      all.find((a) => !a.account.isGuest) ??
      this.get(adapterKey("lemmy", this.defaultLemmyInstance)) ??
      all[0]
    );
  }

  /**
   * Persist a freshly-authenticated account and make sure its adapter is the one
   * holding the live credentials. Called by the login flows on success.
   */
  async onLoginSuccess(
    account: AccountRef,
    secret: SecretBundle,
  ): Promise<void> {
    if (account.source === "lemmy") this.ensureLemmy(account.instance);
    await upsertAccount({ ref: account, secret });
    if (account.source === "lemmy") await addBrowseInstance(account.instance);
  }

  /** Log out a single account; its adapter reverts to guest for that origin. */
  async logout(account: AccountRef): Promise<void> {
    const adapter = this.registry.get(
      adapterKey(account.source, account.instance),
    );
    if (adapter) {
      try {
        await adapter.logout();
      } catch {
        /* best-effort */
      }
    }
    await removeAccount(account.id);
  }
}

export { accountId };
