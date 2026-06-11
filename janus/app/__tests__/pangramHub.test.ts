import {
  fetchRepoInfo,
  fileUrl,
  gateMessage,
  HubError,
  PANGRAM_REPO,
  PANGRAM_REVISION,
  validateToken,
  type HubFetch,
} from "../pangramHub";

const response = (status: number, body: unknown = {}) => ({
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const repoBody = {
  sha: "f93e1ace74528cfb48f337ab2fe946fb71a728cb",
  siblings: [
    { rfilename: "config.json" },
    { rfilename: "vocab.json" },
    { rfilename: "merges.txt" },
    { rfilename: "model.safetensors" },
    { rfilename: "README.md" },
  ],
  usedStorage: 1_421_503_560,
};

describe("fetchRepoInfo", () => {
  it("pins installs to the VALIDATED revision even when HEAD moved", async () => {
    const moved = { ...repoBody, sha: "someNewUpstreamPush123" };
    const info = await fetchRepoInfo("hf_x", async () => response(200, moved));
    // The manifests were generated from this exact revision; an upstream
    // weight push must never flow into installs untested.
    expect(info.sha).toBe(PANGRAM_REVISION);
  });

  it("returns revision-pinned metadata and sends the bearer token", async () => {
    const fetchImpl: HubFetch = jest.fn(async () => response(200, repoBody));
    const info = await fetchRepoInfo("hf_abc", fetchImpl);
    expect(info.sha).toBe(PANGRAM_REVISION);
    expect(info.weightsBytes).toBe(repoBody.usedStorage);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://huggingface.co/api/models/${PANGRAM_REPO}`,
      { headers: { Authorization: "Bearer hf_abc" } },
    );
  });

  it("maps 401 to invalid-token with actionable copy", async () => {
    await expect(
      fetchRepoInfo("bad", async () => response(401)),
    ).rejects.toMatchObject({ gate: "invalid-token" });
  });

  it("maps 403 to gate-not-accepted (the license step)", async () => {
    const err = await fetchRepoInfo("hf_ok", async () => response(403)).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(HubError);
    expect(err.gate).toBe("gate-not-accepted");
    expect(err.message).toMatch(/license/i);
  });

  it("rejects repos missing required files", async () => {
    const body = { ...repoBody, siblings: [{ rfilename: "config.json" }] };
    await expect(
      fetchRepoInfo("hf_ok", async () => response(200, body)),
    ).rejects.toThrow(/missing expected files/);
  });

  it("treats other failures as transport errors, not gate errors", async () => {
    const err = await fetchRepoInfo("hf_ok", async () => response(500)).catch(
      (e) => e,
    );
    expect(err).not.toBeInstanceOf(HubError);
  });
});

describe("fileUrl / validateToken / gateMessage", () => {
  it("pins downloads to the revision", () => {
    expect(fileUrl("abc123", "model.safetensors")).toBe(
      `https://huggingface.co/${PANGRAM_REPO}/resolve/abc123/model.safetensors`,
    );
  });

  it("validateToken reports the username on success and ok:false otherwise", async () => {
    await expect(
      validateToken("hf_x", async () => response(200, { name: "brenden" })),
    ).resolves.toEqual({ ok: true, username: "brenden" });
    await expect(
      validateToken("hf_x", async () => response(401)),
    ).resolves.toEqual({ ok: false });
  });

  it("every gate status has user-facing copy", () => {
    expect(gateMessage("invalid-token")).toMatch(/token/i);
    expect(gateMessage("gate-not-accepted")).toMatch(/model page/i);
    expect(gateMessage("not-found")).toMatch(/repo/i);
  });
});
