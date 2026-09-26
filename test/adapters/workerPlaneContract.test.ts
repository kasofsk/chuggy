/**
 * The job plane held to its contract from the provider's side: the app serves
 * exactly the routes the contract names, and every answer a handler gives
 * parses under the answer map's schema for its route and status.
 *
 * EVERY OUTCOME A FAKE PORT CAN ANSWER IS DRIVEN. A port's outcomes are listed
 * from the interpreter's own roster where one exists, and otherwise in a record
 * keyed by the union's discriminant, which fails to compile when the union
 * gains a member; each is then answered with a status the map must list.
 *
 * AN ANSWER NAMES NOTHING ITS SCHEMA DOES NOT. The schemas drop a field they do
 * not name, for an older pod's sake, so each answer must also equal its own
 * parse: a field the server renamed is a failure here rather than a drop.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import {
  createWorkerPlaneApp,
  workerPlaneHealthRoutes,
  type WorkerPlaneServerService,
} from "../../src/adapters/http/workerPlaneServer.ts";
import {
  runConfigurationBytesMax,
  runTranscriptBatchBytesMax,
  runTranscriptBatchesMax,
} from "../../src/contract/http.ts";
import { sessionPlaneRoutes } from "../../src/contract/sessionPlane.ts";
import {
  workerPlaneAnswers,
  workerPlaneBytesMediaType,
  workerPlaneRoutes,
  type WorkerPlaneAnswer,
  type WorkerPlaneRoute,
  type WorkerPlaneRouteName,
} from "../../src/contract/workerPlane.ts";
import {
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/executionScheduler.ts";
import type { ReportIngested } from "../../src/interpreter/executionSchedulerReport.ts";
import { asForgeInstallationToken } from "../../src/interpreter/forgeInstallation.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  allArtifactFailures,
  allArtifactRoles,
  allManifestRejections,
  asResultManifestId,
  type ArtifactSite,
} from "../../src/interpreter/resultManifest.ts";
import {
  allRunEvidenceStored,
  type RunTurnsRecorded,
} from "../../src/interpreter/runEvidence.ts";
import type {
  WorkerArtifactReserved,
  WorkerArtifactStored,
  WorkerAttemptAuthority,
} from "../../src/interpreter/workerPlane.ts";
import type { WorkerPlaneCredentialMinted } from "../../src/interpreter/workerPlaneCredentials.ts";
import { fixtureForgeShapedToken } from "./forgeFixtures.ts";
import {
  inertRunEvidence,
  inertSessionPlane,
  inertWorkerPlane,
  runTotalsBody,
} from "./workerPlaneFixtures.ts";

/** Room for the largest body a route refuses by its own bound rather than the framework's. */
const workerPlaneContractUploadBytesMax = runConfigurationBytesMax * 2;

const liveAuthority: WorkerAttemptAuthority = {
  live: true,
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  execution: asExecutionId("execution"),
  attempt: asAttemptId("attempt"),
  generation: 1,
  taskKind: "Work",
  manifest: asResultManifestId("manifest"),
  inputBundle: "bundle",
  inputBundleDigest: "a".repeat(64),
  inputs: [
    { ordinal: 1, kind: "Repository", reference: "github.com/owner/name" },
    {
      ordinal: 2,
      kind: "TargetCommit",
      reference: "main",
      digest: "b".repeat(64),
    },
  ],
};

/** One call a route is driven with; `rest` fills the route's trailing `*`. */
interface WorkerPlaneCall {
  readonly rest?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly payload?: string | Buffer | object;
}

/** One way of driving a route: the ports it meets, and how its call differs from the route's own. */
interface WorkerPlaneCase {
  readonly name: string;
  readonly service?: Partial<WorkerPlaneServerService>;
  readonly call?: WorkerPlaneCall;
  readonly anonymous?: true;
}

const octets = { "content-type": workerPlaneBytesMediaType };
const json = { "content-type": "application/json" };

/** The call each route is driven with where a case changes nothing about it. */
const workerPlaneCalls: Readonly<
  Record<WorkerPlaneRouteName, WorkerPlaneCall>
