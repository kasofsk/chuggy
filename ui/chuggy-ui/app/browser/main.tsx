/**
 * The console's one process root: it builds the ports, the session, the cache
 * and the store, mounts the tree, and then completes whatever the redirect brought
 * back.
 *
 * Loading happens after the first render rather than before it, so a slow or
 * missing configuration is a drawn state instead of a blank document. A live
 * frame is what updates a query, so a window event reads again only a query
 * whose last read failed, as `panelQueryDefaults` says, and a write is
 * sent once, as `consoleQueryClient` says. The theme is read and put on the document before the first paint. The tokens
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

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";

import { apiPortsOver } from "../core/apiPorts.ts";
import { createInviteHolder } from "../core/inviteHolder.ts";
import { consoleQueryClient } from "../core/consoleWrite.ts";
import { App } from "./App.tsx";
import { InviteProvider } from "./InvitePage.tsx";
import {
  anchorHeard,
  apiFetch,
  cookiesRead,
  cookieWritten,
  currentAnchor,
  currentLocation,
  persistentStore,
  reloadLocation,
  replaceLocation,
  replacePath,
  sleepMs,
} from "./ports.ts";
import {
  SessionProvider,
  sessionBegin,
  sessionHolderOpened,
} from "./session.tsx";
import { consoleStore } from "./store.ts";
import { themeChoiceApply, themeChoiceRead } from "./theme.ts";
import "../styles.css";

const queryClient = consoleQueryClient();

const holder = sessionHolderOpened();

const store = consoleStore({
  ports: apiPortsOver(holder, apiFetch, sleepMs),
  client: queryClient,
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
        <Provider store={store}>
          <App queryClient={queryClient} />
        </Provider>
      </InviteProvider>
    </SessionProvider>
  </StrictMode>,
);

void sessionBegin(holder);
