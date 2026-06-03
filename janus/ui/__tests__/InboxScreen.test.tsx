import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react-native";
import { InboxScreen } from "../screens/InboxScreen";
import {
  renderWithAdapters,
  makeAdapters,
  mockNavigation,
  mockRoute,
} from "./testUtils";
import { buildId } from "../../core/ids";

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

const notif = (n: string, read: boolean): any => ({
  id: buildId({
    source: "lemmy",
    instance: "lemmy.world",
    kind: "message",
    nativeId: `reply:${n}`,
  }),
  dedupKey: `dk-${n}`,
  source: "lemmy",
  instance: "lemmy.world",
  kind: "commentReply",
  read,
  createdAt: 1700000000000,
  author: {
    id: buildId({
      source: "lemmy",
      instance: "lemmy.world",
      kind: "user",
      nativeId: "bob",
    }),
    username: "bob",
    handle: "bob",
  },
  body: { text: `notification ${n}` },
  ext: { source: "lemmy", apId: "x", local: true },
});

const props = {
  navigation: mockNavigation as any,
  route: mockRoute(undefined) as any,
};

describe("InboxScreen", () => {
  it("lists notifications and marks one read on tap", async () => {
    const markRead = jest.fn(async () => {});
    const adapters = makeAdapters({
      lemmy: {
        ...signedIn,
        getInbox: async () => ({
          items: [notif("1", false), notif("2", true)],
        }),
        markRead,
      },
    });
    renderWithAdapters(<InboxScreen {...props} />, {
      adapters,
      initialScope: "lemmy",
    });

    expect(await screen.findByText("notification 1")).toBeTruthy();
    expect(screen.getByText("notification 2")).toBeTruthy();

    fireEvent.press(screen.getByText("notification 1"));
    await waitFor(() =>
      expect(markRead).toHaveBeenCalledWith(notif("1", false).id, true),
    );
  });

  it("marks all read", async () => {
    const markAllRead = jest.fn(async () => {});
    const adapters = makeAdapters({
      lemmy: {
        ...signedIn,
        getInbox: async () => ({ items: [notif("1", false)] }),
        markAllRead,
      },
    });
    renderWithAdapters(<InboxScreen {...props} />, {
      adapters,
      initialScope: "lemmy",
    });
    await screen.findByText("notification 1");
    fireEvent.press(screen.getByLabelText("Mark all as read"));
    await waitFor(() => expect(markAllRead).toHaveBeenCalled());
  });

  it("filters to messages, refetching with that filter", async () => {
    const getInbox = jest.fn(async () => ({ items: [notif("1", false)] }));
    const adapters = makeAdapters({ lemmy: { ...signedIn, getInbox } });
    renderWithAdapters(<InboxScreen {...props} />, {
      adapters,
      initialScope: "lemmy",
    });
    await screen.findByText("notification 1");
    fireEvent.press(screen.getByLabelText("Messages"));
    await waitFor(() =>
      expect(getInbox).toHaveBeenCalledWith("messages", expect.anything()),
    );
  });
});