> = {
  input: {},
  heartbeat: {},
  artifact: { rest: "out.txt", headers: octets, payload: Buffer.from("x") },
  report: {
    headers: { "content-type": "text/plain; charset=utf-8" },
    payload: "{}",
  },
  runConfiguration: { headers: octets, payload: Buffer.from("{}") },
  runTranscript: { rest: "1", headers: octets, payload: Buffer.from("{}\n") },
  runTurns: {
    headers: json,
    payload: {
      turns: [
        {
          ordinal: 1,
          model: "model",
          tokensInput: 1,
          tokensOutput: 1,
          tokensCacheCreation: 0,
          tokensCacheRead: 0,
        },
      ],
    },
  },
  runTotals: { headers: json, payload: runTotalsBody },
  runEnded: { headers: json, payload: { evidence: "RunFailed" } },
  credential: {},
};

function workerPlaneAuthority(
  authority: WorkerAttemptAuthority | undefined,
): Pick<WorkerPlaneServerService, "authority"> {
  return { authority: { authenticate: () => Promise.resolve(authority) } };
}

/** The callers every route refuses before its own ports are reached. */
const workerPlaneStrangers: readonly WorkerPlaneCase[] = [
  { name: "no bearer", anonymous: true },
  { name: "an unknown bearer", service: workerPlaneAuthority(undefined) },
  {
    name: "an attempt no longer live",
    service: workerPlaneAuthority({ ...liveAuthority, live: false }),
  },
];

/** A body a byte route cannot take, because the framework parsed it as JSON. */
const workerPlaneNotBytes: WorkerPlaneCase = {
  name: "a JSON body",
  call: { headers: json, payload: { bytes: 1 } },
};

/** A JSON body naming nothing the route reads. */
const workerPlaneMalformed: WorkerPlaneCase = {
  name: "a malformed body",
  call: { headers: json, payload: { unknown: true } },
};

const reservations: Readonly<
  Record<WorkerArtifactReserved["reserved"], WorkerArtifactReserved>
> = {
  Reserved: { reserved: "Reserved" },
  Conflict: { reserved: "Conflict" },
  Fenced: { reserved: "Fenced" },
  QuotaExceeded: { reserved: "QuotaExceeded" },
};

const storeRefusals: Readonly<
  Record<Extract<WorkerArtifactStored, { stored: "Refused" }>["reason"], true>
> = { InvalidPath: true, QuotaExceeded: true };

const stores: Readonly<
  Record<WorkerArtifactStored["stored"], readonly WorkerArtifactStored[]>
> = {
  Stored: [{ stored: "Stored" }],
  Refused: (Object.keys(storeRefusals) as (keyof typeof storeRefusals)[]).map(
    (reason) => ({ stored: "Refused", reason }) as const,
  ),
  Conflict: [{ stored: "Conflict" }],
  Unavailable: [{ stored: "Unavailable", retryAfterSeconds: 7 }],
};

const reportSites: readonly ArtifactSite[] = allArtifactRoles.map((role) => ({
  role,
  index: 0,
}));

const reports: Readonly<
  Record<ReportIngested["ingested"], readonly ReportIngested[]>
> = {
  Terminalized: [
    {
      ingested: "Terminalized",
      outcome: "Passed",
      operation: asOperationId("operation"),
    },
  ],
  Absorbed: [
    {
      ingested: "Absorbed",
      outcome: "Failed",
      operation: asOperationId("operation"),
    },
  ],
  Fenced: [{ ingested: "Fenced" }],
  Stale: [{ ingested: "Stale" }],
  NotAdmitted: [{ ingested: "NotAdmitted" }],
  Conflicting: [{ ingested: "Conflicting", incident: "incident" }],
  Malformed: allManifestRejections.flatMap((code) => [
    { ingested: "Malformed", code } as const,
    ...reportSites.map((at) => ({ ingested: "Malformed", code, at }) as const),
  ]),
  Unconfirmed: allArtifactFailures.flatMap((failure) =>
    reportSites.map(
      (at) => ({ ingested: "Unconfirmed", failure, at }) as const,
    ),
  ),
  Unavailable: [{ ingested: "Unavailable", retryAfterSeconds: 7 }],
};

const turnsRecorded: Readonly<
  Record<RunTurnsRecorded["recorded"], RunTurnsRecorded>
> = {
  Recorded: { recorded: "Recorded", turnsRecorded: 1 },
  Conflict: { recorded: "Conflict" },
  Fenced: { recorded: "Fenced" },
};

const credentialsMinted: Readonly<
  Record<WorkerPlaneCredentialMinted["minted"], WorkerPlaneCredentialMinted>
