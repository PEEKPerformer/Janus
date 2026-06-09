import { RedditAdapter } from "../reddit-adapter";
import type { RedditTransport } from "../transport";
import { rid } from "../mappers/shared";
import { GatedContentError } from "../../../core/errors";

function adapterReturning(response: unknown) {
  const calls: { url: string; body?: unknown; method?: string }[] = [];
  const transport = {
    request: async (
      url: string,
      opts?: { method?: string; body?: unknown },
    ) => {
      calls.push({ url, method: opts?.method, body: opts?.body });
      return response;
    },
  } as unknown as RedditTransport;
  return { adapter: new RedditAdapter({ transport }), calls };
}

describe("RedditAdapter gated/quarantined feeds", () => {
  it("throws GatedContentError (quarantine) when the listing is a warning", async () => {
    const { adapter } = adapterReturning({
      quarantine_message: "This community may contain sensitive content.",
    });
    const err = await adapter
      .getFeed({ communityId: rid("community", "drama"), sort: "hot" }, {})
      .catch((e) => e);
    expect(err).toBeInstanceOf(GatedContentError);
    expect(err.optInKind).toBe("quarantine");
    expect(err.communityName).toBe("drama");
    expect(err.warning).toContain("sensitive");
  });

  it("classifies interstitial_warning_message as 'gated'", async () => {
    const { adapter } = adapterReturning({
      interstitial_warning_message: "18+ only.",
    });
    const err = await adapter
      .getFeed({ communityId: rid("community", "x"), sort: "hot" }, {})
      .catch((e) => e);
    expect(err).toBeInstanceOf(GatedContentError);
    expect(err.optInKind).toBe("gated");
  });

  it("does NOT throw when a real listing is present", async () => {
    const { adapter } = adapterReturning({
      data: { children: [], after: null },
      quarantine_message: "ignored because children exist",
    });
    const page = await adapter.getFeed(
      { communityId: rid("community", "x"), sort: "hot" },
      {},
    );
    expect(page.items).toEqual([]);
  });

  it("optInToCommunity POSTs the accept to the right endpoint", async () => {
    const { adapter, calls } = adapterReturning("ok");
    await adapter.optInToCommunity(rid("community", "drama"), "quarantine");
    expect(calls[0].url).toContain("/quarantine");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ sr_name: "drama", accept: "yes" });
  });
});
