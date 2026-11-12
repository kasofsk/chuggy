/**
 * The API a served console talks to in a rendered case: one member signed in,
 * one workspace, one project, and every answer one row of `stubApiReads`.
 *
 * EVERY BODY IS PARSED BY ITS ROUTE'S CONTRACT SCHEMA WHEN ITS ROW IS MADE,
 * so a body the contract would refuse throws as this module loads, naming
 * the route, rather than being sent to a screen that then draws its error
 * state. What is sent is the body as written, because a schema's parse may
 * fill or transform what the wire would not carry.
 *
 * TO ANSWER A NEW READ, add one `stubApiRead` row here: its method, its path
 * as the console asks it, the schema `src/contract/` gives that route and the
 * body. A read with no row is answered 404 and is listed in
 * `Served.unanswered`, so a case says every read its screen made was one it
 * stubbed.
 */

import type { z } from "zod";

import {
  accessProjectPeopleSchema,
  accessSiteAbilitiesSchema,
} from "../../../../src/contract/accessPlane.ts";
import {
  agentAccountsResponseSchema,
  chatAbilitiesResponseSchema,
  chatHostResponseSchema,
  hostedRunsResponseSchema,
  executionPlacementResponseSchema,
  inboxResponseSchema,
  landingQueuesResponseSchema,
  leadReadResponseSchema,
  projectAbilitiesResponseSchema,
  projectOwnerFallbackResponseSchema,
  projectRepositoriesResponseSchema,
  projectInventoryResponseSchema,
  projectResponseSchema,
  personalRunnerPermitResponseSchema,
  personalRunnerResponseSchema,
  sessionPlacementResponseSchema,
  threadsResponseSchema,
  workerPoolsResponseSchema,
  workerPoolTokenResponseSchema,
} from "../../../../src/contract/responses.ts";

export const stubApiTenant = "tenant-rendered";
export const stubApiProject = "project-rendered";

/** A JSON answer, or a server-sent stream held open with no frame on it. */
export type StubApiRead =
  | {
      readonly kind: "Json";
      readonly method: string;
      readonly path: string;
      readonly status: number;
      readonly body: unknown;
    }
  | { readonly kind: "Stream"; readonly method: "GET"; readonly path: string };

/** One route's answer, held to the contract's schema as it is made. */
export function stubApiRead(
  path: string,
  schema: z.ZodType,
  body: unknown,
  method = "GET",
): StubApiRead {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      `the stub for ${method} ${path} is refused by its schema: ${parsed.error.message}`,
    );
  return { kind: "Json", method, path, status: 200, body };
}

/** A stream that opens and stays open, so the console reads itself live. */
export function stubApiStream(path: string): StubApiRead {
  return { kind: "Stream", method: "GET", path };
}

const projectPath = `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}`;
const partition = { tenant: stubApiTenant, project: stubApiProject };
const principal = "issuer member";

/** The project's one ticket, created by the member, released, and still Pending. */
const ticket = {
  ticket: 1,
  creator: principal,
  phase: "Pending",
  sequence: 1,
  revision: 1,
  releasedAt: "2026-11-01T00:00:00Z",
  changedAt: "2026-11-02T00:00:00Z",
  revokedDependencies: [],
  openDependencies: [],
};

/** The project's runners: one live and current, one behind the version
 * chuggy pins, and one that has never polled. */
const workerPools = {
  truncated: false,
  pools: [
    {
      pool: "build-linux",
      capabilities: ["Platform:Linux:Amd64"],
      registeredAt: "2026-10-01T00:00:00Z",
      polledAt: "2026-11-02T00:00:00Z",
      live: true,
      runner: { package: "chuggy-linux", version: "0.10.0", pinned: "0.10.0" },
    },
    {
      pool: "studio-mac",
      capabilities: ["Platform:Darwin:Arm64"],
      registeredAt: "2026-10-01T00:00:00Z",
      polledAt: "2026-10-20T00:00:00Z",
      live: false,
      runner: { package: "chuggy-darwin", version: "0.9.0", pinned: "0.10.0" },
    },
    {
      pool: "spare",
      capabilities: [],
      registeredAt: "2026-10-01T00:00:00Z",
      live: false,
    },
  ],
};

const tenantPath = `/api/v1/tenants/${stubApiTenant}`;

/** The member's own runners: one live, running the project's ticket, and one
 * behind the version chuggy pins that has never polled. */
const personalRunner = {
  runners: [
    {
      id: "chuggy-personal-3f2a9c1e-0000-4000-8000-000000000000",
      capabilities: ["Platform:Linux:Amd64"],
      registeredAt: "2026-10-01T00:00:00Z",
      polledAt: "2026-11-02T00:00:00Z",
      live: true,
      executionsLive: true,
      runner: { package: "chuggy-linux", version: "0.10.0", pinned: "0.10.0" },
      held: [
        {
          project: stubApiProject,
          ticket: 1,
          identity: { type: "WorkTask", value: { ticket: 1, cycle: 1 } },
        },
      ],
      heldTruncated: false,
    },
    {
      id: "chuggy-personal-a81c04d2-0000-4000-8000-000000000000",
      capabilities: ["Platform:Darwin:Arm64"],
      registeredAt: "2026-10-01T00:00:00Z",
      live: false,
      executionsLive: false,
      runner: { package: "chuggy-darwin", version: "0.9.0", pinned: "0.10.0" },
      held: [],
      heldTruncated: false,
    },
  ],
  projects: [
    {
      project: stubApiProject,
      priority: "Normal",
      waiting: 0,
      waitingTruncated: false,
    },
  ],
};