> = {
  Credential: {
    minted: "Credential",
    value: {
      username: "x-access-token",
      password: asForgeInstallationToken(fixtureForgeShapedToken),
      expiresAtMs: 1,
    },
  },
  NotFound: { minted: "NotFound" },
  Unavailable: { minted: "Unavailable" },
};

const bothAnswers = [true, false] as const;

/** Every answer the object store keeping a run's bytes can give, the row then stored. */
const runObjectCases: readonly WorkerPlaneCase[] = Object.values(stores)
  .flat()
  .map((stored) => ({
    name: `the store answering ${JSON.stringify(stored)}`,
    service: { artifacts: { store: () => Promise.resolve(stored) } },
  }));

/** Every answer one run-evidence row can be recorded with, through the port `pick` names. */
function runRecordCases(
  pick: "configurations" | "transcripts" | "totals",
): readonly WorkerPlaneCase[] {
  return allRunEvidenceStored.map((stored) => ({
    name: `the ${pick} row answering ${stored}`,
    service: {
      runEvidence: {
        ...inertRunEvidence,
        [pick]: { record: () => Promise.resolve(stored) },
      },
    },
  }));
}

const workerPlaneCases: Readonly<
  Record<WorkerPlaneRouteName, readonly WorkerPlaneCase[]>
> = {
  input: [...workerPlaneStrangers, { name: "a live attempt" }],
  heartbeat: [
    ...workerPlaneStrangers,
    ...bothAnswers.map((renewed) => ({
      name: `a heartbeat answering ${String(renewed)}`,
      service: { heartbeats: { heartbeat: () => Promise.resolve(renewed) } },
    })),
  ],
  artifact: [
    ...workerPlaneStrangers,
    workerPlaneNotBytes,
    { name: "a path no artifact may have", call: { rest: "%2E%2E%2Fescape" } },
    ...Object.values(reservations).map((reserved) => ({
      name: `a reservation answering ${reserved.reserved}`,
      service: { reservations: { reserve: () => Promise.resolve(reserved) } },
    })),
    ...runObjectCases,
  ],
  report: [
    ...workerPlaneStrangers,
    workerPlaneMalformed,
    ...Object.values(reports)
      .flat()
      .map((ingested) => ({
        name: `a report ingested as ${JSON.stringify(ingested)}`,
        service: { reports: { report: () => Promise.resolve(ingested) } },
      })),
  ],
  runConfiguration: [
    ...workerPlaneStrangers,
    workerPlaneNotBytes,
    {
      name: "a snapshot past its bound",
      call: { payload: Buffer.alloc(runConfigurationBytesMax + 1) },
    },
    ...runObjectCases,
    ...runRecordCases("configurations"),
  ],
  runTranscript: [
    ...workerPlaneStrangers,
    workerPlaneNotBytes,
    { name: "batch zero", call: { rest: "0" } },
    {
      name: "a batch past the run's last",
      call: { rest: String(runTranscriptBatchesMax + 1) },
    },
    {
      name: "a batch past its bound",
      call: { payload: Buffer.alloc(runTranscriptBatchBytesMax + 1) },
    },
    ...runObjectCases,
    ...runRecordCases("transcripts"),
  ],
  runTurns: [
    ...workerPlaneStrangers,
    workerPlaneMalformed,
    ...Object.values(turnsRecorded).map((recorded) => ({
      name: `the series answering ${recorded.recorded}`,
      service: {
        runEvidence: {
          ...inertRunEvidence,
          turns: { record: () => Promise.resolve(recorded) },
        },
      },
    })),
  ],
  runTotals: [
    ...workerPlaneStrangers,
    workerPlaneMalformed,
    ...runRecordCases("totals"),
  ],
  runEnded: [
    ...workerPlaneStrangers,
    workerPlaneMalformed,
    ...bothAnswers.map((ended) => ({
      name: `an ending answering ${String(ended)}`,
      service: {
        runEvidence: {
          ...inertRunEvidence,
          endings: { end: () => Promise.resolve(ended) },
        },
      },
    })),
  ],
  credential: [
    ...workerPlaneStrangers,
    { name: "a plane that mints nothing" },
    ...Object.values(credentialsMinted).map((minted) => ({
      name: `a mint answering ${minted.minted}`,
      service: {
        credentials: {
          attempt: () => Promise.resolve(minted),
          session: () => Promise.resolve(minted),
        },
      },
    })),
  ],
};

