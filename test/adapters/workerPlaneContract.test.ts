/**
 * The job plane and the session plane held to their contract from the
 * provider's side: the app serves exactly the routes the contract names, and
 * every answer a handler gives parses under the answer map's schema for its
 * route and status.
 *
 * EVERY OUTCOME A FAKE PORT CAN ANSWER IS DRIVEN. A port's outcomes are listed
 * from the interpreter's own roster where one exists, and otherwise in a record
 * keyed by the union's discriminant, which fails to compile when the union
 * gains a member; each is then answered with a status the map must list.
 *
 * AN ANSWER NAMES NOTHING ITS SCHEMA DOES NOT. The schemas drop a field they do
 * not name, for an older pod's sake, so each answer must also equal its own
 * parse: a field the server renamed is a failure here rather than a drop.
 *
 * EVERY OPTIONAL FIELD IS SEEN BOTH WAYS. A field its schema lets be absent is
 * one a server could stop sending with every parse still passing, so each
 * optional field a status's schema names must be present in some case of that
 * route and absent in another.
 *
 * AN OLDER RELEASE A PLANE STILL SERVES IS DRIVEN THE SAME WAY. Every case is
 * driven again naming that release, and read by that release's own answer map,
 * which is how a pod built with it reads the answer. Every body that release's
 * request schemas build, each roster value in turn, is offered at its route and
 * must not be refused. The releases are `workerContractReleases.ts`'s.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createWorkerPlaneApp,
  workerPlaneHealthRoutes,
  type SessionPlaneService,
  type WorkerPlaneServerService,
} from "../../src/adapters/http/workerPlaneServer.ts";
import {
  nativeHttpPageItemsMax,
  runConfigurationBytesMax,
  runTranscriptBatchBytesMax,
  runTranscriptBatchesMax,
  sessionStoreBatchBytesMax,
} from "../../src/contract/http.ts";
import {
  sessionPlaneAnswers,
  sessionPlaneRoutes,
  type SessionPlaneRouteName,
} from "../../src/contract/sessionPlane.ts";
import {
  contractVersionRefusalSchema,
  contractVersionRefusalStatus,
  workerContractHeader,
  workerContractRelease,
} from "../../src/contract/workerContract.ts";
import {
  workerPlaneAnswers,
  workerPlaneBytesMediaType,
  workerPlaneRoutes,
  type WorkerPlaneAnswer,
  type WorkerPlaneRoute,
  type WorkerPlaneRouteName,
} from "../../src/contract/workerPlane.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import {
  allSessionCapabilities,
  allSessionKinds,
  allSessionTurnInputKinds,
  asSessionAttemptId,
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import {
  asAttemptId,
  asExecutionId,
  type WorkTaskInvocation,
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
  SessionPlaneIdentity,
  SessionReferenceBound,
  SessionStoreStreamRow,
  SessionTurnAnswered,
  SessionTurnFailed,
} from "../../src/interpreter/sessionPlane.ts";
import type {
  SessionStoreRead,
  SessionStoreRecorded,
  SessionStoreStored,
} from "../../src/interpreter/sessionStore.ts";
import { filesystemAccessOrder } from "../../src/interpreter/taskAuthority.ts";
import type {
  WorkerConfiguration,
  WorkerMode,
} from "../../src/interpreter/taskConfiguration.ts";
import {
  workerContractAccepted,
  type SessionTaskRead,
  type WorkerArtifactReserved,
  type WorkerArtifactStored,
  type WorkerAttemptAuthority,
  type WorkerTaskRead,
} from "../../src/interpreter/workerPlane.ts";
import type { WorkerPlaneCredentialMinted } from "../../src/interpreter/workerPlaneCredentials.ts";
import {
  workerContractReleasePlane,
  workerContractReplayed,
  type WorkerContractReleasePlane,
} from "../contract/workerContractReleases.ts";
import { fixtureForgeShapedToken } from "./forgeFixtures.ts";
import {
  inertRunEvidence,
  inertSessionPlane,
  inertTasks,
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

const liveInvocation: WorkTaskInvocation = {
  profile: { profile: "default", runtimeVersion: "1" },
  briefing: { templateVersion: 1, purpose: "Work", text: "Do the work." },
  authority: {
    tools: [],
    credentials: [],
    network: false,
    filesystem: "WriteWorkspace",
    mayCompleteTask: true,
  },
};

/** A work task's recorded identity and invocation, carrying neither a stage nor a worker configuration. */
const liveTask: WorkerTaskRead = {
  live: true,
  identity: {
    partition: liveAuthority.partition,
    execution: liveAuthority.execution,
    attempt: liveAuthority.attempt,
    generation: liveAuthority.generation,
    ticket: asTicketId(1),
    task: asTaskId(1),
    taskKind: "Work",
    sourceRequest: "1:0:ExecuteTask",
    inputBundle: liveAuthority.inputBundle,
    inputBundleDigest: liveAuthority.inputBundleDigest,
    configurationRevision: "revision",
    configurationDigest: "c".repeat(64),
    requirementIdentity: "requirement",
    requirementDigest: "d".repeat(64),
  },
  invocation: liveInvocation,
};

