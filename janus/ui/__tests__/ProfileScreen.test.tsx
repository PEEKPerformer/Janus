import React from "react";
import { Alert } from "react-native";
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

  it("shows a Saved tab only on your own profile, fetching saved content", async () => {
    const getUserContent = jest.fn(async () => ({ items: posts }));
    // Own profile: the adapter's account id matches the viewed user id.
    const ownAccount = {
      id: userId,
      source: "lemmy" as const,
      instance: "lemmy.world",
      username: "alice",
      isGuest: false,
    };
    const adapters = makeAdapters({
      lemmy: { account: ownAccount, getUser: async () => user, getUserContent },
    });
    renderWithAdapters(<ProfileScreen {...props} />, { adapters });

    const saved = await screen.findByLabelText("Saved");
    fireEvent.press(saved);
    await waitFor(() =>
      expect(getUserContent).toHaveBeenCalledWith(
        userId,
        "saved",
        expect.anything(),
      ),
    );
  });

  it("hides the Saved tab on other users' profiles", async () => {
    const adapters = makeAdapters({
      lemmy: {
        getUser: async () => user,
        getUserContent: async () => ({ items: posts }),
      },
    });
    renderWithAdapters(<ProfileScreen {...props} />, { adapters });
    await screen.findByText("alice");
    expect(screen.queryByLabelText("Saved")).toBeNull();
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

  it("messages the user and blocks them when signed in", async () => {
    const sendMessage = jest.fn(async () => {});
    const blockUser = jest.fn(async () => {});
    const adapters = makeAdapters({
      lemmy: {
        ...signedIn,
        getUser: async () => user,
        getUserContent: async () => ({ items: [] }),
        sendMessage,
        blockUser,
      },
    });
    renderWithAdapters(<ProfileScreen {...props} />, { adapters });
    await screen.findByText("1.2k posts");

    fireEvent.press(screen.getByLabelText("Message alice"));
    fireEvent.changeText(screen.getByLabelText("Comment text"), "hi alice");
    fireEvent.press(screen.getByLabelText("Send"));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        to: userId,
        markdown: "hi alice",
      }),
    );

    const spy = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons) => {
        (buttons ?? []).find((b) => b.style === "destructive")?.onPress?.();
      });
    fireEvent.press(screen.getByLabelText("Block alice"));
    await waitFor(() => expect(blockUser).toHaveBeenCalledWith(userId, true));
    spy.mockRestore();
  });

  it("hides message/block on your own profile", async () => {
    const ownProps = {
      navigation: mockNavigation as any,
      route: mockRoute({
        userId: signedIn.account.id,
        source: "lemmy",
        handle: "me",
      }) as any,
    };
    const adapters = makeAdapters({
      lemmy: {
        ...signedIn,
        getUser: async () => user,
        getUserContent: async () => ({ items: [] }),
      },
    });
    renderWithAdapters(<ProfileScreen {...ownProps} />, { adapters });
    await screen.findByText("1.2k posts");
    expect(screen.queryByLabelText("Message me")).toBeNull();
  });
});
