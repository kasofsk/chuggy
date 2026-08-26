/**
 * The console's one process root: it builds the ports, the session and the
 * cache, mounts the tree, and then completes whatever the redirect brought
 * back.
 *
 * Loading happens after the first render rather than before it, so a slow or
 * missing configuration is a drawn state instead of a blank document. A live
 * frame is what updates a query, so nothing here refetches on a window event.
 */

import { QueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createSessionHolder } from "../core/sessionHolder.ts";
import type { SessionHolder } from "../core/sessionHolder.ts";
import { App } from "./App.tsx";
import {
  digest,
  drawBytes,
  fetchJson,
  nowMs,
  persistentStore,
  redirect,
  transientStore,
} from "./ports.ts";
import { SessionProvider } from "./session.tsx";
import "../styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

const holder = createSessionHolder({
  nowMs,
  fetchJson,
  persistent: persistentStore,
  transient: transientStore,
  digest,
  drawBytes,
  redirect,
});

/** A refused sign-in is drawn with its reason, not as a browser holding none. */
async function begin(session: SessionHolder): Promise<void> {
  await session.load();
  const callback = await session.completeCallback(location.search);
  if (callback.result === "None") return;
  if (callback.result === "Denied") session.refuse(callback.reason);
  history.replaceState(null, "", "/");
}

const container = document.getElementById("root");
if (container === null)
  throw new Error(
    "the document carries no element for the console to mount in",
  );

createRoot(container).render(
  <StrictMode>
    <SessionProvider holder={holder}>
      <App queryClient={queryClient} />
    </SessionProvider>
  </StrictMode>,
);

void begin(holder);
