import { notificationTarget } from "../inboxTarget";
import type { Notification } from "../../core/model";

const reddit = (permalink?: string): Notification =>
  ({
    source: "reddit",
    instance: "www.reddit.com",
    contextRoute: permalink
      ? {
          source: "reddit",
          instance: "www.reddit.com",
          kind: "post",
          params: { permalink },
        }
      : undefined,
  }) as unknown as Notification;

const lemmy = (params?: Record<string, string>): Notification =>
  ({
    source: "lemmy",
    instance: "lemmy.world",
    contextRoute: params
      ? { source: "lemmy", instance: "lemmy.world", kind: "post", params }
      : undefined,
  }) as unknown as Notification;

describe("notificationTarget", () => {
  it("reddit: extracts post AND comment from the context permalink", () => {
    const t = notificationTarget(
      reddit("/r/churning/comments/1abc23/daily_thread/mxyz89/?context=3"),
    );
    expect(t?.postId).toBe("reddit:www.reddit.com:post:1abc23");
    expect(t?.commentId).toBe("reddit:www.reddit.com:comment:t1_mxyz89");
  });

  it("reddit: a post-only permalink has no commentId", () => {
    const t = notificationTarget(reddit("/r/churning/comments/1abc23/"));
    expect(t?.postId).toBe("reddit:www.reddit.com:post:1abc23");
    expect(t?.commentId).toBeUndefined();
  });

  it("lemmy: uses the stored post id and commentId params", () => {
    const t = notificationTarget(lemmy({ id: "777", commentId: "4242" }));
    expect(t?.postId).toBe("lemmy:lemmy.world:post:777");
    expect(t?.commentId).toBe("lemmy:lemmy.world:comment:4242");
  });

  it("lemmy: missing commentId (old notifications) still opens the post", () => {
    const t = notificationTarget(lemmy({ id: "777" }));
    expect(t?.postId).toBe("lemmy:lemmy.world:post:777");
    expect(t?.commentId).toBeUndefined();
  });

  it("returns null without a context route or parsable ids", () => {
    expect(notificationTarget(reddit(undefined))).toBeNull();
    expect(notificationTarget(reddit("/r/churning/wiki/index"))).toBeNull();
    expect(notificationTarget(lemmy({}))).toBeNull();
  });
});
