import React from "react";
import { Alert, Share } from "react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { PostScreen } from "../screens/PostScreen";
import {
  renderWithAdapters,
  makeAdapters,
  mockNavigation,
  mockRoute,
} from "./testUtils";
import { mapLemmyPost, mapLemmyComment } from "../../sources/lemmy/mappers";
import {
  lemmyListFixture,
  lemmyCommentsFixture,
} from "../../sources/lemmy/__fixtures__/lemmySamples";
import { NotAuthenticatedError } from "../../core/errors";
import { buildId } from "../../core/ids";
import { Vote } from "../../core/vote";
import { __setOffline } from "../../app/offline";
import { beginPack, upsertPackedItem } from "../../app/offlinePack";
import { SettingsProvider } from "../SettingsContext";
import { DEFAULT_SETTINGS } from "../../app/settingsStore";
import type { Comment } from "../../core/model";

const post = mapLemmyPost(lemmyListFixture.posts[0], "lemmy.world");
const comments = lemmyCommentsFixture.comments.map((cv: unknown) =>
  mapLemmyComment(cv, post.id, "lemmy.world"),
);

const props = {
  navigation: mockNavigation as any,
  route: mockRoute({ post }) as any,
};

describe("PostScreen", () => {
  it("renders the post and its comment tree", async () => {
    const adapters = makeAdapters({
      lemmy: { getComments: async () => ({ items: comments }) },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    expect(screen.getByText("A local image post")).toBeTruthy(); // header from route param
    expect(await screen.findByText("OP top comment")).toBeTruthy();
    expect(screen.getByText("A reply")).toBeTruthy(); // nested
  });

  it("offline: labels the thread as cached instead of looking frozen", async () => {
    __setOffline(true);
    const adapters = makeAdapters({
      lemmy: { getComments: async () => ({ items: comments }) },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    expect(
      await screen.findByText("Offline — showing cached comments"),
    ).toBeTruthy();
  });

  it("recovers a [removed] comment body from the archive on tap", async () => {
    const removed: Comment = {
      ...comments[0],
      body: { text: "[removed]" },
    };
    const recoverRemovedComments = jest.fn(async () => {
      const map = new Map();
      map.set(removed.id, {
        text: "the original words a mod took down",
        provenance: {
          source: "arctic-shift" as const,
          reason: "moderator-removed" as const,
        },
      });
      return map;
    });
    const adapters = makeAdapters({
      lemmy: {
        getComments: async () => ({ items: [removed] }),
        recoverRemovedComments,
      },
    });
    // archiveRecovery acknowledged → the tap skips the consent prompt.
    renderWithAdapters(
      <SettingsProvider
        initial={{ ...DEFAULT_SETTINGS, archiveRecovery: true }}
      >
        <PostScreen {...props} />
      </SettingsProvider>,
      { adapters },
    );
    // Nothing recovered on load; an on-tap affordance is offered instead.
    const tap = await screen.findByLabelText(
      "Recover this comment from a public archive",
    );
    expect(recoverRemovedComments).not.toHaveBeenCalled();

    fireEvent.press(tap);
    expect(
      await screen.findByText("the original words a mod took down"),
    ).toBeTruthy();
    expect(
      screen.getByText("Recovered from archive · removed by a moderator"),
    ).toBeTruthy();
    expect(recoverRemovedComments).toHaveBeenCalled();
  });

  it("does not touch the archive until the comment's recover button is tapped", async () => {
    const removed: Comment = { ...comments[0], body: { text: "[removed]" } };
    const recoverRemovedComments = jest.fn(async () => new Map());
    const adapters = makeAdapters({
      lemmy: {
        getComments: async () => ({ items: [removed] }),
        recoverRemovedComments,
      },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    // The affordance is there, but no lookup happens without a tap.
    expect(
      await screen.findByLabelText(
        "Recover this comment from a public archive",
      ),
    ).toBeTruthy();
    expect(recoverRemovedComments).not.toHaveBeenCalled();
  });

  it("offline: a plane-mode packed thread shows when it was packed", async () => {
    __setOffline(true);
    beginPack(Date.now() - 2 * 3600_000);
    upsertPackedItem({
      id: post.id,
      title: post.title,
      community: post.community.handle,
      source: post.source,
      commentCount: post.commentCount,
      origin: "feed",
      status: "packed",
    });
    const adapters = makeAdapters({
      lemmy: { getComments: async () => ({ items: comments }) },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    expect(await screen.findByText(/Offline — packed/)).toBeTruthy();
  });

  it("surfaces a gentle 'Sign in to vote' toast when an anonymous vote fails", async () => {
    const adapters = makeAdapters({
      lemmy: {
        getComments: async () => ({ items: comments }),
        vote: async () => {
          throw new NotAuthenticatedError();
        },
      },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    fireEvent.press(screen.getByLabelText("Upvote"));
    expect(await screen.findByText("Sign in to vote")).toBeTruthy();
  });

  const signedIn = {
    account: {
      id: buildId({
        source: "lemmy",
        instance: "lemmy.world",
        kind: "user",
        nativeId: "me",
      }),
      source: "lemmy" as const,
      instance: "lemmy.world",
      username: "me",
      isGuest: false,
    },
  };

  it("lets a moderator remove the post via the mod sheet", async () => {
    const moderate = jest.fn(async () => {});
    const modPost = { ...post, canModerate: true };
    const adapters = makeAdapters({
      lemmy: {
        ...signedIn,
        getComments: async () => ({ items: [] }),
        moderate,
      },
    });
    renderWithAdapters(
      <PostScreen
        navigation={mockNavigation as any}
        route={mockRoute({ post: modPost }) as any}
      />,
      { adapters },
    );
    fireEvent.press(await screen.findByLabelText("Moderate post"));
    fireEvent.press(await screen.findByLabelText("Remove"));
    await waitFor(() =>
      expect(moderate).toHaveBeenCalledWith(modPost.id, { kind: "remove" }),
    );
  });

  it("hides moderation when you don't moderate the community", async () => {
    const adapters = makeAdapters({
      lemmy: { ...signedIn, getComments: async () => ({ items: [] }) },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("A local image post");
    expect(screen.queryByLabelText("Moderate post")).toBeNull();
  });

  it("posts a reply and optimistically shows it in the thread", async () => {
    const newComment = mapLemmyComment(
      {
        comment: {
          id: 999,
          content: "my new reply",
          path: "0.999",
          published: "2024-01-01T00:00:00Z",
          ap_id: "https://lemmy.world/comment/999",
        },
        creator: { name: "me" },
        counts: { score: 1 },
      },
      post.id,
      "lemmy.world",
    );
    const submitComment = jest.fn(async () => newComment);
    const adapters = makeAdapters({
      lemmy: {
        ...signedIn,
        getComments: async () => ({ items: comments }),
        submitComment,
      },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("OP top comment");

    fireEvent.press(screen.getByLabelText("Add a comment"));
    fireEvent.changeText(screen.getByLabelText("Comment text"), "my new reply");
    fireEvent.press(screen.getByLabelText("Post comment"));

    expect(await screen.findByText("my new reply")).toBeTruthy();
    expect(submitComment).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: post.id,
        parentId: post.id,
        markdown: "my new reply",
      }),
    );
  });

  it("toggles save with a confirming toast", async () => {
    const save = jest.fn(async () => {});
    const adapters = makeAdapters({
      lemmy: {
        ...signedIn,
        getComments: async () => ({ items: comments }),
        save,
      },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("OP top comment");
    fireEvent.press(screen.getByLabelText("Save post"));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(save).toHaveBeenCalledWith(post.id, true);
  });

  it("votes on a comment optimistically", async () => {
    const vote = jest.fn(async () => ({ score: 0, userVote: Vote.Up }));
    const adapters = makeAdapters({
      lemmy: {
        ...signedIn,
        getComments: async () => ({ items: comments }),
        vote,
      },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("OP top comment");
    // First visible comment's upvote (distinct label from the post's "Upvote").
    fireEvent.press(screen.getAllByLabelText("Upvote comment")[0]);
    expect(vote).toHaveBeenCalledWith(comments[0].id, Vote.Up);
  });

  const myComment = mapLemmyComment(
    {
      comment: {
        id: 500,
        content: "mine",
        path: "0.500",
        published: "2024-01-01T00:00:00Z",
        ap_id: "https://lemmy.world/comment/500",
      },
      creator: { name: "me" },
      counts: { score: 0 },
    },
    post.id,
    "lemmy.world",
  );

  it("edits the user's own comment and shows the new body", async () => {
    const editContent = jest.fn(async () => myComment);
    const adapters = makeAdapters({
      lemmy: {
        ...signedIn,
        getComments: async () => ({ items: [myComment] }),
        editContent,
      },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("mine");
    fireEvent.press(screen.getByLabelText("Edit comment"));
    fireEvent.changeText(screen.getByLabelText("Comment text"), "edited!");
    fireEvent.press(screen.getByLabelText("Save"));
    await waitFor(() =>
      expect(editContent).toHaveBeenCalledWith(myComment.id, "edited!"),
    );
    expect(await screen.findByText("edited!")).toBeTruthy();
  });

  it("deletes the user's own comment after confirmation", async () => {
    const spy = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons) => {
        const del = (buttons ?? []).find((b) => b.style === "destructive");
        del?.onPress?.();
      });
    const deleteContent = jest.fn(async () => {});
    const adapters = makeAdapters({
      lemmy: {
        ...signedIn,
        getComments: async () => ({ items: [myComment] }),
        deleteContent,
      },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("mine");
    fireEvent.press(screen.getByLabelText("Delete comment"));
    await waitFor(() =>
      expect(deleteContent).toHaveBeenCalledWith(myComment.id),
    );
    expect(await screen.findByText("[deleted]")).toBeTruthy();
    spy.mockRestore();
  });

  it("does not offer edit/delete on someone else's comment", async () => {
    const adapters = makeAdapters({
      lemmy: { ...signedIn, getComments: async () => ({ items: comments }) },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("OP top comment"); // authored by someone else
    expect(screen.queryByLabelText("Edit comment")).toBeNull();
    expect(screen.queryByLabelText("Delete comment")).toBeNull();
  });

  it("re-sorts comments when the sort is changed", async () => {
    const getComments = jest.fn(async () => ({ items: comments }));
    const adapters = makeAdapters({ lemmy: { getComments } });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("OP top comment");
    // The default comment-sort setting ("top") resolves to Lemmy's "Top";
    // tapping cycles to the next option ("New").
    fireEvent.press(screen.getByLabelText(/Sort comments by Top/));
    await waitFor(() =>
      expect(getComments).toHaveBeenCalledWith(
        post.id,
        expect.objectContaining({ sort: "New" }),
      ),
    );
  });

  it("shares the post via the native share sheet", async () => {
    const spy = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" } as never);
    const adapters = makeAdapters({
      lemmy: { getComments: async () => ({ items: comments }) },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("OP top comment");
    fireEvent.press(screen.getByLabelText("Share post"));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining("http") }),
      ),
    );
    spy.mockRestore();
  });

  it("loads more replies when a truncated subtree's button is tapped", async () => {
    const truncated = {
      ...comments[0],
      loadMore: { kind: "lemmy-subtree", parentId: 10, depth: 1 } as const,
    };
    const fetched = mapLemmyComment(
      {
        comment: {
          id: 700,
          content: "hidden reply",
          path: `0.${10}.700`,
          published: "2024-01-01T00:00:00Z",
          ap_id: "https://lemmy.world/comment/700",
        },
        creator: { name: "deep" },
        counts: { score: 1 },
      },
      post.id,
      "lemmy.world",
    );
    const loadMoreComments = jest.fn(async () => [fetched]);
    const adapters = makeAdapters({
      lemmy: {
        getComments: async () => ({ items: [truncated] }),
        loadMoreComments,
      },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("OP top comment");

    fireEvent.press(screen.getByText(/Load more replies/));
    await waitFor(() =>
      expect(loadMoreComments).toHaveBeenCalledWith(
        post.id,
        truncated.loadMore,
      ),
    );
    expect(await screen.findByText("hidden reply")).toBeTruthy();
  });

  it("prompts anonymous users to sign in before commenting", async () => {
    const adapters = makeAdapters({
      lemmy: { getComments: async () => ({ items: comments }) },
    });
    renderWithAdapters(<PostScreen {...props} />, { adapters });
    await screen.findByText("OP top comment");
    fireEvent.press(screen.getByLabelText("Add a comment"));
    expect(await screen.findByText("Sign in to comment")).toBeTruthy();
  });
});
