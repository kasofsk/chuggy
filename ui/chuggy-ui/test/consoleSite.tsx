/**
 * The whole console over a fake network: the real route tree, shell, query
 * defaults and stream, mounted as `main.tsx` mounts them, with the ports that
 * reach the network answered by one site a suite drives on a fake clock.
 *
 * EVERY READ IS ANSWERED FROM A FIXTURE AND PARSED BY ITS ROUTE'S SCHEMA as
 * it is sent, and a fixture that has drifted from the contract is remembered
 * by its address and why, so a suite fails on it by name rather than drawing
 * an unreadable panel nobody looks at. A read the table has no route for is
 * answered not found and remembered, so a suite can say every read a screen
 * made was one it answered.
 *
 * THE SITE IS UP OR DOWN, AND ONE ROUTE MAY FAIL ALONE. Down answers every
 * read and every stream open `503`, as a deploy does; a failing route answers
 * a fault until it heals. The stream is `streamDouble.ts`'s, answered by what
 * the site is at each open, and the site sends a heartbeat down it on the
 * server's cadence, so a connection is cut only when a case cuts it.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, useState } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import type { z } from "zod";

import { ticketActionReachResponseSchema } from "../../../src/contract/actionReach.ts";
import {
  accessCallerTenantsSchema,
  accessInviteLinksSchema,
  accessSiteTenantsSchema,
  accessWorkspaceLinksSchema,
  accessProjectAuthoritiesSchema,
  accessProjectPeopleSchema,
  accessSiteAbilitiesSchema,
  accessSiteAuthoritiesSchema,
  accessTenantAbilitiesSchema,
  accessTenantAuthoritiesSchema,
  accessTenantPeopleSchema,
} from "../../../src/contract/accessPlane.ts";
import {
  agenticRefusalsResponseSchema,
  chatAbilitiesResponseSchema,
  chatHostResponseSchema,
  chatThreadsResponseSchema,
  configurationResponseSchema,
  configurationsResponseSchema,
  dispatchViewResponseSchema,
  draftInitializationResponseSchema,
  draftResponseSchema,
  executionPlacementResponseSchema,
  executionsResponseSchema,
  forgeAppsResponseSchema,
  forgeInstallationPermissionsResponseSchema,
  forgeInstallationsResponseSchema,
  hostedRunsResponseSchema,
  leadReadResponseSchema,
  leadTranscriptResponseSchema,
  personalRunnerPermitResponseSchema,
  personalRunnerResponseSchema,
  projectAbilitiesResponseSchema,
  projectInventoryResponseSchema,
  projectNativeActionsResponseSchema,
  projectOwnerFallbackResponseSchema,
  projectRepositoriesResponseSchema,
  projectResponseSchema,
  selectorProjectSettingsResponseSchema,
  selectorProposalsResponseSchema,
  selectorSettingsHistoryResponseSchema,
  sessionPlacementResponseSchema,
  threadResponseSchema,
  threadsResponseSchema,
  threadTranscriptResponseSchema,
  ticketLandingsResponseSchema,
  ticketNativeActionsResponseSchema,
  ticketResponseSchema,
  workerPoolsResponseSchema,
} from "../../../src/contract/responses.ts";
import { InviteProvider } from "../app/browser/InvitePage.tsx";
import { consoleRouterOver } from "../app/browser/routes.tsx";
import { SessionProvider, useSilentRefresh } from "../app/browser/session.tsx";
import type { ApiFetchInit } from "../app/core/apiRequest.ts";
import { panelQueryDefaults } from "../app/core/panelQueryDefaults.ts";
import { projectStreamHeartbeatMs } from "../app/core/projectStream.ts";
import type {
  SessionHolder,
  SessionSnapshot,
} from "../app/core/sessionHolder.ts";
import type { StreamResponse } from "../app/core/streamConnection.ts";
import { consoleNetworkHeld } from "./consoleNetwork.ts";
import type { ConsoleNetwork } from "./consoleNetwork.ts";
import { forgeInstallationsFixture } from "./forgeInstallationsFixture.ts";
import { inviteBrowser } from "./inviteDouble.ts";
import {
  leadBody,
  leadRefusals,
  leadSelectorSettingsBody,
  leadTranscriptPage,
} from "./leadFixture.ts";
import { abilitiesEvery } from "./projectAbilitiesFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  ticketLandedNowhere,
  ticketLandingsNone,
} from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import {
  permissionsAbilitiesTenant,
  permissionsPeopleListed,
  projectAuthoritiesStarting,
  projectPeopleListed,
  siteAuthoritiesStarting,
  tenantAuthoritiesStarting,
} from "./settings/permissionsFixture.tsx";
import {
  workspaceLinksListed,
  workspacesAbilitiesEvery,
  workspacesListed,
} from "./settings/siteWorkspacesFixture.tsx";
import { linksListed } from "./settings/tenantPeopleFixture.tsx";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";
import {
  threadBody,
  threadMineSession,
  threadsBody,
  threadTranscriptPage,
} from "./threadFixture.ts";
import {
  creationBinding,
  creationDeclared,
  creationDraft,
  creationInitialization,
  creationListed,
  creationPartition,
} from "./ticketCreationFixture.ts";
import { ticketDispatchViewOf, ticketPageTicket } from "./ticketPageFixture.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import { executionPlacementBody } from "./workRunnerFixture.ts";

/** The one project every screen of the site is in. */
export const consolePartition = creationPartition;

