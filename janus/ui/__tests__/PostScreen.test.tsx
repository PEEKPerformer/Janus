import React from "react";
import { fireEvent, screen } from "@testing-library/react-native";
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
      id: buildId({ source: "lemmy", instance: "lemmy.world", kind: "user", nativeId: "me" }),
      source: "lemmy" as const,
      instance: "lemmy.world",
      username: "me",
      isGuest: false,
    },
  };

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