/** The reads every case is answered, a route to a row. */
export const stubApiReads: readonly StubApiRead[] = [
  stubApiRead("/api/v1/projects", projectInventoryResponseSchema, {
    projects: [partition],
  }),
  stubApiRead(projectPath, projectResponseSchema, {
    partition,
    sequence: 1,
    tickets: [ticket],
  }),
  stubApiStream(`${projectPath}/events`),
  stubApiRead(`${projectPath}/abilities`, projectAbilitiesResponseSchema, {
    principal,
    mutate: true,
    dispatch: true,
    manageSelector: false,
    overrideTicketConfig: false,
    skipPlannedEvaluations: false,
    administer: false,
    writeEpic: true,
  }),
  stubApiRead(
    `/api/v1/tenants/${stubApiTenant}/chat/abilities`,
    chatAbilitiesResponseSchema,
    {
      principal,
      openUnscopedChat: false,
      executeHosted: false,
      registerPersonalRunner: false,
      administerTenant: false,
    },
  ),
  stubApiRead(`${projectPath}/inbox`, inboxResponseSchema, {
    entries: [],
    count: 0,
    more: false,
  }),
  stubApiRead(`${projectPath}/lead`, leadReadResponseSchema, { lead: "None" }),
  stubApiRead(
    `${projectPath}/repositories`,
    projectRepositoriesResponseSchema,
    {
      repositories: [],
    },
  ),
  stubApiRead(`${projectPath}/landing-queues`, landingQueuesResponseSchema, {
    queues: [],
    truncated: false,
  }),
  stubApiRead(
    `${projectPath}/execution-placement`,
    executionPlacementResponseSchema,
    {
      work: { route: "Pool", source: "Default" },
      evaluation: { route: "Pool", source: "Default" },
      choices: ["Pool"],
    },
  ),
  stubApiRead(
    `${projectPath}/session-placement`,
    sessionPlacementResponseSchema,
    {
      thread: { route: "Pool", source: "Default" },
      lead: { route: "Pool", source: "Default" },
      leadOffering: "Own",
      leadOfferings: ["Own"],
      choices: ["Pool"],
      runners: { mine: "Live", inquiry: "Live", project: "Live" },
    },
  ),
  stubApiRead(`${projectPath}/hosted-runs`, hostedRunsResponseSchema, {
    granted: false,
  }),
  stubApiRead(`${projectPath}/threads`, threadsResponseSchema, { threads: [] }),
  stubApiRead(
    `${projectPath}/worker-pools`,
    workerPoolsResponseSchema,
    workerPools,
  ),
  stubApiRead(
    `${projectPath}/worker-pool-registration-tokens`,
    workerPoolTokenResponseSchema,
    {
      token: "stub-registration-token",
      expiresAtMs: Date.parse("2030-01-01T00:00:00Z"),
    },
    "POST",
  ),
  stubApiRead(
    `${tenantPath}/personal-runner-permit`,
    personalRunnerPermitResponseSchema,
    { granted: true },
  ),
  stubApiRead(
    `${tenantPath}/personal-runner`,
    personalRunnerResponseSchema,
    personalRunner,
  ),
  stubApiRead(`${tenantPath}/chat-host`, chatHostResponseSchema, {
    id: "chuggy-personal-5b7d2e90-0000-4000-8000-000000000000",
    registeredAt: "2026-10-01T00:00:00Z",
    live: false,
  }),
  stubApiRead("/api/v1/agent-accounts", agentAccountsResponseSchema, {
    accounts: ["Claude", "Codex"].map((agent) => ({
      agent,
      settings: {
        fiveHourPercent: 90,
        sevenDayPercent: 90,
        pausesThreads: false,
      },
      readings: [],
    })),
  }),
  stubApiRead("/access/v1/site/abilities", accessSiteAbilitiesSchema, {
    administer: false,
    createAccount: false,
    createTenant: false,
    manageAuthorities: false,
  }),
  stubApiRead(
    `${projectPath}/owner-fallback`,
    projectOwnerFallbackResponseSchema,
    { administers: false },
  ),
  stubApiRead(
    `/access/v1/tenants/${stubApiTenant}/projects/${stubApiProject}/people`,
    accessProjectPeopleSchema,
    {
      tenant: stubApiTenant,
      project: stubApiProject,
      people: [
        {
          subject: principal,
          mine: true,
          tenantAdmin: false,
          roles: ["Developer"],
        },
      ],
      otherIssuers: 0,
      truncated: false,
    },
  ),
];

/** The answer to a request: a case's own rows first, then the stub's. The
 * query does not choose a row; a later case that needs it to adds a row that
 * reads it. */
export function stubApiAnswer(
  caseReads: readonly StubApiRead[],
  method: string,
  url: URL,
): StubApiRead | undefined {
  return [...caseReads, ...stubApiReads].find(
    (read) => read.method === method && read.path === url.pathname,
  );
}