/** The repository the project has bound, which its own page is addressed by. */
export const consoleRepository = "https://forge.test/kasofsk/chuggy";

/** What each parameter a route declares is filled with, so a route is
 * visited at an address its fixtures answer. */
export const consoleRouteParameters: Readonly<Record<string, string>> = {
  tenant: consolePartition.tenant,
  project: consolePartition.project,
  ticket: String(ticketPageTicket.ticket),
  session: threadMineSession,
  repository: encodeURIComponent(consoleRepository),
};

/** One read the site answers: the paths it is asked on, the schema the
 * console parses it with, and the fixture it is answered with. */
interface ConsoleRead {
  readonly path: RegExp;
  readonly schema: z.ZodType;
  readonly body: (url: URL) => unknown;
}

const tenantPath = `/api/v1/tenants/${consolePartition.tenant}`;
const projectPath = `${tenantPath}/projects/${consolePartition.project}`;
const accessTenantPath = `/access/v1/tenants/${consolePartition.tenant}`;
const ticketPath = `${projectPath}/tickets/`;

/** The ticket a path under `/tickets/` names. */
function consoleTicketOf(url: URL): number {
  return Number(url.pathname.slice(ticketPath.length).split("/")[0]);
}

/** The paths `path` begins, with `rest` the pattern of what follows it. */
function consoleReadUnder(path: string, rest: string): RegExp {
  return new RegExp(
    `^${path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}${rest}$`,
    "u",
  );
}

function consoleReadAt(path: string): RegExp {
  return consoleReadUnder(path, "");
}

