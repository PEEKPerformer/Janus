import React from "react";
import { render } from "@testing-library/react-native";
import { AdapterProvider, type AdapterMap } from "../AdapterContext";
import type { SourceAdapter } from "../../core/adapter";
import type { SourceKind } from "../../core/ids";
import { REDDIT_CAPABILITIES } from "../../sources/reddit/capabilities";
import { LEMMY_CAPABILITIES } from "../../sources/lemmy/capabilities";
import { NotAuthenticatedError } from "../../core/errors";
import { buildId } from "../../core/ids";

/** Minimal SourceAdapter mock — only the methods used by the UI are defined. */
export function makeMockAdapter(
  source: SourceKind,
  over: Partial<SourceAdapter> = {},
): SourceAdapter {
  const instance = source === "reddit" ? "www.reddit.com" : "lemmy.world";
  const base = {
    source,
    instance,
    capabilities: source === "reddit" ? REDDIT_CAPABILITIES : LEMMY_CAPABILITIES,
    account: {
      id: buildId({ source, instance, kind: "user", nativeId: "__guest__" }),
      source,
      instance,
      username: "Guest",
      isGuest: true,
    },
    getFeed: async () => ({ items: [] }),
    getPost: async () => {
      throw new Error("not implemented in mock");
    },
    getComments: async () => ({ items: [] }),
    vote: async () => {
      throw new NotAuthenticatedError();
    },
  };
  return { ...base, ...over } as unknown as SourceAdapter;
}

export function makeAdapters(over?: { reddit?: Partial<SourceAdapter>; lemmy?: Partial<SourceAdapter> }): AdapterMap {
  return {
    reddit: makeMockAdapter("reddit", over?.reddit),
    lemmy: makeMockAdapter("lemmy", over?.lemmy),
  };
}

export function renderWithAdapters(
  ui: React.ReactElement,
  opts?: { adapters?: AdapterMap; initialSource?: SourceKind },
) {
  const adapters = opts?.adapters ?? makeAdapters();
  return {
    adapters,
    ...render(
      <AdapterProvider adapters={adapters} initialSource={opts?.initialSource ?? "lemmy"}>
        {ui}
      </AdapterProvider>,
    ),
  };
}

/** A throwaway navigation prop for rendering screens in isolation. */
export const mockNavigation = { navigate: jest.fn(), goBack: jest.fn(), push: jest.fn() };
export const mockRoute = (params?: object) => ({ key: "k", name: "n", params });
