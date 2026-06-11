/**
 * Guards the archive pipeline against the SHAPE of real provider responses,
 * captured live from PullPush and Arctic Shift (see __fixtures__/archiveSamples.json,
 * bodies trimmed). If a provider changes its JSON, these break — unlike the
 * hand-written fixtures, which only prove the code is self-consistent.
 */
import samples from "../__fixtures__/archiveSamples.json";
import {
  archiveAuthorContent,
  archiveThreadComments,
  type ArchiveFetch,
} from "../archiveClient";
import {
  archivedPostToPost,
  archivedCommentToComment,
} from "../mappers/archive";
import { rid } from "../mappers/shared";

const serve =
  (data: unknown[]): ArchiveFetch =>
  async () => ({ status: 200, json: async () => ({ data }) });

describe("archive client against real provider payloads", () => {
  it("parses real PullPush submissions (float created_utc, name present)", async () => {
    const res = await archiveAuthorContent(
      "posts",
      "spez",
      { limit: 50 },
      serve(samples.pullpush_submissions),
    );
    expect(res.items.length).toBe(2);
    const r = res.items[0];
    expect(r.fullname).toBe("t3_1kfciml");
    expect(r.author).toBe("spez");
    expect(r.subreddit).toBe("u_spez");
    expect(typeof r.title).toBe("string");
    // 1746454083(.0) s → ms, regardless of int/float across the two records.
    expect(r.createdAt).toBe(1746454083000);
  });

  it("parses real PullPush comments and carries link_id for threading", async () => {
    const res = await archiveAuthorContent(
      "comments",
      "spez",
      { limit: 50 },
      serve(samples.pullpush_comments),
    );
    const r = res.items[0];
    expect(r.fullname).toMatch(/^t1_/);
    expect(r.linkId).toBe("t3_1kfciml");
    expect(typeof r.body).toBe("string");
  });

  it("parses real Arctic Shift submissions (int created_utc, _meta ignored)", async () => {
    const res = await archiveAuthorContent(
      "posts",
      "spez",
      { limit: 50 },
      serve(samples.arcticshift_submissions),
    );
    expect(res.items.every((i) => i.fullname.startsWith("t3_"))).toBe(true);
    expect(res.items[0].createdAt).toBeGreaterThan(1_700_000_000_000);
  });

  it("parses a real Arctic Shift thread-comment page", async () => {
    const res = await archiveThreadComments(
      "t3_1kfciml",
      {},
      serve(samples.arcticshift_thread_comments),
    );
    expect(res.items.length).toBe(2);
    expect(res.items.every((i) => i.linkId === "t3_1kfciml")).toBe(true);
  });
});

describe("mappers against real records", () => {
  it("maps a real submission to a Post with archive provenance", () => {
    const res = archiveAuthorContent(
      "posts",
      "spez",
      { limit: 50 },
      serve(samples.pullpush_submissions),
    );
    return res.then((page) => {
      const post = archivedPostToPost(page.items[0], "pullpush");
      expect(post.source).toBe("reddit");
      expect(post.id).toBe(rid("post", "t3_1kfciml"));
      expect(post.author.username).toBe("spez");
      expect(post.ext).toMatchObject({
        archived: { source: "pullpush", reason: "hidden" },
      });
      expect(post.interactionStatus).toBe("archived");
    });
  });

  it("maps a real comment to a Comment under the right thread", async () => {
    const page = await archiveThreadComments(
      "t3_1kfciml",
      {},
      serve(samples.arcticshift_thread_comments),
    );
    const postId = rid("post", "t3_1kfciml");
    const comment = archivedCommentToComment(
      page.items[0],
      postId,
      "arctic-shift",
      "moderator-removed",
    );
    expect(comment.postId).toBe(postId);
    expect(comment.body.text).toBeTruthy();
    expect(comment.ext).toMatchObject({
      archived: { source: "arctic-shift", reason: "moderator-removed" },
    });
  });
});