const consoleReads: readonly ConsoleRead[] = [
  {
    path: consoleReadAt("/api/v1/projects"),
    schema: projectInventoryResponseSchema,
    body: () => ({ projects: [consolePartition] }),
  },
  {
    path: consoleReadAt(projectPath),
    schema: projectResponseSchema,
    body: (url) => ({
      partition: consolePartition,
      sequence: 42,
      tickets: url.searchParams.has("phase") ? [] : [ticketPageTicket],
    }),
  },
  {
    path: consoleReadAt(`${projectPath}/abilities`),
    schema: projectAbilitiesResponseSchema,
    body: () => abilitiesEvery,
  },
  {
    path: consoleReadAt(`${projectPath}/lead`),
    schema: leadReadResponseSchema,
    body: () => leadBody(1, 1),
  },
  {
    path: consoleReadAt(`${projectPath}/lead/transcript`),
    schema: leadTranscriptResponseSchema,
    body: () => leadTranscriptPage(0, 1),
  },
  {
    path: consoleReadAt(`${projectPath}/selector-proposals`),
    schema: selectorProposalsResponseSchema,
    body: () => ({ proposals: [], more: false }),
  },
  {
    path: consoleReadAt(`${projectPath}/native-actions`),
    schema: projectNativeActionsResponseSchema,
    body: () => ({ actions: [] }),
  },
  {
    path: consoleReadAt(`${projectPath}/agentic-refusals`),
    schema: agenticRefusalsResponseSchema,
    body: () => leadRefusals(false),
  },
  {
    path: consoleReadAt(`${projectPath}/selector-settings`),
    schema: selectorProjectSettingsResponseSchema,
    body: () => leadSelectorSettingsBody(12, { northStar: "ship the console" }),
  },
  {
    path: consoleReadAt(`${projectPath}/selector-settings/history`),
    schema: selectorSettingsHistoryResponseSchema,
    body: () => ({ revisions: [] }),
  },
  {
    path: consoleReadAt(`${projectPath}/threads`),
    schema: threadsResponseSchema,
    body: () => threadsBody(),
  },
  {
    path: consoleReadUnder(`${projectPath}/threads/`, "[^/]+"),
    schema: threadResponseSchema,
    body: (url) =>
      threadBody({
        session: decodeURIComponent(url.pathname.split("/").at(-1) ?? ""),
      }),
  },
  {
    path: consoleReadUnder(`${projectPath}/threads/`, "[^/]+/transcript"),
    schema: threadTranscriptResponseSchema,
    body: () => threadTranscriptPage(0),
  },
  {
    path: consoleReadAt(`${projectPath}/session-placement`),
    schema: sessionPlacementResponseSchema,
    body: () => sessionPlacementBody(),
  },
  {
    path: consoleReadAt(`${projectPath}/execution-placement`),
    schema: executionPlacementResponseSchema,
    body: () => executionPlacementBody(),
  },
  {
    path: consoleReadAt(`${projectPath}/owner-fallback`),
    schema: projectOwnerFallbackResponseSchema,
    body: () => ({ administers: false }),
  },
  {
    path: consoleReadAt(`${projectPath}/hosted-runs`),
    schema: hostedRunsResponseSchema,
    body: () => ({ granted: true }),
  },
  {
    path: consoleReadAt(`${projectPath}/repositories`),
    schema: projectRepositoriesResponseSchema,
    body: () => ({
      repositories: [
        creationListed(creationBinding(consoleRepository), "Imported"),
      ],
    }),
  },
  {
    path: consoleReadAt(`${projectPath}/configurations`),
    schema: configurationsResponseSchema,
    body: () => ({
      configurations: [
        creationDeclared("n-development", consoleRepository, "development"),
      ],
    }),
  },
  {
    path: consoleReadUnder(`${projectPath}/configurations/`, "[^/]+"),
    schema: configurationResponseSchema,
    body: (url) => ({
      ...creationInitialization.configuration,
      revision: decodeURIComponent(url.pathname.split("/").at(-1) ?? ""),
    }),
  },
  {
    path: consoleReadUnder(`${projectPath}/draft-initializations/`, "[^/]+"),
    schema: draftInitializationResponseSchema,
    body: (url) => ({
      ...creationInitialization,
      configuration: {
        ...creationInitialization.configuration,
        revision: decodeURIComponent(url.pathname.split("/").at(-1) ?? ""),
      },
    }),
  },
  {
    path: consoleReadAt(`${projectPath}/executions`),
    schema: executionsResponseSchema,
    body: () => ({ executions: [] }),
  },
  {
    path: consoleReadAt(`${projectPath}/worker-pools`),
    schema: workerPoolsResponseSchema,
    body: () => ({ pools: [], truncated: false }),
  },
  {
    path: consoleReadAt(`${projectPath}/dispatch-view`),
    schema: dispatchViewResponseSchema,
    body: () => ticketDispatchViewOf(consolePartition, []),
  },
  {
    path: consoleReadUnder(ticketPath, "[0-9]+"),
    schema: ticketResponseSchema,
    body: (url) => ({ ...ticketPageTicket, ticket: consoleTicketOf(url) }),
  },
  {
    path: consoleReadUnder(ticketPath, "[0-9]+/native-actions"),
    schema: ticketNativeActionsResponseSchema,
    body: () => ({ actions: [] }),
  },
  {
    path: consoleReadUnder(ticketPath, "[0-9]+/landings"),
    schema: ticketLandingsResponseSchema,
    body: () => ticketLandingsNone,
  },
  {
    path: consoleReadUnder(ticketPath, "[0-9]+/action-reach"),
    schema: ticketActionReachResponseSchema,
    body: () => ticketLandedNowhere,
  },
  {
    path: consoleReadUnder(`${projectPath}/drafts/`, "[0-9]+"),
    schema: draftResponseSchema,
    body: () => ({ ...creationDraft, ticket: ticketPageTicket.ticket }),
  },
  {
    path: consoleReadAt(`${tenantPath}/chat/abilities`),
    schema: chatAbilitiesResponseSchema,
    body: () => ({
      principal: abilitiesEvery.principal,
      openUnscopedChat: true,
      executeHosted: true,
      registerPersonalRunner: true,
      administerTenant: true,
    }),
  },
  {
    path: consoleReadAt(`${tenantPath}/chat/threads`),
    schema: chatThreadsResponseSchema,
    body: () => ({ threads: [] }),
  },
  {
    path: consoleReadUnder(`${tenantPath}/chat/threads/`, "[^/]+"),
    schema: threadResponseSchema,
    body: (url) =>
      threadBody({
        session: decodeURIComponent(url.pathname.split("/").at(-1) ?? ""),
      }),
  },
  {
    path: consoleReadUnder(`${tenantPath}/chat/threads/`, "[^/]+/transcript"),
    schema: threadTranscriptResponseSchema,
    body: () => threadTranscriptPage(0),
  },
  {
    path: consoleReadAt(`${tenantPath}/forge-installations`),
    schema: forgeInstallationsResponseSchema,
    body: () => forgeInstallationsFixture,
  },
  {
    path: consoleReadUnder(
      `${tenantPath}/forge-installations/`,
      "[^/]+/permissions",
    ),
    schema: forgeInstallationPermissionsResponseSchema,
    body: () => ({
      permissions: "Current",
      settingsUrl: "https://github.com/settings/installations/11",
    }),
  },
  {
    path: consoleReadAt("/api/v1/forge/github"),
    schema: forgeAppsResponseSchema,
    body: () => ({ apps: [] }),
  },
  {
    path: consoleReadAt(`${tenantPath}/personal-runner-permit`),
    schema: personalRunnerPermitResponseSchema,
    body: () => ({ granted: true }),
  },
  {
    path: consoleReadAt(`${tenantPath}/personal-runner`),
    schema: personalRunnerResponseSchema,
    body: () => ({
      runners: [
        {
          id: "runner-one",
          capabilities: [],
          registeredAt: "2026-08-26T00:00:00Z",
          live: true,
          executionsLive: false,
        },
      ],
      projects: [],
    }),
  },
  {
    path: consoleReadAt(`${tenantPath}/chat-host`),
    schema: chatHostResponseSchema,
    body: () => ({
      id: "host-one",
      registeredAt: "2026-08-26T00:00:00Z",
      live: true,
    }),
  },
  {
    path: consoleReadAt("/access/v1/site/abilities"),
    schema: accessSiteAbilitiesSchema,
    body: () => workspacesAbilitiesEvery,
  },
  {
    path: consoleReadAt("/access/v1/site/authorities"),
    schema: accessSiteAuthoritiesSchema,
    body: () => siteAuthoritiesStarting,
  },
  {
    path: consoleReadAt("/access/v1/site/workspaces"),
    schema: accessSiteTenantsSchema,
    body: () => workspacesListed,
  },
  {
    path: consoleReadAt("/access/v1/site/workspace-links"),
    schema: accessWorkspaceLinksSchema,
    body: () => workspaceLinksListed,
  },
  {
    path: consoleReadAt("/access/v1/workspaces"),
    schema: accessCallerTenantsSchema,
    body: () => ({ tenants: [], truncated: false }),
  },
  {
    path: consoleReadAt(`${accessTenantPath}/abilities`),
    schema: accessTenantAbilitiesSchema,
    body: () => permissionsAbilitiesTenant,
  },
  {
    path: consoleReadAt(`${accessTenantPath}/people`),
    schema: accessTenantPeopleSchema,
    body: () => permissionsPeopleListed,
  },
  {
    path: consoleReadAt(`${accessTenantPath}/invite-links`),
    schema: accessInviteLinksSchema,
    body: () => linksListed,
  },
  {
    path: consoleReadAt(`${accessTenantPath}/authorities`),
    schema: accessTenantAuthoritiesSchema,
    body: () => tenantAuthoritiesStarting,
  },
  {
    path: consoleReadAt(
      `${accessTenantPath}/projects/${consolePartition.project}/people`,
    ),
    schema: accessProjectPeopleSchema,
    body: () => projectPeopleListed,
  },
  {
    path: consoleReadAt(
      `${accessTenantPath}/projects/${consolePartition.project}/authorities`,
    ),
    schema: accessProjectAuthoritiesSchema,
    body: () => projectAuthoritiesStarting,
  },
];

