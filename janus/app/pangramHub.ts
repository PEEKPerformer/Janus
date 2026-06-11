/**
 * Hugging Face Hub client for the gated Open Pangram checkpoint.
 *
 * Open Pangram (pangram/editlens_roberta-large) is a 355M-param
 * RobertaForSequenceClassification that grades text into K levels of AI
 * pervasiveness (EditLens, ICLR 2026). The repo is *manually gated* on the
 * Hub and licensed CC BY-NC-SA 4.0 (non-commercial), so Janus never ships or
 * proxies a byte of it: the user accepts the license on huggingface.co with
 * their own account, pastes a read token here, and the app downloads the
 * checkpoint straight from the Hub onto their device.
 *
 * This module is pure URL/JSON logic over an injected fetch — no IO of its
 * own — so the gate handling is fully unit-tested.
 */

export const PANGRAM_REPO = "pangram/editlens_roberta-large";
export const PANGRAM_REPO_URL = `https://huggingface.co/${PANGRAM_REPO}`;
export const PANGRAM_LICENSE = "CC BY-NC-SA 4.0 (non-commercial)";

/** Files the detector needs, in download order (small first, weights last). */
export const REQUIRED_FILES = [
  "config.json",
  "vocab.json",
  "merges.txt",
  "model.safetensors",
] as const;
export type RequiredFile = (typeof REQUIRED_FILES)[number];

export interface RepoInfo {
  /** Revision the file URLs are pinned to, so a mid-download repo push can't mix revisions. */
  sha: string;
  /** Files present in the repo. */
  files: string[];
  /** Total bytes of the safetensors weights, when the API reports it. */
  weightsBytes?: number;
}

export type HubFetch = (
  url: string,
  init?: { headers?: Record<string, string>; method?: string },
) => Promise<{
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Why a Hub call failed, in terms the setup screen can speak to the user. */
export type HubGateStatus =
  | "ok"
  | "invalid-token" // 401 — token missing/expired/revoked
  | "gate-not-accepted" // 403 — token valid but license not accepted (or pending review)
  | "not-found"; // repo moved/renamed

export class HubError extends Error {
  constructor(
    public gate: Exclude<HubGateStatus, "ok">,
    message: string,
  ) {
    super(message);
    this.name = "HubError";
  }
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token.trim()}`,
});

function gateFromStatus(status: number): HubGateStatus {
  if (status === 401) return "invalid-token";
  if (status === 403) return "gate-not-accepted";
  if (status === 404) return "not-found";
  return "ok";
}

/** Human copy for each gate failure — shown verbatim by the setup screen. */
export function gateMessage(gate: Exclude<HubGateStatus, "ok">): string {
  switch (gate) {
    case "invalid-token":
      return "Hugging Face rejected the token. Create a read token at huggingface.co/settings/tokens and paste it again.";
    case "gate-not-accepted":
      return "Your token works, but this model is gated. Open the model page and agree to the non-commercial license — approval is manual on Pangram's side and can take days, sometimes weeks. Everything here will be ready when it opens.";
    case "not-found":
      return "The model repo wasn't found — it may have moved. Check huggingface.co/pangram.";
  }
}

/** Validate a token without touching the gated repo (hits /api/whoami-v2). */
export async function validateToken(
  token: string,
  fetchImpl: HubFetch,
): Promise<{ ok: boolean; username?: string }> {
  const res = await fetchImpl("https://huggingface.co/api/whoami-v2", {
    headers: authHeaders(token),
  });
  if (res.status !== 200) return { ok: false };
  const body = (await res.json()) as { name?: string };
  return { ok: true, username: body.name };
}

/**
 * Fetch repo metadata with the user's token. Throws HubError with a
 * user-speakable gate status on 401/403/404; other non-200s throw plain
 * Errors (transport problems, retryable).
 */
export async function fetchRepoInfo(
  token: string,
  fetchImpl: HubFetch,
): Promise<RepoInfo> {
  const res = await fetchImpl(
    `https://huggingface.co/api/models/${PANGRAM_REPO}`,
    { headers: authHeaders(token) },
  );
  const gate = gateFromStatus(res.status);
  if (gate !== "ok") throw new HubError(gate, gateMessage(gate));
  if (res.status !== 200)
    throw new Error(`Hub metadata request failed (HTTP ${res.status})`);
  const body = (await res.json()) as {
    sha?: string;
    siblings?: { rfilename: string }[];
    usedStorage?: number;
  };
  if (!body.sha || !Array.isArray(body.siblings))
    throw new Error("Hub metadata response was malformed");
  const files = body.siblings.map((s) => s.rfilename);
  const missing = REQUIRED_FILES.filter((f) => !files.includes(f));
  if (missing.length)
    throw new Error(
      `Model repo is missing expected files: ${missing.join(", ")}`,
    );
  return { sha: body.sha, files, weightsBytes: body.usedStorage };
}

/** Revision-pinned download URL for one repo file. */
export function fileUrl(sha: string, name: RequiredFile): string {
  return `${PANGRAM_REPO_URL}/resolve/${sha}/${encodeURIComponent(name)}`;
}

export { authHeaders as hubAuthHeaders };
