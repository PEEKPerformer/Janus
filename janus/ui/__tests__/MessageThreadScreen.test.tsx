import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react-native";
import { MessageThreadScreen } from "../screens/MessageThreadScreen";
import {
  renderWithAdapters,
  makeAdapters,
  mockNavigation,
  mockRoute,
} from "./testUtils";
import { buildId } from "../../core/ids";

const corr = buildId({
  source: "lemmy",
  instance: "lemmy.world",
  kind: "user",
  nativeId: "bob",
});

const dm = (id: string, text: string, fromMe: boolean): any => ({
  id: buildId({
    source: "lemmy",
    instance: "lemmy.world",
    kind: "message",
    nativeId: id,
  }),
  dedupKey: `dk-${id}`,
  source: "lemmy",
  instance: "lemmy.world",
  read: true,
  createdAt: 1700000000000,
  from: { id: corr, username: "bob", handle: "bob" },
  to: { id: corr, username: "bob", handle: "bob" },
  body: { text },
  fromMe,
});

const props = {
  navigation: mockNavigation as any,
  route: mockRoute({
    correspondentId: corr,
    source: "lemmy",
    instance: "lemmy.world",
    handle: "bob",
  }) as any,
};

describe("MessageThreadScreen", () => {
  it("renders the thread and sends an optimistic reply", async () => {
    const sendMessage = jest.fn(async () => {});
    const adapters = makeAdapters({
      lemmy: {
        account: {
          id: buildId({
            source: "lemmy",
            instance: "lemmy.world",
            kind: "user",
            nativeId: "me",
          }),
          source: "lemmy",
          instance: "lemmy.world",
          username: "me",
          isGuest: false,
        },
        getMessageThread: async () => ({
          items: [dm("pm:1", "hi there", false)],
        }),
        sendMessage,
      },
    });
    renderWithAdapters(<MessageThreadScreen {...props} />, {
      adapters,
      initialScope: "lemmy",
    });

    expect(await screen.findByText("hi there")).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText("Message text"), "hello back");
    fireEvent.press(screen.getByLabelText("Send message"));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        to: corr,
        markdown: "hello back",
      }),
    );
    expect(await screen.findByText("hello back")).toBeTruthy();
  });
});