export interface ConsoleSite extends ConsoleNetwork {
  /** Down answers every read and every open `503`, as a deploy does. */
  up: boolean;
  /** A route that answers a fault until it is cleared. */
  failing: RegExp | undefined;
  /** Every request the table had no route for. */
  readonly unrouted: string[];
  /** Every fixture its route's schema refused, with why. */
  readonly drifted: string[];
  /** Every open that asked for no replay after the stream had handed over a
   * frame with an id, by the newest id it had handed over: what the gap held
   * is lost to that console. */
  readonly cursorsDropped: number[];
  readonly stream: StreamServer;
  /** When the stream last stopped carrying, by the site's own account: a
   * connection it closed, cut or refused, and nothing once one carries. */
  readonly carryingLostAtMs: () => number | undefined;
  /** A change frame logged under the next id, sent down the connection that
   * carries and replayed to an open that asks from before it. */
  readonly emit: (event: string, data: unknown) => void;
  /** The connection that is open closed, as the server does at an open's age. */
  readonly close: () => void;
  /** The connection that is open reset, as a network that drops it does. */
  readonly cut: () => void;
}

/** What a deploy answers with: busy, for a few seconds. */
const consoleSiteBusySeconds = "5";

/** How long every answer takes on the fake clock, so a reopen has a moment
 * in which the console is between connections, as it has on a network. */
