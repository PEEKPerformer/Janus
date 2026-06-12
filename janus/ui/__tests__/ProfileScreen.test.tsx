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
import { ForbiddenError, NetworkError } from "../../core/errors";
import { SettingsProvider } from "../SettingsContext";
import { DEFAULT_SETTINGS } from "../../app/settingsStore";

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

  it("shows comment context and opens the thread at the comment on tap", async () => {
    const withContext = {
      ...comments[0],
      context: {
        community: {
          id: buildId({
            source: "lemmy",
            instance: "lemmy.world",
            kind: "community",
            nativeId: "3",
          }),
          name: "churning",
          handle: "churning@lemmy.world",
        },
        postTitle: "Daily Question Thread",
      },
    };
    const thread = posts[0];
    const getPost = jest.fn(async () => thread);
    const adapters = makeAdapters({
      lemmy: {
        getUser: async () => user,
        getUserContent: async (_id: unknown, kind: string) => ({
          items: kind === "comments" ? [withContext] : posts,
        }),
        getPost,
      },
    });
    renderWithAdapters(<ProfileScreen {...props} />, { adapters });
    fireEvent.press(await screen.findByLabelText("Comments"));

    // Context line: community handle + the post title it was made under.
    expect(await screen.findByText("churning@lemmy.world")).toBeTruthy();
    expect(screen.getByText(/Daily Question Thread/)).toBeTruthy();

    fireEvent.press(
      screen.getByLabelText(
        "Comment in churning@lemmy.world. Opens the thread.",
      ),
    );
    await waitFor(() =>
      expect(getPost).toHaveBeenCalledWith(withContext.postId),
    );
    expect(mockNavigation.navigate).toHaveBeenCalledWith("Post", {
      post: thread,
      focusCommentId: withContext.id,
    });
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

  it("renders a 403 on the listing as 'history is private', not an error", async () => {
    // Reddit's profile-curation setting (hidden post/comment history) can
    // surface as a 403 on the user listing while the profile header still
    // loads. That's the user's choice, not a failure — no retry button.
    const adapters = makeAdapters({
      lemmy: {
        getUser: async () => user,
        getUserContent: async () => {
          throw new ForbiddenError();
        },
      },
    });
    renderWithAdapters(<ProfileScreen {...props} />, { adapters });
    expect(await screen.findByText("History is private")).toBeTruthy();
    expect(
      screen.getByText("alice has chosen not to show their post history."),
    ).toBeTruthy();
    expect(screen.queryByText(/retry/i)).toBeNull();
  });

  it("reconstructs hidden history from the archive only after the user taps", async () => {
    const recoverUserContent = jest.fn(async () => ({ items: posts }));
    const adapters = makeAdapters({
      lemmy: {
        getUser: async () => user,
        getUserContent: async () => {
          throw new ForbiddenError();
        },
        recoverUserContent,
      },
    });
    // archiveRecovery already acknowledged → the tap skips the consent prompt.
    renderWithAdapters(
      <SettingsProvider
        initial={{ ...DEFAULT_SETTINGS, archiveRecovery: true }}
      >
        <ProfileScreen {...props} />
      </SettingsProvider>,
      { adapters },
    );
    // Nothing fetched on load — recovery is on-tap.
    expect(await screen.findByLabelText("Show archived history")).toBeTruthy();
    expect(recoverUserContent).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText("Show archived history"));
    expect(await screen.findByText(/Showing the public archive/)).toBeTruthy();
    expect(recoverUserContent).toHaveBeenCalled();
  });

  it("prompts for consent on the first tap when not yet acknowledged", async () => {
    const spy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const recoverUserContent = jest.fn(async () => ({ items: [] }));
    const adapters = makeAdapters({
      lemmy: {
        getUser: async () => user,
        getUserContent: async () => {
          throw new ForbiddenError();
        },
        recoverUserContent,
      },
    });
    renderWithAdapters(<ProfileScreen {...props} />, { adapters }); // off
    fireEvent.press(await screen.findByLabelText("Show archived history"));
    // Discloses the third-party flow and waits — no fetch until the user agrees.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatch(/third-party archive services/i);
    expect(recoverUserContent).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("shows no recover affordance when the source has no archive", async () => {
    const adapters = makeAdapters({
      lemmy: {
        getUser: async () => user,
        getUserContent: async () => {
          throw new ForbiddenError();
        },
        // no recoverUserContent
      },
    });
    renderWithAdapters(<ProfileScreen {...props} />, { adapters });
    expect(await screen.findByText("History is private")).toBeTruthy();
    expect(screen.queryByLabelText("Show archived history")).toBeNull();
  });

  it("still shows a real error view for non-403 failures", async () => {
    const adapters = makeAdapters({
      lemmy: {
        getUser: async () => user,
        getUserContent: async () => {
          throw new NetworkError("HTTP 500", 500);
        },
      },
    });
    renderWithAdapters(<ProfileScreen {...props} />, { adapters });
    expect(await screen.findByText("Connection problem")).toBeTruthy();
    expect(screen.queryByText("History is private")).toBeNull();
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