/** One case driven through a plane of its own, answered as the pod would read it. */
async function workerPlaneDriven(
  name: WorkerPlaneRouteName,
  driven: WorkerPlaneCase,
): Promise<{ status: number; body: string; retryAfter: unknown }> {
  const app = createWorkerPlaneApp({
    ...inertWorkerPlane(workerPlaneContractUploadBytesMax),
    ...workerPlaneAuthority(liveAuthority),
    ...driven.service,
  });
  const route = workerPlaneRoutes[name];
  const call = { ...workerPlaneCalls[name], ...driven.call };
  const response = await app.inject({
    method: route.method,
    url: route.path.replace("*", call.rest ?? ""),
    headers: {
      ...(driven.anonymous === true ? {} : { authorization: "Bearer held" }),
      ...call.headers,
    },
    ...(call.payload === undefined ? {} : { payload: call.payload }),
  });
  await app.close();
  return {
    status: response.statusCode,
    body: response.body,
    retryAfter: response.headers["retry-after"],
  };
}

/** Whether a body is what the map says its status answers with, and names nothing more. */
function workerPlaneAnswerRead(answer: WorkerPlaneAnswer, body: string): void {
  if (answer === "empty") {
    assert.equal(body, "");
    return;
  }
  const offered: unknown = JSON.parse(body);
  assert.deepEqual(answer.parse(offered), offered);
}

for (const name of Object.keys(workerPlaneRoutes) as WorkerPlaneRouteName[]) {
  test(`${name} answers every outcome with a status and a body the contract names`, async () => {
    const answers: Readonly<Record<number, WorkerPlaneAnswer>> =
      workerPlaneAnswers[name];
    const statuses = new Set<number>();
    for (const driven of workerPlaneCases[name]) {
      const answered = await workerPlaneDriven(name, driven);
      const answer = answers[answered.status];
      assert.ok(
        answer !== undefined,
        `${driven.name} answered ${String(answered.status)}, which the map does not list`,
      );
      assert.doesNotThrow(() => {
        workerPlaneAnswerRead(answer, answered.body);
      }, `${driven.name} answered ${answered.body}`);
      if (answered.status === 503)
        assert.match(String(answered.retryAfter), /^[1-9][0-9]*$/u);
      statuses.add(answered.status);
    }
    assert.deepEqual(
      [...statuses].sort((left, right) => left - right),
      Object.keys(answers)
        .map(Number)
        .sort((left, right) => left - right),
      "every status the map lists is one some outcome answers",
    );
  });
}

/**
 * Every method and path an app serves, read off its own router rather than the
 * source that registers them. A line this cannot read fails the suite, so a
 * change to the router's print is never a route silently dropped.
 */
function workerPlaneRegistered(app: FastifyInstance): readonly string[] {
  const served: string[] = [];
  const segments: string[] = [];
  for (const line of app.printRoutes().split("\n")) {
    if (line.trim() === "") continue;
    const node = /^((?:│ {3}| {4})*)[├└]── (\S+)(?: \(([A-Z, ]+)\))?$/u.exec(
      line,
    );
    assert.ok(node !== null, `a router line this suite cannot read: ${line}`);
    segments.length = (node[1] ?? "").length / 4;
    segments.push(node[2] ?? "");
    for (const method of node[3]?.split(", ") ?? [])
      served.push(`${method} ${segments.join("")}`);
  }
  return served.sort();
}

/** The methods and paths `routes` name, each GET with the HEAD the framework serves beside it. */
function workerPlaneRoster(
  routes: readonly WorkerPlaneRoute[],
): readonly string[] {
  return routes
    .flatMap(({ method, path }) =>
      method === "GET"
        ? [`GET ${path}`, `HEAD ${path}`]
        : [`${method} ${path}`],
    )
    .sort();
}

test("the plane serves the contract's routes and its probes, and nothing else", async () => {
  const attempts = inertWorkerPlane(workerPlaneContractUploadBytesMax);
  const jobs = [
    ...Object.values(workerPlaneRoutes),
    ...Object.values(workerPlaneHealthRoutes),
  ];
  for (const [service, routes] of [
    [attempts, jobs],
    [
      {
        ...attempts,
        sessions: inertSessionPlane({
          authenticate: () => Promise.resolve(undefined),
        }),
      },
      [...jobs, ...Object.values(sessionPlaneRoutes)],
    ],
  ] as const) {
    const app = createWorkerPlaneApp(service);
    await app.ready();
    assert.deepEqual(workerPlaneRegistered(app), workerPlaneRoster(routes));
    await app.close();
  }
});
