import React from "react";
import { fireEvent, screen } from "@testing-library/react-native";
import { PostScreen } from "../screens/PostScreen";
import { renderWithAdapters, makeAdapters, mockNavigation, mockRoute } from "./testUtils";
import { mapLemmyPost, mapLemmyComment } from "../../sources/lemmy/mappers";
import { lemmyListFixture, lemmyCommentsFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";
import { NotAuthenticatedError } from "../../core/errors";

const post = mapLemmyPost(lemmyListFixture.posts[0], "lemmy.world");
const comments = lemmyCommentsFixture.comments.map((cv: unknown) => mapLemmyComment(cv, post.id, "lemmy.world"));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const props = { navigation: mockNavigation as any, route: mockRoute({ post }) as any };

describe("PostScreen", () => {
  it("renders the post and its comment tree", async () => {
    const adapters = makeAdapters({ lemmy: { getComments: async () => ({ items: comments }) } });
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
});
