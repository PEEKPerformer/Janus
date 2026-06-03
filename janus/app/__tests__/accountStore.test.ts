/**
 * In-memory SecureStore so persistence is deterministic in node.
 */
import {
  loadAccounts,
  upsertAccount,
  removeAccount,
  loadBrowseInstances,
  addBrowseInstance,
  migrateLegacyIfNeeded,
  accountId,
  type StoredAccount,
} from "../accountStore";

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

const acct = (instance: string, username: string): StoredAccount => ({
  ref: {
    id: accountId("lemmy", instance, username),
    source: "lemmy",
    instance,
    username,
    isGuest: false,
  },
  secret: { source: "lemmy", jwt: `jwt-${username}` },
});

beforeEach(() => mockStore.clear());

describe("accountStore", () => {
  it("upserts by id (no duplicate accounts for the same identity)", async () => {
    await upsertAccount(acct("hexbear.net", "alice"));
    await upsertAccount(acct("lemmy.ml", "alice"));
    await upsertAccount(acct("hexbear.net", "alice")); // same id → replace
    const list = await loadAccounts();
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.ref.instance).sort()).toEqual([
      "hexbear.net",
      "lemmy.ml",
    ]);
  });

  it("removes an account by id", async () => {
    await upsertAccount(acct("hexbear.net", "alice"));
    await upsertAccount(acct("lemmy.ml", "bob"));
    await removeAccount(accountId("lemmy", "hexbear.net", "alice"));
    const list = await loadAccounts();
    expect(list.map((a) => a.ref.username)).toEqual(["bob"]);
  });

  it("dedupes and lowercases browse instances", async () => {
    await addBrowseInstance("Hexbear.net");
    await addBrowseInstance("hexbear.net");
    await addBrowseInstance("lemmy.ml");
    expect((await loadBrowseInstances()).sort()).toEqual([
      "hexbear.net",
      "lemmy.ml",
    ]);
  });

  it("ignores corrupt stored entries", async () => {
    const SecureStore = require("expo-secure-store");
    await SecureStore.setItemAsync(
      "janus.accounts.v1",
      JSON.stringify([{ junk: true }, acct("lemmy.ml", "real")]),
    );
    const list = await loadAccounts();
    expect(list).toHaveLength(1);
    expect(list[0].ref.username).toBe("real");
  });

  describe("legacy migration", () => {
    it("imports a single legacy lemmySession + instance once", async () => {
      const SecureStore = require("expo-secure-store");
      await SecureStore.setItemAsync("lemmyInstance", "hexbear.net");
      await SecureStore.setItemAsync(
        "lemmySession",
        JSON.stringify({
          instance: "hexbear.net",
          username: "comrade",
          jwt: "legacy-jwt",
        }),
      );

      await migrateLegacyIfNeeded();

      const list = await loadAccounts();
      expect(list).toHaveLength(1);
      expect(list[0].ref.username).toBe("comrade");
      expect(list[0].secret).toEqual({ source: "lemmy", jwt: "legacy-jwt" });
      expect(await loadBrowseInstances()).toContain("hexbear.net");
    });

    it("is idempotent — a second run doesn't clobber multi-account data", async () => {
      const SecureStore = require("expo-secure-store");
      await SecureStore.setItemAsync(
        "lemmySession",
        JSON.stringify({
          instance: "hexbear.net",
          username: "comrade",
          jwt: "legacy-jwt",
        }),
      );
      await migrateLegacyIfNeeded();
      // user then adds a second account
      await upsertAccount(acct("lemmy.ml", "bob"));
      await migrateLegacyIfNeeded(); // should be a no-op now
      const list = await loadAccounts();
      expect(list.map((a) => a.ref.username).sort()).toEqual([
        "bob",
        "comrade",
      ]);
    });

    it("marks migration done even with no legacy session", async () => {
      await migrateLegacyIfNeeded();
      const SecureStore = require("expo-secure-store");
      expect(await SecureStore.getItemAsync("janus.accounts.v1")).toBe("[]");
    });
  });
});
