import {
  flattenRedditMessages,
  mapRedditMessage,
  groupConversations,
  threadWith,
} from "../mappers/message";

/** A t4 message Thing, optionally with nested replies. */
function t4(
  name: string,
  author: string,
  dest: string,
  body: string,
  createdUtc: number,
  isNew: boolean,
  replies: any[] = [],
) {
  return {
    kind: "t4",
    data: {
      name,
      author,
      dest,
      body,
      body_html: `<p>${body}</p>`,
      created_utc: createdUtc,
      new: isNew,
      replies: replies.length
        ? { kind: "Listing", data: { children: replies } }
        : "",
    },
  };
}

describe("reddit message mapper", () => {
  const me = "alice";

  it("flattens nested reply threads depth-first", () => {
    const tree = [
      t4("t4_1", "bob", "alice", "hi alice", 100, false, [
        t4("t4_2", "alice", "bob", "hi bob", 200, false, [
          t4("t4_3", "bob", "alice", "how are you", 300, true),
        ]),
      ]),
    ];
    const flat = flattenRedditMessages(tree);
    expect(flat.map((d) => d.name)).toEqual(["t4_1", "t4_2", "t4_3"]);
  });

  it("maps fromMe based on the signed-in username (case-insensitive)", () => {
    const sent = mapRedditMessage(
      {
        name: "t4_2",
        author: "Alice",
        dest: "bob",
        created_utc: 200,
        body: "x",
      },
      me,
    );
    const received = mapRedditMessage(
      {
        name: "t4_1",
        author: "bob",
        dest: "alice",
        created_utc: 100,
        body: "y",
      },
      me,
    );
    expect(sent.fromMe).toBe(true);
    expect(sent.to.handle).toBe("u/bob");
    expect(received.fromMe).toBe(false);
    expect(received.read).toBe(true); // `new` absent -> read
  });

  it("groups a flat list into conversations, newest first, with unread counts", () => {
    const flat = flattenRedditMessages([
      t4("t4_1", "bob", "alice", "hi", 100, false),
      t4("t4_2", "alice", "bob", "hello", 200, false),
      t4("t4_3", "carol", "alice", "yo", 300, true),
      t4("t4_4", "bob", "alice", "you there?", 400, true),
    ]).map((d) => mapRedditMessage(d, me));

    const convos = groupConversations(flat);
    expect(convos.map((c) => c.correspondent.username)).toEqual([
      "bob",
      "carol",
    ]);
    const bob = convos.find((c) => c.correspondent.username === "bob")!;
    expect(bob.lastMessage.body.text).toBe("you there?");
    expect(bob.unreadCount).toBe(1); // only the unread inbound one
  });

  it("threadWith returns one correspondent's messages oldest-first", () => {
    const flat = flattenRedditMessages([
      t4("t4_1", "bob", "alice", "1", 100, false),
      t4("t4_2", "carol", "alice", "2", 150, false),
      t4("t4_3", "alice", "bob", "3", 200, false),
    ]).map((d) => mapRedditMessage(d, me));

    const thread = threadWith(flat, "bob");
    expect(thread.map((m) => m.body.text)).toEqual(["1", "3"]);
  });
});
