import { AccountManager, adapterKey, keyForEntity } from "../AccountManager";
import { upsertAccount, accountId, type StoredAccount } from "../accountStore";
import type {
  SourceAdapter,
  AccountRef,
  SecretBundle,
} from "../../core/adapter";
import { buildId, type SourceKind } from "../../core/ids";

const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

/**
 * Minimal fake adapter: only the surface AccountManager touches (source,
 * instance, account, restore, logout). `restoreBehavior` lets a test simulate a
 * good JWT, a stale one (returns guest), or a thrown error.
 */
function fakeAdapter(
  source: SourceKind,
  instance: string,
  restoreBehavior: "ok" | "stale" | "throw" = "ok",
): SourceAdapter {
  const guest: AccountRef = {
    id: buildId({ source, instance, kind: "user", nativeId: "__guest__" }),
    source,
    instance,
    username: "guest",
    isGuest: true,
  };
  const a: Partial<SourceAdapter> & { account: AccountRef } = {
    source,
    instance,
    account: guest,
    async restore(secret: SecretBundle) {
      if (restoreBehavior === "throw") throw new Error("network");
      if (restoreBehavior === "stale") {
        a.account = guest;
        return guest;
      }
      a.account = {
        id: accountId(source, instance, "alice"),
        source,
        instance,
        username: "alice",
        isGuest: false,
      };
      void secret;
      return a.account;
    },
    async logout() {
      a.account = guest;
    },
  };
  return a as SourceAdapter;
}

function makeManager(restoreBehavior: "ok" | "stale" | "throw" = "ok") {
  const created: Record<string, SourceAdapter> = {};
  const factories = {
    createReddit: () => {
      const a = fakeAdapter("reddit", "www.reddit.com", restoreBehavior);
      created["reddit"] = a;
      return a;
    },
    createLemmy: (instance: string) => {
      const a = fakeAdapter("lemmy", instance, restoreBehavior);
      created[`lemmy:${instance}`] = a;
      return a;
    },
  };
  const mgr = new AccountManager({
    factories,
    defaultLemmyInstance: "lemmy.ml",
  });
  return { mgr, created };
}

const lemmyAccount = (instance: string): StoredAccount => ({
  ref: {
    id: accountId("lemmy", instance, "alice"),
    source: "lemmy",
    instance,
    username: "alice",
    isGuest: false,
  },
  secret: { source: "lemmy", jwt: `jwt-${instance}` },
});

beforeEach(() => mockStore.clear());

describe("adapterKey / keyForEntity", () => {
  it("keys by source:instance, lowercased", () => {
    expect(adapterKey("lemmy", "HexBear.net")).toBe("lemmy:hexbear.net");
    expect(keyForEntity({ source: "reddit", instance: "www.reddit.com" })).toBe(
      "reddit:www.reddit.com",
    );
  });
});

describe("AccountManager.init", () => {
  it("always registers Reddit + the default Lemmy instance", async () => {
    const { mgr } = makeManager();
    await mgr.init();
    expect(mgr.reddit().source).toBe("reddit");
    expect(mgr.get("lemmy:lemmy.ml")).toBeTruthy();
  });

  it("restores every stored account and signs them in", async () => {
    await upsertAccount(lemmyAccount("hexbear.net"));
    await upsertAccount(lemmyAccount("lemmy.ml"));
    const { mgr } = makeManager("ok");
    await mgr.init();
    const instances = mgr
      .accounts()
      .map((a) => a.instance)
      .sort();
    expect(instances).toEqual(["hexbear.net", "lemmy.ml"]);
    expect(mgr.signedInAdapters()).toHaveLength(2);
  });

  it("drops accounts whose secret is stale on restore", async () => {
    await upsertAccount(lemmyAccount("hexbear.net"));
    const { mgr } = makeManager("stale");
    await mgr.init();
    expect(mgr.accounts()).toHaveLength(0);
    // the adapter still exists for guest browsing, just not signed in
    expect(mgr.get("lemmy:hexbear.net")).toBeTruthy();
  });

  it("drops accounts whose restore throws", async () => {
    await upsertAccount(lemmyAccount("hexbear.net"));
    const { mgr } = makeManager("throw");
    await mgr.init();
    expect(mgr.accounts()).toHaveLength(0);
  });
});

describe("adapterForEntity — routing by origin", () => {
  it("routes an action to the adapter that owns the entity's instance", async () => {
    await upsertAccount(lemmyAccount("hexbear.net"));
    await upsertAccount(lemmyAccount("lemmy.ml"));
    const { mgr } = makeManager("ok");
    await mgr.init();

    const hexPost = { source: "lemmy" as const, instance: "hexbear.net" };
    const mlPost = { source: "lemmy" as const, instance: "lemmy.ml" };
    expect(mgr.adapterForEntity(hexPost).instance).toBe("hexbear.net");
    expect(mgr.adapterForEntity(mlPost).instance).toBe("lemmy.ml");
    expect(mgr.adapterForEntity(hexPost)).not.toBe(
      mgr.adapterForEntity(mlPost),
    );
  });

  it("lazily creates a guest adapter for an unknown federated instance", async () => {
    const { mgr } = makeManager("ok");
    await mgr.init();
    const adapter = mgr.adapterForEntity({
      source: "lemmy",
      instance: "feddit.org",
    });
    expect(adapter.instance).toBe("feddit.org");
    expect(mgr.get("lemmy:feddit.org")).toBe(adapter);
  });

  it("routes Reddit entities to the single Reddit adapter", async () => {
    const { mgr } = makeManager("ok");
    await mgr.init();
    expect(
      mgr.adapterForEntity({ source: "reddit", instance: "www.reddit.com" }),
    ).toBe(mgr.reddit());
  });
});

describe("login / logout lifecycle", () => {
  it("persists a new account on login and exposes it", async () => {
    const { mgr } = makeManager("ok");
    await mgr.init();
    const account: AccountRef = {
      id: accountId("lemmy", "lemmygrad.ml", "comrade"),
      source: "lemmy",
      instance: "lemmygrad.ml",
      username: "comrade",
      isGuest: false,
    };
    await mgr.onLoginSuccess(account, { source: "lemmy", jwt: "fresh" });
    expect(mgr.get("lemmy:lemmygrad.ml")).toBeTruthy();
    // re-init from disk to prove it persisted
    const { mgr: mgr2 } = makeManager("ok");
    await mgr2.init();
    expect(mgr2.accounts().map((a) => a.instance)).toContain("lemmygrad.ml");
  });

  it("logging out reverts the adapter to guest and forgets the account", async () => {
    await upsertAccount(lemmyAccount("hexbear.net"));
    const { mgr } = makeManager("ok");
    await mgr.init();
    const account = mgr.accounts().find((a) => a.instance === "hexbear.net")!;
    await mgr.logout(account);
    expect(mgr.get("lemmy:hexbear.net")!.account.isGuest).toBe(true);
    const { mgr: mgr2 } = makeManager("ok");
    await mgr2.init();
    expect(mgr2.accounts()).toHaveLength(0);
  });
});
