// Runs after the test framework is installed (setupFilesAfterEnv), so the
// framework globals are available here. Clears every MMKV-backed store between
// tests, so module-level SwrCache instances (comments, wiki, community about…)
// don't leak cached values across test cases.
afterEach(() => {
  const stores = globalThis.__mmkvStores;
  if (Array.isArray(stores)) for (const m of stores) m.clear();
  // The connectivity store infers offline from failure streaks (module
  // state) — a test that exercises network failures must not leave the next
  // test "offline".
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./janus/app/offline").__resetOffline();
  } catch {
    /* suite may not transpile app code — fine */
  }
});
