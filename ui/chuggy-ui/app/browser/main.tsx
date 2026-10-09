/**
 * The console's one process root: it builds the ports, the session and the
 * cache, mounts the tree, and then completes whatever the redirect brought
 * back.
 *
 * Loading happens after the first render rather than before it, so a slow or
 * missing configuration is a drawn state instead of a blank document. A live
 * frame is what updates a query, so nothing here refetches on a window event.
 * The theme is read and put on the document before the first paint. The tokens
 * and the element defaults are imported above everything that draws, because a
 * bundler emits a sheet where it first reaches it; what holds the emitted
 * order to the system's is `scripts/console-policy.ts`, over the stylesheet the
 * build wrote.
 *
 * The invite holder is made here, once, before the tree is mounted. Being
 * made is what takes an invite link's token out of the address, so no frame is
 * drawn with it in the address bar, and what starts it hearing a fragment that
 * changes later, for the life of the document.
 */

import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/utilities.css";

import { QueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createInviteHolder } from "../core/inviteHolder.ts";
import { createSessionHolder } from "../core/sessionHolder.ts";
import { App } from "./App.tsx";
import { InviteProvider } from "./InvitePage.tsx";
import {
  anchorHeard,
  cookiesRead,
  cookieWritten,
  currentAnchor,
  currentLocation,
  digest,
  drawBytes,
  fetchJson,
  nowMs,
  persistentStore,
  redirect,
  reloadLocation,
  replaceLocation,
  replacePath,
  sleepMs,
  transientStore,
} from "./ports.ts";
import { SessionProvider, sessionBegin } from "./session.tsx";
import { themeChoiceApply, themeChoiceRead } from "./theme.ts";
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
  sleepMs,
  fetchJson,
  persistent: persistentStore,
  transient: transientStore,
  digest,
  drawBytes,
  redirect,
});

const invite = createInviteHolder({
  location: currentLocation,
  anchor: currentAnchor,
  anchorHeard,
  replacePath,
  replaceLocation,
  cookies: cookiesRead,
  cookieWrite: cookieWritten,
  reload: reloadLocation,
});

themeChoiceApply(document.documentElement, themeChoiceRead(persistentStore));

const container = document.getElementById("root");
if (container === null)
  throw new Error(
    "the document carries no element for the console to mount in",
  );

createRoot(container).render(
  <StrictMode>
    <SessionProvider holder={holder}>
      <InviteProvider holder={invite}>
        <App queryClient={queryClient} />
      </InviteProvider>
    </SessionProvider>
  </StrictMode>,
);

void sessionBegin(holder);