const consoleSiteLatencyMs = 50;

function consoleSiteLate<T>(answered: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    setTimeout(() => {
      resolve(answered());
    }, consoleSiteLatencyMs);
  });
}

function consoleSiteRead(site: ConsoleSite, url: string): Response {
  const address = new URL(url, "http://console.test");
  const read = consoleReads.find((entry) => entry.path.test(address.pathname));
  if (read === undefined) {
    site.unrouted.push(`GET ${url}`);
    return answer({ error: { code: "NotFound" } }, 404);
  }
  if (site.failing?.test(address.pathname) === true)
    return answer({ error: { code: "InternalError" } }, 500);
  const body = read.body(address);
  const parsed = read.schema.safeParse(body);
  if (!parsed.success) site.drifted.push(`${url}: ${parsed.error.message}`);
  return answer(body);
}

function consoleSiteAnswered(
  site: ConsoleSite,
  url: string,
  init: ApiFetchInit,
): Response {
  if (!site.up)
    return new Response("", {
      status: 503,
      headers: { "retry-after": consoleSiteBusySeconds },
    });
  if (init.method !== "GET") {
    site.unrouted.push(`${init.method} ${url}`);
    return answer({ error: { code: "NotFound" } }, 404);
  }
  return consoleSiteRead(site, url);
}

/** One change frame the site has logged. */
interface ConsoleSiteLogged {
  readonly id: number;
  readonly chunk: string;
}

/** What the site's stream holds across its opens. */
interface ConsoleSiteStream {
  readonly logged: ConsoleSiteLogged[];
  nextId: number;
  /** The newest id handed over on a connection, where any was. */
  deliveredId: number | undefined;
  /** Since when no connection has carried, as `carryingLostAtMs` says. */
  lostAtMs: number | undefined;
}

/** What one open is answered with after `ready` and `source`: the log after
 * the id it asks from, and nothing where it asks from nowhere. */
function consoleSiteReplayed(
  held: ConsoleSiteStream,
  site: ConsoleSite,
): readonly string[] {
  const asked = site.stream.headersSeen.at(-1)?.["last-event-id"];
  if (asked === undefined) {
    if (held.deliveredId !== undefined)
      site.cursorsDropped.push(held.deliveredId);
    return [];
  }
  const cursor = Number(asked);
  const replayed = held.logged.filter((logged) => logged.id > cursor);
  const newest = replayed.at(-1);
  if (newest !== undefined) held.deliveredId = newest.id;
  return replayed.map((logged) => logged.chunk);
}

/**
 * The site at its start: up, every route answering, and a stream that opens
 * live. A heartbeat goes down whatever connection is open on the server's
 * cadence, on the clock the suite fakes.
 */
