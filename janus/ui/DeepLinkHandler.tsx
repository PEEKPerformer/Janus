import { useEffect } from "react";
import * as Linking from "expo-linking";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";

import type { RootStackParamList } from "./types";
import { useAdapters } from "./AdapterContext";
import { parseShareUrl } from "../app/deepLinks";
import { setInAppUrlRouter } from "./links";
import { buildId } from "../core/ids";

const REDDIT_INSTANCE = "www.reddit.com";

/**
 * Routes incoming Reddit/Lemmy share URLs (cold-start or while running) to the
 * right screen across both networks. Communities resolve reliably on both
 * sources; Lemmy posts/users use the adapter's federation resolve. Anything we
 * can't resolve is silently ignored rather than crashing the nav stack.
 */
export function DeepLinkHandler({
  navRef,
}: {
  navRef: NavigationContainerRefWithCurrent<RootStackParamList>;
}) {
  const { manager, adapters } = useAdapters();

  useEffect(() => {
    // Returns true when the URL resolved to an in-app screen — also serves as
    // the tap-a-link-in-a-comment router (registered via setInAppUrlRouter).
    const handle = async (url: string): Promise<boolean> => {
      const target = parseShareUrl(url);
      if (!target || !navRef.isReady()) return false;
      try {
        if (target.source === "reddit") {
          const reddit = manager.reddit();
          if (target.kind === "community") {
            const id = buildId({
              source: "reddit",
              instance: REDDIT_INSTANCE,
              kind: "community",
              nativeId: target.name,
            });
            navRef.navigate("Feed", {
              openCommunity: await reddit.getCommunity(id),
            });
          } else if (target.kind === "post") {
            const id = buildId({
              source: "reddit",
              instance: REDDIT_INSTANCE,
              kind: "post",
              nativeId: target.postId,
            });
            navRef.navigate("Post", { post: await reddit.getPost(id) });
          } else {
            navRef.navigate("Profile", {
              userId: buildId({
                source: "reddit",
                instance: REDDIT_INSTANCE,
                kind: "user",
                nativeId: target.name,
              }),
              source: "reddit",
              handle: `u/${target.name}`,
            });
          }
          return true;
        }

        // Lemmy: resolve the URL on the focused instance (federation-aware).
        const lemmy = adapters.lemmy;
        const resolved = await lemmy.resolveRemoteUrl(url);
        if (resolved.kind === "community") {
          navRef.navigate("Feed", {
            openCommunity: await lemmy.getCommunity(resolved.id),
          });
        } else if (resolved.kind === "post") {
          navRef.navigate("Post", { post: await lemmy.getPost(resolved.id) });
        } else if (resolved.kind === "user") {
          navRef.navigate("Profile", {
            userId: resolved.id,
            source: "lemmy",
            handle: target.kind === "user" ? target.name : "",
          });
        } else {
          return false;
        }
        return true;
      } catch {
        /* unresolvable link — ignore */
      }
      return false;
    };

    void Linking.getInitialURL().then((u) => {
      if (u) void handle(u);
    });
    const sub = Linking.addEventListener("url", (e) => void handle(e.url));
    setInAppUrlRouter(handle);
    return () => {
      sub.remove();
      setInAppUrlRouter(null);
    };
  }, [manager, adapters, navRef]);

  return null;
}
