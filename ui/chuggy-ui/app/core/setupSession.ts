/**
 * The console's own session holder and API ports, composed for a program that
 * runs in a terminal against one site.
 *
 * The holder reads who it signs in as from the site's `/config.json`, so the
 * program answers that read itself: the site's issuer and audience, under the
 * setup program's own client, scopes and loopback redirect. Everything else
 * is the holder's, unchanged. What the issuer's token endpoint was last asked
 * is noted as a member of a closed set, because the holder says why a renewal
 * or an exchange failed only in words, and no words of another system's reach
 * a report. A request that asks the issuer for a token is sent only once the
 * store has room for the one it hands back.
 */

import type { AccessCallerTenant } from "../../../../src/contract/accessPlane.ts";

import { apiCallerTenants } from "./accessRoutes.ts";
import { apiPortsOver } from "./apiPorts.ts";
import type { ApiFailure, ApiPorts } from "./apiRequest.ts";
import {
  consoleConfigurationPath,
  parseConsoleConfiguration,
} from "./configuration.ts";
import {
  createSessionHolder,
  FetchJsonError,
  fetchJsonThrough,
} from "./sessionHolder.ts";
import type { SessionHolder, SessionHolderPorts } from "./sessionHolder.ts";
import type { SetupPorts } from "./setupPorts.ts";
import {
  setupClientId,
  setupRedirectUri,
  setupScopes,
} from "./setupProgram.ts";
import { setupTokenStore } from "./setupStore.ts";
import type { SetupTokenStore } from "./setupStore.ts";

/** The bound the terminal's JSON requests are sent under, since their port carries none. */
export const setupFetchTimeoutMs = 15_000;

/** The longest a server's own retry instruction is waited out, where a command is what waits. */
export const setupRetryDelayMsMax = 5_000;

const setupRefusalStatusMin = 400;
const setupRefusalStatusMax = 500;

/** How the issuer's token endpoint answered the last time it was asked. */
export type SetupTokenAsked = "Unasked" | "Answered" | "Refused" | "Unanswered";

export interface SetupSessionOpened {
  readonly site: string;
  readonly holder: SessionHolder;
  readonly api: ApiPorts;
  readonly store: SetupTokenStore;
  /** Whether the site's own configuration was read, which tells a site that fails from an issuer that does. */
  readonly configured: () => boolean;
  readonly tokenAsked: () => SetupTokenAsked;
  /** The address the last sign-in was sent to. */
  readonly authorize: () => string | undefined;
}

interface SetupSessionNotes {
  configured: boolean;
  tokenAsked: SetupTokenAsked;
  authorize: string | undefined;
}

function setupTokenFault(failure: unknown): SetupTokenAsked {
  if (!(failure instanceof FetchJsonError)) return "Unanswered";
  const fault = failure.fault;
  if (fault.fault !== "Status") return "Unanswered";
  return fault.status >= setupRefusalStatusMin &&
    fault.status < setupRefusalStatusMax
    ? "Refused"
    : "Unanswered";
}

function setupMemory(): SessionHolderPorts["transient"] {
  const held = new Map<string, string>();
  return {
    read: (key) => held.get(key) ?? null,
    write: (key, value) => {
      held.set(key, value);
    },
    remove: (key) => {
      held.delete(key);
    },
  };
}

/** The field every request for a token carries, and a revocation does not. */
const setupGrantField = "grant_type";

function setupFetchJson(
  ports: SetupPorts,
  site: string,
  port: number | undefined,
  held: { readonly notes: SetupSessionNotes; readonly store: SetupTokenStore },
): SessionHolderPorts["fetchJson"] {
  const notes = held.notes;
  return async (request) => {
    if (typeof request !== "string") {
      if (new URLSearchParams(request.body).has(setupGrantField))
        held.store.roomed();
      try {
        const answered = await fetchJsonThrough(ports.fetchJson, request);
        notes.tokenAsked = "Answered";
        return answered;
      } catch (failure: unknown) {
        notes.tokenAsked = setupTokenFault(failure);
        throw failure;
      }
    }
    if (request !== consoleConfigurationPath)
      return fetchJsonThrough(ports.fetchJson, request);
    const configuration = parseConsoleConfiguration(
      await fetchJsonThrough(ports.fetchJson, `${site}${request}`),
    );
    notes.configured = true;
    return {
      issuer: configuration.issuer,
      audience: configuration.audience,
      clientId: setupClientId,
      redirectUri: setupRedirectUri(port),
      scopes: [...setupScopes],
    };
  };
}

/**
 * A session for `site`, restored from `held` where a renewal token was
 * remembered. `port` is where a sign-in started from it returns to; a session
 * that starts none names the registered address and never uses it.
 */
export function setupSessionOpened(
  ports: SetupPorts,
  site: string,
  held: string | undefined,
  port: number | undefined,
): SetupSessionOpened {
  const notes: SetupSessionNotes = {
    configured: false,
    tokenAsked: "Unasked",
    authorize: undefined,
  };
  const store = setupTokenStore(ports.files, site, held);
  const holder = createSessionHolder({
    nowMs: ports.nowMs,
    sleepMs: (ms) => ports.sleepMs(ms),
    fetchJson: setupFetchJson(ports, site, port, { notes, store }),
    persistent: store,
    transient: setupMemory(),
    digest: ports.digest,
    drawBytes: ports.drawBytes,
    redirect: (url) => {
      notes.authorize = url;
    },
  });
  const api = apiPortsOver(
    holder,
    (path, init) => ports.apiFetch(`${site}${path}`, init),
    (ms, signal) => ports.sleepMs(Math.min(ms, setupRetryDelayMsMax), signal),
  );
  return {
    site,
    holder,
    api,
    store,
    configured: () => notes.configured,
    tokenAsked: () => notes.tokenAsked,
    authorize: () => notes.authorize,
  };
}

/** The workspaces a role names a person in, each with whether they administer it, and whether the site sent only part of them. */
export interface SetupWorkspacesAnswered {
  readonly tenants: readonly AccessCallerTenant[];
  readonly truncated: boolean;
}

/** What the site says of whoever a session is, or why it did not say. */
export type SetupWorkspaces =
  | ({ readonly read: "Answered" } & SetupWorkspacesAnswered)
  | { readonly read: "Unread"; readonly outcome: ApiFailure["outcome"] };

/** The read that confirms a sign-in: an issuer can hand out a token the site then refuses. */
export async function setupWorkspacesRead(
  opened: SetupSessionOpened,
): Promise<SetupWorkspaces> {
  const read = await apiCallerTenants(opened.api);
  if (read.outcome !== "Ok") return { read: "Unread", outcome: read.outcome };
  return {
    read: "Answered",
    tenants: read.value.tenants,
    truncated: read.value.truncated,
  };
}