export function consoleSiteOpened(): ConsoleSite {
  const held: ConsoleSiteStream = {
    logged: [],
    nextId: 1,
    deliveredId: undefined,
    lostAtMs: Date.now(),
  };
  const lost = (): void => {
    held.lostAtMs ??= Date.now();
  };
  const site: ConsoleSite = {
    up: true,
    failing: undefined,
    unrouted: [],
    drifted: [],
    cursorsDropped: [],
    stream: streamServer(() => {
      if (!site.up) {
        lost();
        return { status: 503, retryAfter: consoleSiteBusySeconds };
      }
      held.lostAtMs = undefined;
      return {
        status: 200,
        chunks: [
          frame("ready", undefined, { version: 1 }),
          frame("source", undefined, { version: 1, state: "live" }),
          ...consoleSiteReplayed(held, site),
        ],
        hold: true,
      };
    }),
    carryingLostAtMs: () => held.lostAtMs,
    emit: (event, data) => {
      const id = held.nextId;
      held.nextId += 1;
      const chunk = frame(event, String(id), data);
      held.logged.push({ id, chunk });
      if (held.lostAtMs !== undefined) return;
      held.deliveredId = id;
      site.stream.push(chunk);
    },
    close: () => {
      lost();
      site.stream.close();
    },
    cut: () => {
      lost();
      site.stream.cut();
    },
    apiFetch: (url, init) =>
      consoleSiteLate(() => consoleSiteAnswered(site, url, init)),
    streamFetch: (url, init): Promise<StreamResponse> =>
      consoleSiteLate(() => site.stream.ports.fetch(url, init)),
  };
  setInterval(() => {
    if (held.lostAtMs === undefined) site.stream.push(": heartbeat\n\n");
  }, projectStreamHeartbeatMs);
  return site;
}

/** A signed-in session whose token is renewed every `renewEveryMs`, by the
 * console's own timer, and each renewal is a new generation and bearer. */
export interface ConsoleSession {
  readonly holder: SessionHolder;
  readonly renewals: () => number;
}

const consoleSignedIn: SessionSnapshot = {
  phase: "SignedIn",
  reason: undefined,
  configuration: undefined,
};

export function consoleSession(renewEveryMs?: number): ConsoleSession {
  let generation = 1;
  const heard = new Set<() => void>();
  const dueAt = (): number | undefined =>
    renewEveryMs === undefined ? undefined : Date.now() + renewEveryMs;
  let dueAtMs = dueAt();
  const holder: SessionHolder = {
    load: () => Promise.resolve(),
    completeCallback: () => Promise.resolve({ result: "None" as const }),
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    bearer: () => Promise.resolve(`token-${String(generation)}`),
    refresh: () => {
      generation += 1;
      dueAtMs = dueAt();
      for (const told of heard) told();
      return Promise.resolve(true);
    },
    refuse: () => undefined,
    refreshDueAtMs: () => dueAtMs,
    generation: () => generation,
    snapshot: () => consoleSignedIn,
    subscribe: (told) => {
      heard.add(told);
      return () => {
        heard.delete(told);
      };
    },
  };
  return { holder, renewals: () => generation - 1 };
}

/** What `App` draws once signed in, with the router handed in rather than
 * the browser's, and the renewal timer `App` runs. */
function ConsoleSignedIn(props: {
  readonly path: string;
  readonly client: QueryClient;
}): ReactNode {
  useSilentRefresh();
  const [router] = useState(() =>
    consoleRouterOver(createMemoryHistory({ initialEntries: [props.path] })),
  );
  return (
    <QueryClientProvider client={props.client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

/** The browser the console is mounted in: a desk-wide viewport that lays
 * nothing out, scrolls nothing and observes nothing. */
function consoleBrowserStubbed(): void {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm, {});
  vi.stubGlobal("scrollTo", () => undefined);
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}

/** A site made for each case of a file, on a fake clock and in a browser
 * stubbed as the console needs, and taken away after it; `made` is told each
 * one. The file's own `vi.mock` of `ports.ts` is what reaches it. */
export function consoleSiteEachCase(made: (site: ConsoleSite) => void): void {
  beforeEach(() => {
    vi.useFakeTimers();
    consoleBrowserStubbed();
    const site = consoleSiteOpened();
    consoleNetworkHeld.current = site;
    made(site);
  });
  afterEach(() => {
    cleanup();
    consoleNetworkHeld.current = undefined;
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}

/** The console mounted at `path` over the site, as `main.tsx` mounts it. */
export function consoleMounted(
  path: string,
  session: ConsoleSession = consoleSession(),
): void {
  const client = new QueryClient({
    defaultOptions: { queries: panelQueryDefaults },
  });
  const invite = inviteBrowser({ pathname: path });
  render(
    <StrictMode>
      <SessionProvider holder={session.holder}>
        <InviteProvider holder={invite.holder}>
          <ConsoleSignedIn path={path} client={client} />
        </InviteProvider>
      </SessionProvider>
    </StrictMode>,
  );
}

/** The fake clock moved on by `ms`, every timer and read it releases run and
 * drawn. */
export async function consoleAdvanced(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
