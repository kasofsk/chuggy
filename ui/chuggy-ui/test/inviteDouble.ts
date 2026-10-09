/**
 * The invite page's two holders with no browser present: an address bar and a
 * cookie jar a case reads back, and a session at whatever phase the case
 * wants, which remembers where a sign-in was asked to return.
 */

import type { ConsoleConfiguration } from "../app/core/configuration.ts";
import { createInviteHolder } from "../app/core/inviteHolder.ts";
import type { InviteHolder } from "../app/core/inviteHolder.ts";
import type { SessionHolder, SessionPhase } from "../app/core/sessionHolder.ts";
import { sessionHarnessConfiguration } from "./sessionHolderHarness.ts";

export interface InviteBrowser {
  pathname: string;
  search: string;
  anchor: string;
  cookies: string;
  /** Every cookie line the page handed the browser, in order. */
  readonly written: string[];
  /** Every address the bar was moved to with no navigation. */
  readonly replaced: string[];
  /** Every address the document was left for. */
  readonly left: string[];
}

export function inviteBrowser(
  at: Partial<
    Pick<InviteBrowser, "pathname" | "search" | "anchor" | "cookies">
  >,
): { readonly browser: InviteBrowser; readonly holder: InviteHolder } {
  const browser: InviteBrowser = {
    pathname: "/invite",
    search: "",
    anchor: "",
    cookies: "",
    ...at,
    written: [],
    replaced: [],
    left: [],
  };
  const holder = createInviteHolder({
    location: () => ({ pathname: browser.pathname, search: browser.search }),
    anchor: () => browser.anchor,
    replacePath: (path) => {
      browser.replaced.push(path);
      browser.anchor = "";
    },
    replaceLocation: (path) => {
      browser.left.push(path);
    },
    cookies: () => browser.cookies,
    cookieWrite: (line) => {
      browser.written.push(line);
    },
  });
  return { browser, holder };
}

/** The harness' configuration, naming the domain a case's cookie is written for where it names one. */
export function inviteConfiguration(
  inviteCookieDomain?: string,
): ConsoleConfiguration {
  return {
    ...sessionHarnessConfiguration,
    ...(inviteCookieDomain === undefined ? {} : { inviteCookieDomain }),
  };
}

export function inviteSession(
  phase: SessionPhase,
  configuration: ConsoleConfiguration = inviteConfiguration(),
): {
  readonly session: SessionHolder;
  readonly signIns: (string | undefined)[];
} {
  const snapshot = { phase, reason: undefined, configuration };
  const signIns: (string | undefined)[] = [];
  return {
    signIns,
    session: {
      load: () => Promise.resolve(),
      completeCallback: () => Promise.resolve({ result: "None" as const }),
      signIn: (returnPath) => {
        signIns.push(returnPath);
        return Promise.resolve();
      },
      signOut: () => Promise.resolve(),
      bearer: () => Promise.resolve("token"),
      refresh: () => Promise.resolve(true),
      refuse: () => undefined,
      refreshDueAtMs: () => undefined,
      generation: () => 1,
      snapshot: () => snapshot,
      subscribe: () => () => undefined,
    },
  };
}
