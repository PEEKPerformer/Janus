// Runs after the test framework is installed (setupFilesAfterEnv), so the
// framework globals are available here. Clears every MMKV-backed store between
// tests, so module-level SwrCache instances (comments, wiki, community about…)
// don't leak cached values across test cases.
afterEach(() => {
  const stores = globalThis.__mmkvStores;
  if (Array.isArray(stores)) for (const m of stores) m.clear();
});
