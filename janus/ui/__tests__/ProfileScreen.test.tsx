import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react-native";
import { ProfileScreen } from "../screens/ProfileScreen";
import {
  renderWithAdapters,
  makeAdapters,
  mockNavigation,
  mockRoute,
} from "./testUtils";
import {
  mapLemmyPost,
  mapLemmyComment,
  mapLemmyPerson,
} from "../../sources/lemmy/mappers";
import {
  lemmyListFixture,
  lemmyCommentsFixture,
} from "../../sources/lemmy/__fixtures__/lemmySamples";
import { buildId } from "../../core/ids";

const userId = buildId({
  source: "lemmy",
  instance: "lemmy.world",
  kind: "user",
  nativeId: "42",
});
const user = mapLemmyPerson(
  {
    person: {
      id: 42,
      name: "alice",
      actor_id: "https://lemmy.world/u/alice",
      local: true,
      published: "2022-01-01T00:00:00Z",
    },
    counts: { post_score: 1234, comment_score: 5678 },
  },
  "lemmy.world",
);
const posts = lemmyListFixture.posts.map((pv: unknown) =>
  mapLemmyPost(pv, "lemmy.world"),
);
const comments = lemmyCommentsFixture.comments.map((cv: unknown) =>
  mapLemmyComment(cv, posts[0].id, "lemmy.world"),
);

const props = {
  navigation: mockNavigation as any,
  route: mockRoute({ userId, source: "lemmy", handle: "alice" }) as any,
};

describe("ProfileScreen", () => {
  it("renders the user header and their content, switching tabs", async () => {
    const getUserContent = jest.fn(async (_id: unknown, kind: string) => ({
      items: kind === "comments" ? comments : posts,
      nextCursor: undefined,
    }));
    const adapters = makeAdapters({
      lemmy: { getUser: async () => user, getUserContent },
    });
    renderWithAdapters(<ProfileScreen {...props} />, { adapters });

    expect(screen.getByText("alice")).toBeTruthy(); // header handle (route param)
    expect(await screen.findByText("1.2k posts")).toBeTruthy(); // post score
    expect(await screen.findByText("A local image post")).toBeTruthy(); // overview default

    fireEvent.press(screen.getByLabelText("Comments"));
    await waitFor(() =>
      expect(getUserContent).toHaveBeenCalledWith(
        userId,
        "comments",
        expect.anything(),
      ),
    );
  });

  it("shows a graceful empty state when there's no content", async () => {
    const adapters = makeAdapters({
      lemmy: {
        getUser: async () => user,
        getUserContent: async () => ({ items: [] }),
      },
    });
    renderWithAdapters(<ProfileScreen {...props} />, { adapters });
    expect(await screen.findByText("Nothing here yet")).toBeTruthy();
  });
});