/** One call a route is driven with; `rest` fills the route's trailing `*` and `query` follows the path. */
interface WorkerPlaneCall {
  readonly rest?: string;
  readonly query?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly payload?: string | Buffer | object;
}

/** One way of driving a route: the ports it meets, and how its call, its bearer and the release it names differ from the plane's own. */
interface WorkerPlaneCase {
  readonly name: string;
  readonly service?: Partial<WorkerPlaneServerService>;
  readonly call?: WorkerPlaneCall;
  readonly anonymous?: true;
  readonly bearer?: string;
  readonly release?: string;
}

const served = workerContractAccepted.max;

/** A caller every route refuses before it reads a bearer. */
const workerContractStranger: WorkerPlaneCase = {
  name: "a release the plane does not serve",
  release: `${String(served.major)}.${String(served.minor + 1)}.0`,
};

const octets = { "content-type": workerPlaneBytesMediaType };
const json = { "content-type": "application/json" };

/** The call each route is driven with where a case changes nothing about it. */
const workerPlaneCalls: Readonly<
  Record<WorkerPlaneRouteName, WorkerPlaneCall>
> = {
  input: {},
  task: {},
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

/**
 * What a harness sends a route as JSON: the name its release exports the
 * body's schema under, and bodies beside the route's call that between them
 * offer each optional field and leave it out. A route whose body no schema
 * reads, being bytes, the manifest's text or nothing, is `Unparsed`.
 */
type WorkerPlaneRequest =
  "Unparsed" | { readonly schema: string; readonly bodies: readonly object[] };

const workerPlaneRequests: Readonly<
  Record<WorkerPlaneRouteName, WorkerPlaneRequest>
> = {
  input: "Unparsed",
  task: "Unparsed",
  heartbeat: "Unparsed",
  artifact: "Unparsed",
  report: "Unparsed",
  runConfiguration: "Unparsed",
  runTranscript: "Unparsed",
  runTurns: { schema: "workerRunTurnsSchema", bodies: [] },
  runTotals: {
    schema: "workerRunTotalsSchema",
    bodies: [
      {
        ...runTotalsBody,
        models: [
          {
            model: "model",
            tokensInput: 1,
            tokensOutput: 2,
            tokensCacheCreation: 3,
            tokensCacheRead: 4,
            costUsdMicros: 7,
          },
        ],
        resultSubtype: "success",
        stopReason: "end_turn",
      },
    ],
  },
  runEnded: { schema: "workerRunEndedSchema", bodies: [] },
  credential: "Unparsed",
};

function workerPlaneAuthority(
  authority: WorkerAttemptAuthority | undefined,
): Pick<WorkerPlaneServerService, "authority"> {
  return { authority: { authenticate: () => Promise.resolve(authority) } };
}

function workerPlaneTask(
  found: WorkerTaskRead | undefined,
): Pick<WorkerPlaneServerService, "tasks"> {
  return { tasks: { ...inertTasks, work: () => Promise.resolve(found) } };
}

/** A member of the worker mode union by name: its agent where it runs one, and otherwise its type. */
type WorkerModeMember<Mode extends WorkerMode = WorkerMode> = Mode extends {
  readonly agent: infer Agent extends string;
}
  ? Agent
  : Mode["type"];

/** One mode of each member, which fails to compile when the union gains one. */
const workerModes: {
  readonly [Member in WorkerModeMember]: Extract<
    WorkerMode,
    { readonly agent: Member } | { readonly type: Member }
  >;
} = {
  Claude: { type: "SingleAgent", agent: "Claude", arguments: [] },
  Codex: { type: "SingleAgent", agent: "Codex", arguments: [], model: "model" },
  Commands: { type: "Commands", commands: ["just check"] },
};

/** Every worker configuration a task carries: each mode, and the bare arguments that predate modes. */
const workerConfigurations: readonly WorkerConfiguration[] = [
  ...Object.values(workerModes).map((mode) => ({ mode, setup: [], files: [] })),
  { arguments: ["--verbose"], setup: [], files: [] },
];

/** A work task granting each filesystem reach, and one carrying each worker configuration. */
const workTaskRosterCases: readonly WorkerPlaneCase[] = [
  ...filesystemAccessOrder.map((filesystem) => ({
    name: `a work task granting ${filesystem}`,
    service: workerPlaneTask({
      ...liveTask,
      invocation: {
        ...liveInvocation,
        authority: { ...liveInvocation.authority, filesystem },
      },
    }),
  })),
  ...workerConfigurations.map((worker) => ({
    name: `a work task carrying ${JSON.stringify(worker)}`,
    service: workerPlaneTask({
      ...liveTask,
      invocation: { ...liveInvocation, worker },
    }),
  })),
];

/** The callers every route refuses before its own ports are reached. */
const workerPlaneStrangers: readonly WorkerPlaneCase[] = [
  workerContractStranger,
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

/** The members of a union a record keyed by it names, which the compiler holds to the union. */
function keysOf<Key extends string>(
  record: Readonly<Record<Key, true>>,
): readonly Key[] {
  return Object.keys(record) as Key[];
}

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
  Refused: keysOf(storeRefusals).map(
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

/** Every answer the minting can give, through whichever of its two doors the route calls. */
const credentialCases: readonly WorkerPlaneCase[] = [
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
];

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

const liveSession: SessionPlaneIdentity = {
  live: true,
  partition: liveAuthority.partition,
  session: asSessionId("session"),
  attempt: asSessionAttemptId("attempt"),
  generation: 1,
  kind: "Lead",
  capabilities: ["RepositoryRead", "RunCommands"],
  credentialSlot: "claude-code",
};

/** The session ports a live session meets, `over` replacing the ones a case is about. */
function sessionPorts(
  over: Partial<SessionPlaneService>,
): Pick<WorkerPlaneServerService, "sessions"> {
  return {
    sessions: {
      ...inertSessionPlane({
        authenticate: () => Promise.resolve(liveSession),
      }),
      ...over,
    },
  };
}

function sessionAuthority(
  identity: SessionPlaneIdentity | undefined,
): Pick<WorkerPlaneServerService, "sessions"> {
  return sessionPorts({
    authority: { authenticate: () => Promise.resolve(identity) },
  });
}

/** A session attempt's recorded identity and invocation, fresh and bound to no repository. */
const liveSessionTask: SessionTaskRead = {
  live: true,
  identity: {
    partition: liveSession.partition,
    session: liveSession.session,
    attempt: liveSession.attempt,
    generation: liveSession.generation,
    kind: liveSession.kind,
    credentialSlot: liveSession.credentialSlot,
  },
  invocation: {
    capabilities: liveSession.capabilities,
    authority: liveInvocation.authority,
  },
};

/** The ports a live session meets on `/v1/task`, its task read answering `found`. */
function sessionTaskPorts(
  found: SessionTaskRead | undefined,
): Pick<WorkerPlaneServerService, "sessions" | "tasks"> {
  return {
    ...sessionPorts({}),
    tasks: { ...inertTasks, session: () => Promise.resolve(found) },
  };
}

/** Every way a session bearer is answered on `/v1/task`, each case carrying that bearer. */
function sessionTaskCases(): readonly WorkerPlaneCase[] {
  const bearer = `chgs_${"a".repeat(32)}`;
  return [
    { name: "a session bearer where no session plane is composed" },
    {
      name: "an unknown session bearer",
      service: {
        ...sessionTaskPorts(liveSessionTask),
        ...sessionAuthority(undefined),
      },
    },
    {
      name: "a session no longer live",
      service: {
        ...sessionTaskPorts(liveSessionTask),
        ...sessionAuthority({ ...liveSession, live: false }),
      },
    },
    {
      name: "a session attempt its task read finds no longer live",
      service: sessionTaskPorts({ ...liveSessionTask, live: false }),
    },
    {
      name: "a session attempt opened before invocations were recorded",
      service: sessionTaskPorts({
        live: true,
        identity: liveSessionTask.identity,
      }),
    },
    {
      name: "a fresh session's task",
      service: sessionTaskPorts(liveSessionTask),
    },
    {
      name: "a resumed session's task, bound to a repository",
      service: sessionTaskPorts({
        ...liveSessionTask,
        invocation: {
          ...liveSessionTask.invocation,
          capabilities: ["RepositoryRead"],
          agentReference: "runtime-session",
          authority: liveInvocation.authority,
          repository: { reference: "github.com/owner/name" },
        },
      }),
    },
    ...allSessionKinds.map((kind) => ({
      name: `a ${kind} session's task holding every capability`,
      service: sessionTaskPorts({
        ...liveSessionTask,
        identity: { ...liveSessionTask.identity, kind },
        invocation: {
          capabilities: allSessionCapabilities,
          authority: liveInvocation.authority,
        },
      }),
    })),
    ...filesystemAccessOrder.map((filesystem) => ({
      name: `a session's task granting ${filesystem}`,
      service: sessionTaskPorts({
        ...liveSessionTask,
        invocation: {
          capabilities: liveSession.capabilities,
          authority: { ...liveInvocation.authority, filesystem },
        },
      }),
    })),
  ].map((driven) => ({ ...driven, bearer }));
}

const workerPlaneCases: Readonly<
  Record<WorkerPlaneRouteName, readonly WorkerPlaneCase[]>
> = {
  input: [...workerPlaneStrangers, { name: "a live attempt" }],
  task: [
    workerContractStranger,
    { name: "no bearer", anonymous: true },
    { name: "an unknown bearer", service: workerPlaneTask(undefined) },
    {
      name: "an attempt no longer live",
      service: workerPlaneTask({ ...liveTask, live: false }),
    },
    {
      name: "an attempt not yet invoked",
      service: workerPlaneTask({ live: true, identity: liveTask.identity }),
    },
    { name: "a work task", service: workerPlaneTask(liveTask) },
    ...workTaskRosterCases,
    {
      name: "an evaluation stage's commands",
      service: workerPlaneTask({
        ...liveTask,
        identity: { ...liveTask.identity, taskKind: "Evaluation", stage: 0 },
        invocation: {
          ...liveInvocation,
          worker: {
            mode: { type: "Commands", commands: ["just check"] },
            setup: [],
            files: [],
          },
        },
      }),
    },
    ...sessionTaskCases(),
  ],
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
  credential: [...workerPlaneStrangers, ...credentialCases],
};

/** The call each session route is driven with where a case changes nothing about it. */
const sessionPlaneCalls: Readonly<
  Record<SessionPlaneRouteName, WorkerPlaneCall>
> = {
  facts: {},
  heartbeat: {},
  reference: { headers: json, payload: { reference: "reference" } },
  turn: {},
  turnAnswer: { headers: json, payload: { turn: "turn", result: "result" } },
  turnFailure: {
    headers: json,
    payload: { turn: "turn", failure: "AgentFailed" },
  },
  held: { headers: json, payload: {} },
  storeStreams: {},
  storeBatch: {
    rest: "stream/1",
    headers: octets,
    payload: Buffer.from("{}\n"),
  },
  storePage: { rest: "stream" },
  credential: {
    headers: json,
    payload: { repository: "github.com/owner/name" },
  },
};

const sessionPlaneRequests: Readonly<
  Record<SessionPlaneRouteName, WorkerPlaneRequest>
> = {
  facts: "Unparsed",
  heartbeat: "Unparsed",
  reference: { schema: "sessionReferenceSchema", bodies: [] },
  turn: "Unparsed",
  turnAnswer: {
    schema: "sessionTurnAnswerSchema",
    bodies: [
      {
        turn: "turn",
        result: "result",
        measured: {
          model: "model",
          tokens: 1,
          costMicros: 1,
          durationMs: 1,
          tools: ["Read"],
        },
        batchFirst: 1,
        batchLast: 2,
      },
    ],
  },
  turnFailure: { schema: "sessionTurnFailureSchema", bodies: [] },
  held: "Unparsed",
  storeStreams: "Unparsed",
  storeBatch: "Unparsed",
  storePage: "Unparsed",
  credential: { schema: "sessionCredentialSchema", bodies: [] },
};

/** The callers every session route refuses before its own ports are reached. */
const sessionPlaneStrangers: readonly WorkerPlaneCase[] = [
  workerContractStranger,
  { name: "no bearer", anonymous: true },
  { name: "an unknown session bearer", service: sessionAuthority(undefined) },
  {
    name: "a session no longer live",
    service: sessionAuthority({ ...liveSession, live: false }),
  },
];

const referencesBound: Readonly<Record<SessionReferenceBound, true>> = {
  Bound: true,
  AlreadyBound: true,
  Conflict: true,
  Fenced: true,
};

const turnsAnswered: Readonly<Record<SessionTurnAnswered, true>> = {
  Answered: true,
  AlreadyAnswered: true,
  Conflict: true,
  Fenced: true,
};

const turnsFailed: Readonly<Record<SessionTurnFailed, true>> = {
  Failed: true,
  AlreadyFailed: true,
  Conflict: true,
  Fenced: true,
};

const batchRefusals: Readonly<
  Record<Extract<SessionStoreStored, { stored: "Refused" }>["reason"], true>
> = { QuotaExceeded: true };

const batchesKept: Readonly<
  Record<SessionStoreStored["stored"], readonly SessionStoreStored[]>
> = {
  Stored: [{ stored: "Stored" }],
  Refused: keysOf(batchRefusals).map(
    (reason) => ({ stored: "Refused", reason }) as const,
  ),
  Conflict: [{ stored: "Conflict" }],
  Unavailable: [{ stored: "Unavailable", retryAfterSeconds: 7 }],
};

const batchesRecorded: Readonly<Record<SessionStoreRecorded, true>> = {
  Stored: true,
  AlreadyStored: true,
  OutOfOrder: true,
  Conflict: true,
  QuotaExceeded: true,
  Fenced: true,
};

const batchesRead: Readonly<
  Record<SessionStoreRead["read"], SessionStoreRead>
> = {
  Content: { read: "Content", content: "{}\n" },
  NotFound: { read: "NotFound" },
  Unavailable: { read: "Unavailable", retryAfterSeconds: 7 },
  Corrupt: { read: "Corrupt" },
};

/** A store holding one batch of the caller's own stream, which the page reads as `read` answers. */
function sessionPageCase(
  read: SessionStoreRead,
): Partial<WorkerPlaneServerService> {
  return sessionPorts({
    queries: {
      batches: () =>
        Promise.resolve([
          { session: liveSession.session, batch: 1, digest: "d", bytes: 3 },
        ]),
      streams: () => Promise.resolve([]),
    },
    store: {
      storeBatch: () => Promise.resolve({ stored: "Stored" }),
      readBatch: () => Promise.resolve(read),
    },
  });
}

function sessionStreamRows(count: number): readonly SessionStoreStreamRow[] {
  return Array.from({ length: count }, (_unused, index) => ({
    stream: asSessionStoreStream(`stream/${String(index)}`),
    batches: 1,
  }));
}

const sessionPlaneCases: Readonly<
  Record<SessionPlaneRouteName, readonly WorkerPlaneCase[]>
> = {
  facts: [
    ...sessionPlaneStrangers,
    { name: "a session none of whose optional facts exist yet" },
    {
      name: "a session bound, told what it is, and forking",
      service: sessionAuthority({
        ...liveSession,
        kind: "Inquiry",
        agentReference: "reference",
        systemPrompt: "prompt",
        forkFrom: "parent",
      }),
    },
    ...allSessionKinds.map((kind) => ({
      name: `a ${kind} session holding every capability`,
      service: sessionAuthority({
        ...liveSession,
        kind,
        capabilities: allSessionCapabilities,
      }),
    })),
  ],
  heartbeat: [
    ...sessionPlaneStrangers,
    ...bothAnswers.map((renewed) => ({
      name: `a heartbeat answering ${String(renewed)}`,
      service: sessionPorts({
        heartbeats: { heartbeat: () => Promise.resolve(renewed) },
      }),
    })),
  ],
  reference: [
    ...sessionPlaneStrangers,
    workerPlaneMalformed,
    ...keysOf(referencesBound).map((bound) => ({
      name: `a binding answering ${bound}`,
      service: sessionPorts({
        references: { bind: () => Promise.resolve(bound) },
      }),
    })),
  ],
  turn: [
    ...sessionPlaneStrangers,
    { name: "a mailbox with nothing in it" },
    ...allSessionTurnInputKinds.map((inputKind) => ({
      name: `a mailbox handing over a ${inputKind} turn`,
      service: sessionPorts({
        turns: {
          claim: () =>
            Promise.resolve({
              turn: asSessionTurnId("turn"),
              ordinal: 1,
              inputKind,
              input: "input",
            }),
        },
      }),
    })),
  ],
  turnAnswer: [
    ...sessionPlaneStrangers,
    workerPlaneMalformed,
    ...keysOf(turnsAnswered).map((answered) => ({
      name: `an answer settling as ${answered}`,
      service: sessionPorts({
        settlements: {
          answer: () => Promise.resolve(answered),
          fail: () => Promise.resolve("Failed"),
        },
      }),
    })),
  ],
  turnFailure: [
    ...sessionPlaneStrangers,
    workerPlaneMalformed,
    ...keysOf(turnsFailed).map((failed) => ({
      name: `a failure settling as ${failed}`,
      service: sessionPorts({
        settlements: {
          answer: () => Promise.resolve("Answered"),
          fail: () => Promise.resolve(failed),
        },
      }),
    })),
  ],
  held: [
    ...sessionPlaneStrangers,
    ...bothAnswers.map((held) => ({
      name: `a hold answering ${String(held)}`,
      service: sessionPorts({ holds: { hold: () => Promise.resolve(held) } }),
    })),
  ],
  storeStreams: [
    ...sessionPlaneStrangers,
    { name: "a prefix asked twice", call: { query: "stream=a&stream=b" } },
    ...[0, 1, nativeHttpPageItemsMax + 1].map((count) => ({
      name: `a store holding ${String(count)} streams`,
      service: sessionPorts({
        queries: {
          batches: () => Promise.resolve([]),
          streams: () => Promise.resolve(sessionStreamRows(count)),
        },
      }),
    })),
  ],
  storeBatch: [
    ...sessionPlaneStrangers,
    workerPlaneNotBytes,
    { name: "a path naming no batch", call: { rest: "stream" } },
    { name: "a stream name no row can hold", call: { rest: "%20/1" } },
    { name: "batch zero", call: { rest: "stream/0" } },
    {
      name: "a batch past its bound",
      call: { payload: Buffer.alloc(sessionStoreBatchBytesMax + 1) },
    },
    ...Object.values(batchesKept)
      .flat()
      .map((kept) => ({
        name: `the store answering ${JSON.stringify(kept)}`,
        service: sessionPorts({
          store: {
            storeBatch: () => Promise.resolve(kept),
            readBatch: () => Promise.resolve({ read: "NotFound" }),
          },
        }),
      })),
    ...keysOf(batchesRecorded).map((recorded) => ({
      name: `the batch row answering ${recorded}`,
      service: sessionPorts({
        records: { record: () => Promise.resolve(recorded) },
      }),
    })),
  ],
  storePage: [
    ...sessionPlaneStrangers,
    { name: "a path naming a batch", call: { rest: "stream/1" } },
    { name: "a stream name no row can hold", call: { rest: "%20" } },
    { name: "a limit of zero", call: { query: "limit=0" } },
    { name: "a stream with no batches" },
    ...Object.values(batchesRead).map((read) => ({
      name: `a batch whose object reads ${read.read}`,
      service: sessionPageCase(read),
    })),
    {
      name: "a page as full as its limit",
      call: { query: "limit=1" },
      service: sessionPageCase(batchesRead.Content),
    },
  ],
  credential: [
    ...sessionPlaneStrangers,
    workerPlaneMalformed,
    ...credentialCases,
  ],
};

/** One plane as this suite drives it: its routes, their calls and requests, its answer map and cases, and the bearer it reads. */
interface WorkerPlaneDriven<Name extends string> {
  readonly routes: Readonly<Record<Name, WorkerPlaneRoute>>;
  readonly calls: Readonly<Record<Name, WorkerPlaneCall>>;
  readonly requests: Readonly<Record<Name, WorkerPlaneRequest>>;
  readonly answers: Readonly<
    Record<Name, Readonly<Record<number, WorkerPlaneAnswer>>>
  >;
  readonly cases: Readonly<Record<Name, readonly WorkerPlaneCase[]>>;
  readonly bearer: string;
  readonly service: WorkerPlaneServerService;
}

/** What one driven case was answered with. */
interface WorkerPlaneAnswered {
  readonly status: number;
  readonly body: string;
  readonly retryAfter: unknown;
  readonly release: unknown;
}

/** One case driven through a plane of its own at `route`, the plane's own unless a release names it elsewhere. */
async function workerPlaneDriven<Name extends string>(
  plane: WorkerPlaneDriven<Name>,
  name: Name,
  driven: WorkerPlaneCase,
  route: WorkerPlaneRoute = plane.routes[name],
): Promise<WorkerPlaneAnswered> {
  const app = createWorkerPlaneApp({ ...plane.service, ...driven.service });
  const call = { ...plane.calls[name], ...driven.call };
  const path = route.path.replace("*", call.rest ?? "");
  const response = await app.inject({
    method: route.method,
    url: call.query === undefined ? path : `${path}?${call.query}`,
    headers: {
      ...(driven.anonymous === true
        ? {}
        : { authorization: `Bearer ${driven.bearer ?? plane.bearer}` }),
      ...(driven.release === undefined
        ? {}
        : { [workerContractHeader]: driven.release }),
      ...call.headers,
    },
    ...(call.payload === undefined ? {} : { payload: call.payload }),
  });
  await app.close();
  return {
    status: response.statusCode,
    body: response.body,
    retryAfter: response.headers["retry-after"],
    release: response.headers[workerContractHeader],
  };
}

/**
 * Marks every optional field `schema` names along `value` as present or absent
 * under its path. A union is followed down the member that reads the value,
 * which is the member its parse answered with.
 */
function workerPlaneOptionalsSeen(
  schema: z.ZodType,
  value: unknown,
  path: string,
  seen: Map<string, Set<boolean>>,
): void {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Readonly<Record<string, z.ZodType>>;
    for (const [key, field] of Object.entries(shape)) {
      const held = (value as Readonly<Record<string, unknown>>)[key];
      const at = `${path}.${key}`;
      const optional =
        field instanceof z.ZodOptional || field instanceof z.ZodExactOptional;
      if (optional)
        seen.set(at, (seen.get(at) ?? new Set()).add(held !== undefined));
      if (held !== undefined)
        workerPlaneOptionalsSeen(
          optional ? (field.unwrap() as z.ZodType) : field,
          held,
          at,
          seen,
        );
    }
  } else if (schema instanceof z.ZodArray) {
    for (const item of value as readonly unknown[])
      workerPlaneOptionalsSeen(
        schema.element as z.ZodType,
        item,
        `${path}[]`,
        seen,
      );
  } else if (schema instanceof z.ZodUnion) {
    const members = schema.options as readonly z.ZodType[];
    const index = members.findIndex(
      (member) => member.safeParse(value).success,
    );
    const member = members[index];
    if (member !== undefined)
      workerPlaneOptionalsSeen(member, value, `${path}|${String(index)}`, seen);
  }
}

/** Which of the bodies a status may carry `body` is, read as the pod's parse reads it: the first that accepts it. */
function workerPlaneMemberRead(answer: z.ZodUnion, body: string): number {
  const offered: unknown = JSON.parse(body);
  return answer.options.findIndex(
    (member) => (member as z.ZodType).safeParse(offered).success,
  );
}

/** Whether a body is what the map says its status answers with, and names nothing more. */
function workerPlaneAnswerRead(
  answer: WorkerPlaneAnswer,
  body: string,
  status: number,
  seen: Map<string, Set<boolean>>,
): void {
  if (answer === "empty") {
    assert.equal(body, "");
    return;
  }
  const offered: unknown = JSON.parse(body);
  assert.deepEqual(answer.parse(offered), offered);
  workerPlaneOptionalsSeen(answer, offered, String(status), seen);
}

function workerPlaneAnswersHeld<Name extends string>(
  plane: WorkerPlaneDriven<Name>,
): void {
  for (const name of Object.keys(plane.routes) as Name[]) {
    const route = plane.routes[name];
    test(`${route.method} ${route.path} answers every outcome with a status and a body the contract names`, async () => {
      const answers = plane.answers[name];
      const statuses = new Set<number>();
      const bodies = new Set<string>();
      const seen = new Map<string, Set<boolean>>();
      for (const driven of plane.cases[name]) {
        const answered = await workerPlaneDriven(plane, name, driven);
        const answer = answers[answered.status];
        assert.ok(
          answer !== undefined,
          `${driven.name} answered ${String(answered.status)}, which the map does not list`,
        );
        assert.doesNotThrow(() => {
          workerPlaneAnswerRead(answer, answered.body, answered.status, seen);
        }, `${driven.name} answered ${answered.body}`);
        if (answer instanceof z.ZodUnion)
          bodies.add(
            `${String(answered.status)}|${String(workerPlaneMemberRead(answer, answered.body))}`,
          );
        if (answered.status === 503)
          assert.match(String(answered.retryAfter), /^[1-9][0-9]*$/u);
        assert.equal(
          answered.release,
          workerContractRelease,
          `${driven.name} answered naming no release of its own`,
        );
        statuses.add(answered.status);
      }
      assert.deepEqual(
        [...statuses].sort((left, right) => left - right),
        Object.keys(answers)
          .map(Number)
          .sort((left, right) => left - right),
        "every status the map lists is one some outcome answers",
      );
      for (const [status, answer] of Object.entries(answers))
        if (answer instanceof z.ZodUnion)
          for (const index of answer.options.keys())
            assert.ok(
              bodies.has(`${status}|${String(index)}`),
              `no outcome answers ${status} with its body ${String(index)}`,
            );
      for (const [field, held] of seen)
        assert.equal(
          held.size,
          2,
          `${field} is ${held.has(true) ? "present" : "absent"} in every case that answers it`,
        );
    });
  }
}

/** Whether an answer is the refusal of the release a request named. */
function workerPlaneVersionRefused(answered: WorkerPlaneAnswered): boolean {
  return (
    answered.status === contractVersionRefusalStatus &&
    answered.body !== "" &&
    contractVersionRefusalSchema.safeParse(JSON.parse(answered.body)).success
  );
}

/** Asserts `older`'s pod reads the answer: a status its map lists for the route, with a body that status's schema parses. */
function workerPlaneReadBy(
  older: WorkerContractReleasePlane,
  name: string,
  what: string,
  answered: WorkerPlaneAnswered,
): void {
  const answer = older.answers[name]?.[answered.status];
  assert.ok(
    answer !== undefined,
    `${what} answered ${String(answered.status)}, which ${older.release} does not list`,
  );
  if (answer === "empty") assert.equal(answered.body, "", what);
  else
    assert.doesNotThrow(() => {
      answer.parse(JSON.parse(answered.body));
    }, `${what} answered ${answered.body}, which ${older.release} cannot read`);
}

/**
 * `body` first, then again for each other value of each enum `schema` reads in
 * it, the rest held, so a roster is offered whole wherever the body offers one
 * member. A union is followed down the member that reads the body.
 */
function workerPlaneEnumsWalked(
  schema: z.ZodType,
  body: unknown,
): readonly unknown[] {
  if (schema instanceof z.ZodEnum)
    return [body, ...schema.options.filter((value) => value !== body)];
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodExactOptional)
    return body === undefined
      ? [body]
      : workerPlaneEnumsWalked(schema.unwrap() as z.ZodType, body);
  if (schema instanceof z.ZodUnion) {
    const member = (schema.options as readonly z.ZodType[]).find(
      (option) => option.safeParse(body).success,
    );
    return member === undefined ? [body] : workerPlaneEnumsWalked(member, body);
  }
  if (schema instanceof z.ZodObject) {
    const held = body as Readonly<Record<string, unknown>>;
    const shape = schema.shape as Readonly<Record<string, z.ZodType>>;
    return [
      held,
      ...Object.entries(shape).flatMap(([key, field]) =>
        workerPlaneEnumsWalked(field, held[key])
          .slice(1)
          .map((value) => ({ ...held, [key]: value })),
      ),
    ];
  }
  if (schema instanceof z.ZodArray) {
    const items = body as readonly unknown[];
    return [
      items,
      ...items.flatMap((item, index) =>
        workerPlaneEnumsWalked(schema.element as z.ZodType, item)
          .slice(1)
          .map((value) =>
            items.map((each, at) => (at === index ? value : each)),
          ),
      ),
    ];
  }
  return [body];
}

/**
 * Drives every case of `plane` as a pod built with `older` sends it, naming
 * that release, and offers every JSON body that release builds. A route the
 * release calls must be one this plane names.
 */
function workerPlaneReplayed<Name extends string>(
  plane: WorkerPlaneDriven<Name>,
  older: WorkerContractReleasePlane,
): void {
  for (const [called, route] of Object.entries(older.routes)) {
    const name = called as Name;
    test(`a ${older.release} pod reads every outcome ${route.method} ${route.path} answers`, async () => {
      assert.ok(
        Object.hasOwn(plane.cases, name),
        `${older.release} calls ${called}, which this plane does not name`,
      );
      for (const driven of plane.cases[name]) {
        const answered = await workerPlaneDriven(
          plane,
          name,
          { ...driven, release: driven.release ?? older.release },
          route,
        );
        workerPlaneReadBy(older, called, driven.name, answered);
        assert.ok(
          driven.release !== undefined || !workerPlaneVersionRefused(answered),
          `${driven.name} was refused for naming ${older.release}`,
        );
      }
    });
    const request = Object.hasOwn(plane.requests, name)
      ? plane.requests[name]
      : "Unparsed";
    if (request !== "Unparsed")
      test(`${route.method} ${route.path} takes every body a ${older.release} pod builds`, () =>
        workerPlaneBodiesTaken(plane, name, route, older, request));
  }
}

/**
 * Offers one JSON route every body `older` builds of those `request` names, each
 * roster value in turn, and asserts none is refused. The bodies it builds must
 * between them offer each optional field its schema names and leave it out.
 */
async function workerPlaneBodiesTaken<Name extends string>(
  plane: WorkerPlaneDriven<Name>,
  name: Name,
  route: WorkerPlaneRoute,
  older: WorkerContractReleasePlane,
  request: Exclude<WorkerPlaneRequest, "Unparsed">,
): Promise<void> {
  const schema = older.schemas[request.schema];
  assert.ok(schema !== undefined, `${older.release} has no ${request.schema}`);
  const built = [plane.calls[name].payload, ...request.bodies].filter(
    (body) => schema.safeParse(body).success,
  );
  assert.ok(built.length > 0, `${older.release} builds no body offered`);
  const seen = new Map<string, Set<boolean>>();
  for (const body of built) {
    workerPlaneOptionalsSeen(schema, body, request.schema, seen);
    for (const offered of workerPlaneEnumsWalked(schema, body)) {
      const what = JSON.stringify(offered);
      assert.ok(schema.safeParse(offered).success, what);
      const answered = await workerPlaneDriven(
        plane,
        name,
        {
          name: what,
          call: { headers: json, payload: offered as object },
          release: older.release,
        },
        route,
      );
      assert.notEqual(answered.status, 400, `${what} was refused`);
      assert.ok(!workerPlaneVersionRefused(answered), what);
      workerPlaneReadBy(older, name, what, answered);
    }
  }
  for (const [field, held] of seen)
    assert.equal(
      held.size,
      2,
      `${field} is ${held.has(true) ? "present" : "absent"} in every body offered`,
    );
}

const jobPlane: WorkerPlaneDriven<WorkerPlaneRouteName> = {
  routes: workerPlaneRoutes,
  calls: workerPlaneCalls,
  requests: workerPlaneRequests,
  answers: workerPlaneAnswers,
  cases: workerPlaneCases,
  bearer: "held",
  service: {
    ...inertWorkerPlane(workerPlaneContractUploadBytesMax),
    ...workerPlaneAuthority(liveAuthority),
  },
};

const sessionPlane: WorkerPlaneDriven<SessionPlaneRouteName> = {
  routes: sessionPlaneRoutes,
  calls: sessionPlaneCalls,
  requests: sessionPlaneRequests,
  answers: sessionPlaneAnswers,
  cases: sessionPlaneCases,
  bearer: `chgs_${"a".repeat(32)}`,
  service: {
    ...inertWorkerPlane(workerPlaneContractUploadBytesMax),
    ...sessionPorts({}),
  },
};

workerPlaneAnswersHeld(jobPlane);
workerPlaneAnswersHeld(sessionPlane);

for (const release of workerContractReplayed("job"))
  workerPlaneReplayed(
    jobPlane,
    await workerContractReleasePlane(release, "job"),
  );

for (const release of workerContractReplayed("session"))
  workerPlaneReplayed(
    sessionPlane,
    await workerContractReleasePlane(release, "session"),
  );

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
