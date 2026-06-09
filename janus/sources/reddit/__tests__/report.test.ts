import { RedditAdapter } from "../reddit-adapter";
import type { RedditTransport } from "../transport";
import { rid } from "../mappers/shared";

/** Adapter whose transport records every request (url + options). */
function captureAdapter() {
  const calls: { url: string; body?: unknown; method?: string }[] = [];
  const transport = {
    request: async (
      url: string,
      opts?: { method?: string; body?: unknown },
    ) => {
      calls.push({ url, method: opts?.method, body: opts?.body });
      return {};
    },
  } as unknown as RedditTransport;
  return { adapter: new RedditAdapter({ transport }), calls };
}

describe("RedditAdapter.reportContent", () => {
  it("POSTs /api/report with the thing fullname + reason", async () => {
    const { adapter, calls } = captureAdapter();
    await adapter.reportContent(rid("post", "t3_abc"), "spam");
    expect(calls[0].url).toContain("/api/report");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ thing_id: "t3_abc", reason: "spam" });
  });

  it("truncates the reason to Reddit's 100-char limit", async () => {
    const { adapter, calls } = captureAdapter();
    await adapter.reportContent(rid("comment", "t1_xyz"), "x".repeat(250));
    expect((calls[0].body as { reason: string }).reason).toHaveLength(100);
  });
});
