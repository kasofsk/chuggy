import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

import {
  nativeHttpPageItemsMax,
  repositoryIdentityCharsMax,
  runConfigurationBytesMax,
  runModelCharsMax,
  runOutcomeLabelCharsMax,
  runTranscriptBatchBytesMax,
  runTranscriptBatchesMax,
  sessionIdentityCharsMax,
  sessionStoreBatchBytesMax,
  sessionStoreBatchesMax,
  sessionStorePageBatchesMax,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
  textCodePointsCount,
} from "../../contract/http.ts";
import {
  isSessionStoreStream,
  sessionBearerPattern,
  sessionCredentialSchema,
  sessionEndedSchema,
  sessionPlaneRoutes,
  sessionReferenceSchema,
  sessionTurnAnswerSchema,
  sessionTurnFailureSchema,
  type SessionPlaneRouteName,
} from "../../contract/sessionPlane.ts";
import { resultManifestTextCharsMax } from "../../contract/workerDocuments.ts";
import type { WorkTaskAnswer } from "../../contract/workerTask.ts";
import {
  workerPlaneBytesMediaType,
  workerPlaneRoutes,
  workerRunEndedSchema,
  workerRunTotalsSchema,
  workerRunTurnsSchema,
  type WorkerCredentialAbsent,
  type WorkerPlaneRoute,
  type WorkerPlaneRouteName,
} from "../../contract/workerPlane.ts";
import {
  asSessionBearerSecret,
  asSessionStoreStream,
  asSessionTurnId,
  type SessionBearerSecret,
  type SessionStoreStream,
} from "../../interpreter/agentSession.ts";
import {
  sessionContainerEnded,
  type SessionAttemptHoldPort,
  type SessionAttemptLossPort,
  type SessionHeartbeatPort,
  type SessionPlaneAuthority,
  type SessionPlaneIdentity,
  type SessionReferenceBound,
  type SessionReferencePort,
  type SessionStoreQueryPort,
  type SessionStoreRecordPort,
  type SessionTurnAnswered,
  type SessionTurnClaimPort,
  type SessionTurnFailed,
  type SessionTurnSettlePort,
} from "../../interpreter/sessionPlane.ts";
import type {
  SessionStoreReadPort,
  SessionStoreWritePort,
} from "../../interpreter/sessionStore.ts";
import {
  asAttemptCapabilitySecret,
  type AttemptCapabilitySecret,
} from "../../interpreter/executionScheduler.ts";
import {
  runConfigurationPath,
  runTranscriptBatchPath,
  type RunEvidenceStored,
  type RunTotals,
  type WorkerRunConfigurationPort,
  type WorkerRunEndedPort,
  type WorkerRunTotalPort,
  type WorkerRunTranscriptPort,
  type WorkerRunTurnsPort,
} from "../../interpreter/runEvidence.ts";
import { asRepositoryId } from "../../interpreter/finalizer.ts";
import type {
  WorkerPlaneCredentialMinted,
  WorkerPlaneCredentialMinting,
} from "../../interpreter/workerPlaneCredentials.ts";
import {
  artifactPathRejection,
  asArtifactDigest,
  type ArtifactFailure,
  type ArtifactPath,
  type ArtifactSite,
  type ManifestRejection,
} from "../../interpreter/resultManifest.ts";
import {
  workerContractAccepted,
  type WorkerArtifactReservationPort,
  type WorkerArtifactStored,
  type WorkerArtifactUploadPort,
  type WorkerAttemptHeartbeatPort,
  type WorkerAttemptAuthority,
  type WorkerPlaneAuthority,
  type WorkerReportPort,
  type WorkerTaskPort,
} from "../../interpreter/workerPlane.ts";
import {
  sessionTask,
  workTask,
  type SessionTask,
  type SessionTaskLaunch,
} from "../../interpreter/workerTask.ts";
import {
  planeApp,
  planeJsonObjectBytesMax,
  planeJsonTextBytesMax,
  planeRouteServed,
} from "./planeRoutes.ts";
import {
  workerContractChecked,
  workerContractNamed,
} from "./workerContractVersion.ts";

/** The probes the cluster sends, which no worker calls and so the worker contract does not name. */
export const workerPlaneHealthRoutes = {
  live: { method: "GET", path: "/health/live" },
  ready: { method: "GET", path: "/health/ready" },
} as const satisfies Readonly<Record<string, WorkerPlaneRoute>>;

/** Where a store route's own segments begin, which is what the raw url is cut at. */
const sessionStorePrefix = sessionPlaneRoutes.storeBatch.path.replace(
  /\*$/u,
  "",
);

/** An attempt its bearer was found by, and that bearer. */
interface WorkerAttemptCaller {
  readonly authority: WorkerAttemptAuthority;
  readonly secret: AttemptCapabilitySecret;
}

/** A live session its bearer was found by, and that bearer. */
interface SessionCaller {
  readonly identity: SessionPlaneIdentity;
  readonly secret: SessionBearerSecret;
}

/**
 * The task route's caller, in either bearer language: a session found live as
 * every session route finds one, or an attempt's bearer, whose task read is at
 * once the route's work and its authentication.
 */
type WorkerTaskCaller =
  | { readonly bearer: "Attempt"; readonly secret: AttemptCapabilitySecret }
  | ({ readonly bearer: "Session" } & SessionCaller);

/** Who each kind of route answers, found from its bearer before any byte of its body is read. */
interface WorkerPlaneCallers {
  /** An attempt the authority knows, live or not, because a report from a fenced one is the ingest's to refuse. */
  readonly Attempt: WorkerAttemptCaller;
  readonly LiveAttempt: WorkerAttemptCaller;
  readonly Session: SessionCaller;
  readonly Task: WorkerTaskCaller;
}

/**
 * What one route is served with: who it answers, and the most of a body it
 * takes. A `stored` body is bytes kept as they came, whose excess the route's
 * own answers name as a spent quota rather than the framework's refusal.
 */
interface WorkerPlaneServed {
  readonly caller: keyof WorkerPlaneCallers;
  readonly stored: boolean;
  readonly bodyBytesMax: number;
}

/** A route that reads no body, bounded by the empty object a client may send it anyway. */
const workerPlaneBodyless = {
  stored: false,
  bodyBytesMax: planeJsonObjectBytesMax(),
} as const;

/** The widest code point UTF-8 writes, which is what a text bounded in code points weighs per code point. */
const utf8CodePointBytesMax = 4;

/** A page of turns or of model usages, each one object naming its model. */
const workerRunPageBytesMax =
  nativeHttpPageItemsMax * planeJsonObjectBytesMax(runModelCharsMax);

/** Every job route as it is served, an artifact bounded by the upload bound its deployment chose. */
export function workerPlaneServed(uploadBytesMax: number) {
  return {
    input: { caller: "LiveAttempt", ...workerPlaneBodyless },
    task: { caller: "Task", ...workerPlaneBodyless },
    heartbeat: { caller: "LiveAttempt", ...workerPlaneBodyless },
    artifact: {
      caller: "LiveAttempt",
      stored: true,
      bodyBytesMax: uploadBytesMax,
    },
    report: {
      caller: "Attempt",
      stored: false,
      bodyBytesMax: resultManifestTextCharsMax * utf8CodePointBytesMax,
    },
    runConfiguration: {
      caller: "LiveAttempt",
      stored: true,
      bodyBytesMax: runConfigurationBytesMax,
    },
    runTranscript: {
      caller: "LiveAttempt",
      stored: true,
      bodyBytesMax: runTranscriptBatchBytesMax,
    },
    runTurns: {
      caller: "LiveAttempt",
      stored: false,
      bodyBytesMax: planeJsonObjectBytesMax() + workerRunPageBytesMax,
    },
    runTotals: {
      caller: "LiveAttempt",
      stored: false,
      bodyBytesMax:
        planeJsonObjectBytesMax(
          runOutcomeLabelCharsMax,
          runOutcomeLabelCharsMax,
        ) + workerRunPageBytesMax,
    },
    runEnded: {
      caller: "LiveAttempt",
      stored: false,
      bodyBytesMax: planeJsonObjectBytesMax(),
    },
    credential: { caller: "LiveAttempt", ...workerPlaneBodyless },
  } as const satisfies Readonly<
    Record<WorkerPlaneRouteName, WorkerPlaneServed>
  >;
}

/** One answered turn: its identity and its result, and a measurement naming its model and each of its tools. */
const sessionTurnAnswerBytesMax =
  planeJsonObjectBytesMax(sessionIdentityCharsMax, sessionTurnResultCharsMax) +
  planeJsonObjectBytesMax(sessionTurnModelCharsMax) +
  sessionTurnToolsMax * planeJsonTextBytesMax(sessionTurnToolNameCharsMax);

/** Every session route as it is served. */
export const sessionPlaneServed = {
  facts: { caller: "Session", ...workerPlaneBodyless },
  heartbeat: { caller: "Session", ...workerPlaneBodyless },
  reference: {
    caller: "Session",
    stored: false,
    bodyBytesMax: planeJsonObjectBytesMax(sessionIdentityCharsMax),
  },
  turn: { caller: "Session", ...workerPlaneBodyless },
  turnAnswer: {
    caller: "Session",
    stored: false,
    bodyBytesMax: sessionTurnAnswerBytesMax,
  },
  turnFailure: {
    caller: "Session",
    stored: false,
    bodyBytesMax: planeJsonObjectBytesMax(sessionIdentityCharsMax),
  },
  held: { caller: "Session", ...workerPlaneBodyless },
  storeStreams: { caller: "Session", ...workerPlaneBodyless },
  storeBatch: {
    caller: "Session",
    stored: true,
    bodyBytesMax: sessionStoreBatchBytesMax,
  },
  storePage: { caller: "Session", ...workerPlaneBodyless },
  credential: {
    caller: "Session",
    stored: false,
    bodyBytesMax: planeJsonObjectBytesMax(repositoryIdentityCharsMax),
  },
  ended: {
    caller: "Session",
    stored: false,
    bodyBytesMax: planeJsonObjectBytesMax(),
  },
} as const satisfies Readonly<Record<SessionPlaneRouteName, WorkerPlaneServed>>;

/** One route's handler, handed the caller its hook admitted. */
type WorkerPlaneHandler<Kind extends keyof WorkerPlaneCallers> = (
  request: FastifyRequest,
  reply: FastifyReply,
  caller: WorkerPlaneCallers[Kind],
) => Promise<unknown>;

/** Registers the route `name` names, its handler handed the caller that route's entry says it answers. */
type WorkerPlaneRegistrar<
  Served extends Readonly<Record<keyof Served, WorkerPlaneServed>>,
> = <Name extends keyof Served>(
  name: Name,
  handler: WorkerPlaneHandler<Served[Name]["caller"]>,
) => void;

type WorkerJobRegistrar = WorkerPlaneRegistrar<
  ReturnType<typeof workerPlaneServed>
>;
type SessionRegistrar = WorkerPlaneRegistrar<typeof sessionPlaneServed>;

/** A contract route's refusal of a release outside the range the job and session planes serve. */
const workerPlaneContractChecked = workerContractChecked(
  workerContractAccepted,
);

/** A stored body past its route's bound, answered as that route's own answers name it. */
function workerPlaneOverQuota(reply: FastifyReply): FastifyReply {
  return reply.code(413).send({ action: "stop", reason: "QuotaExceeded" });
}

/** How each kind of caller is found from a request's bearer. */
type WorkerPlaneCallerFinders = {
  readonly [Kind in keyof WorkerPlaneCallers]: (
    request: FastifyRequest,
  ) => Promise<WorkerPlaneCallers[Kind] | undefined>;
};

function workerPlaneCallerFinders(
  service: WorkerPlaneServerService,
): WorkerPlaneCallerFinders {
  const sessions = service.sessions;
  return {
    Attempt: (request) => workerAttemptCaller(service, request),
    LiveAttempt: async (request) => {
      const caller = await workerAttemptCaller(service, request);
      return caller?.authority.live === true ? caller : undefined;
    },
    Session: (request) =>
      sessions === undefined
        ? Promise.resolve(undefined)
        : sessionCaller(sessions, request),
    Task: (request) => workerTaskCaller(sessions, request),
  };
}

/** Admits the caller `kind` names, answering every request it does not find alike. */
function workerPlaneAdmitted<Kind extends keyof WorkerPlaneCallers>(
  finders: WorkerPlaneCallerFinders,
  kind: Kind,
): (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<WorkerPlaneCallers[Kind] | undefined> {
  const found: (
    request: FastifyRequest,
  ) => Promise<WorkerPlaneCallers[Kind] | undefined> = finders[kind];
  return async (request, reply) => {
    const caller = await found(request);
    if (caller === undefined) void reply.code(401).send({ action: "stop" });
    return caller;
  };
}

/** A registrar for one route table, each route refusing a release this plane does not serve and then any caller it does not answer. */
function workerPlaneRegistrar<
  Served extends Readonly<Record<keyof Served, WorkerPlaneServed>>,
>(
  app: FastifyInstance,
  service: WorkerPlaneServerService,
  routes: { readonly [Name in keyof Served]: WorkerPlaneRoute },
  served: Served,
): WorkerPlaneRegistrar<Served> {
  const finders = workerPlaneCallerFinders(service);
  return <Name extends keyof Served>(
    name: Name,
    handler: WorkerPlaneHandler<Served[Name]["caller"]>,
  ) => {
    const route = served[name];
    planeRouteServed(
      app,
      {
        method: routes[name].method,
        url: routes[name].path,
        bodyBytesMax: route.bodyBytesMax,
        released: workerPlaneContractChecked,
        ...(route.stored ? { oversized: workerPlaneOverQuota } : {}),
      },
      workerPlaneAdmitted<Served[Name]["caller"]>(finders, route.caller),
      handler,
    );
  };
}

/** The ports a run's own evidence is written through, all five attempt-fenced. */
export interface WorkerRunEvidencePorts {
  readonly configurations: WorkerRunConfigurationPort;
  readonly transcripts: WorkerRunTranscriptPort;
  readonly turns: WorkerRunTurnsPort;
  readonly totals: WorkerRunTotalPort;
  readonly endings: WorkerRunEndedPort;
}

/**
 * Everything one session pod is answered through: the durable ports, the store
 * its bytes land in, and the bounds its mailbox waits under. It is one value
 * because it is one composition — a plane holding some of these and not others
 * could only answer a session wrongly.
 */
export interface SessionPlaneService {
  readonly authority: SessionPlaneAuthority;
  readonly heartbeats: SessionHeartbeatPort;
  readonly heartbeatLeaseSecs: number;
  readonly references: SessionReferencePort;
  readonly turns: SessionTurnClaimPort;
  readonly settlements: SessionTurnSettlePort;
  readonly holds: SessionAttemptHoldPort;
  readonly losses: SessionAttemptLossPort;
  readonly records: SessionStoreRecordPort;
  readonly queries: SessionStoreQueryPort;
  readonly store: SessionStoreWritePort & SessionStoreReadPort;
  /** How often a waiting mailbox asks again, and for how long one request waits. */
  readonly turnPollIntervalMs: number;
  readonly turnPollSecsMax: number;
  /** How many mailbox waits are held at once, above which a caller is answered empty. */
  readonly pollsMax: number;
}

export interface WorkerPlaneServerService {
  readonly authority: WorkerPlaneAuthority;
  readonly tasks: WorkerTaskPort;
  readonly heartbeats: WorkerAttemptHeartbeatPort;
  readonly heartbeatLeaseSecs: number;
  readonly artifacts: WorkerArtifactUploadPort;
  readonly reservations: WorkerArtifactReservationPort;
  readonly reports: WorkerReportPort;
  readonly runEvidence: WorkerRunEvidencePorts;
  /**
   * The session plane, where a deployment has composed one. A plane without it
   * serves no session route at all: an absent route is an answer a pod's
   * transport can act on, where a route standing in front of ports that are not
   * there could only answer wrongly.
   */
  readonly sessions?: SessionPlaneService;
  /**
   * The minting a deployment holding a forge app key composes. Without one both
   * credential routes answer not found, which is the pod resolving the
   * credential its launcher mounted exactly as it did before this plane minted
   * anything.
   */
  readonly credentials?: WorkerPlaneCredentialMinting;
  readonly ready: () => Promise<boolean>;
  readonly uploadBytesMax: number;
}

/** The offered totals as the durable port takes them, an absent label omitted. */
function workerRunTotals(
  offered: z.infer<typeof workerRunTotalsSchema>,
): RunTotals {
  const { resultSubtype, stopReason, ...rest } = offered;
  return {
    ...rest,
    ...(resultSubtype === undefined ? {} : { resultSubtype }),
    ...(stopReason === undefined ? {} : { stopReason }),
  };
}

/** The status one refused evidence write is answered with, quota apart from refusal. */
function workerRunStatus(stored: RunEvidenceStored): number {
  return stored === "QuotaExceeded" ? 413 : 409;
}

/**
 * How many events one batch carries, counted as the newline-terminated records
 * it is written as, so the count is a property of the bytes and not a reading
 * of them.
 */
function workerRunEvents(content: Uint8Array): number {
  let events = 0;
  for (const byte of content) if (byte === 0x0a) events += 1;
  return events;
}

function workerHeartbeatRoute(
  register: WorkerJobRegistrar,
  service: WorkerPlaneServerService,
): void {
  register("heartbeat", async (_request, reply, { authority, secret }) =>
    (await service.heartbeats.heartbeat(
      secret,
      authority.generation,
      service.heartbeatLeaseSecs,
    ))
      ? reply.code(204).send()
      : reply.code(409).send({ action: "stop" }),
  );
}

/** The probes, which name no release and no caller and read no body. */
function workerHealthRoutes(
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  const { live, ready } = workerPlaneHealthRoutes;
  app.route({
    method: live.method,
    url: live.path,
    handler: () => ({ status: "live" }),
  });
  app.route({
    method: ready.method,
    url: ready.path,
    handler: async (_request, reply) =>
      (await service.ready())
        ? { status: "ready" }
        : reply.code(503).send({ status: "unready" }),
  });
}

/** An attempt the authority knows by the request's bearer, live or not, or nothing. */
async function workerAttemptCaller(
  service: WorkerPlaneServerService,
  request: FastifyRequest,
): Promise<WorkerAttemptCaller | undefined> {
  const secret = workerBearer(request);
  if (secret === undefined) return undefined;
  const authority = await service.authority.authenticate(secret);
  return authority === undefined ? undefined : { authority, secret };
}

/**
 * One attempt bearer as this plane reads it. A token written in the session
 * language is not offered here at all: the two languages are disjoint by
 * construction, and a token handed to the wrong authority is a token that
 * authority now has.
 */
function workerBearer(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length);
  return token.length > 0 &&
    token.length <= 256 &&
    !sessionBearerPattern.test(token)
    ? asAttemptCapabilitySecret(token)
    : undefined;
}

/** The task route's caller: a live session where the bearer is written in the session language, and otherwise an attempt's bearer. */
async function workerTaskCaller(
  sessions: SessionPlaneService | undefined,
  request: FastifyRequest,
): Promise<WorkerTaskCaller | undefined> {
  if (sessionBearer(request) === undefined) {
    const secret = workerBearer(request);
    return secret === undefined ? undefined : { bearer: "Attempt", secret };
  }
  const caller =
    sessions === undefined ? undefined : await sessionCaller(sessions, request);
  return caller === undefined ? undefined : { bearer: "Session", ...caller };
}

/** An attempt bearer's task, or nothing where the attempt is not live, or why a live one has none. */
async function workerTaskOf(
  service: WorkerPlaneServerService,
  secret: AttemptCapabilitySecret,
): Promise<WorkTaskAnswer | "TaskNotRecorded" | undefined> {
  const found = await service.tasks.work(secret);
  if (found === undefined || !found.live) return undefined;
  return found.invocation === undefined
    ? "TaskNotRecorded"
    : { kind: "Work", ...workTask(found.identity, found.invocation) };
}

/** A session's task, read only once the session authority has found it live. */
async function sessionTaskOf(
  service: WorkerPlaneServerService,
  secret: SessionBearerSecret,
): Promise<
  (SessionTask & Partial<SessionTaskLaunch>) | "TaskNotRecorded" | undefined
> {
  const found = await service.tasks.session(secret);
  if (found === undefined || !found.live) return undefined;
  return found.invocation === undefined
    ? "TaskNotRecorded"
    : { ...sessionTask(found.identity, found.invocation), ...found.launch };
}

/**
 * The task a bearer's pod is launched with, less what its site adds, read by
 * the authority its bearer's language names. A session's is told from a work
 * task by its own kind.
 */
function workerTaskRoute(
  register: WorkerJobRegistrar,
  service: WorkerPlaneServerService,
): void {
  register("task", async (_request, reply, caller) => {
    const found =
      caller.bearer === "Attempt"
        ? await workerTaskOf(service, caller.secret)
        : await sessionTaskOf(service, caller.secret);
    if (found === undefined) return reply.code(401).send({ action: "stop" });
    if (found === "TaskNotRecorded")
      return reply
        .code(409)
        .send({ action: "stop", reason: "TaskNotRecorded" });
    return found;
  });
}

function workerInputRoute(register: WorkerJobRegistrar): void {
  register("input", (_request, _reply, { authority }) =>
    Promise.resolve({
      bundle: authority.inputBundle,
      digest: authority.inputBundleDigest,
      references: authority.inputs,
    }),
  );
}

function workerUploadRoute(
  register: WorkerJobRegistrar,
  service: WorkerPlaneServerService,
): void {
  register("artifact", async (request, reply, { authority, secret }) => {
    const path = (request.params as { "*": string })["*"];
    if (!(request.body instanceof Uint8Array))
      return reply.code(415).send({ action: "stop" });
    if (artifactPathRejection(path) !== undefined)
      return reply.code(400).send({ action: "stop", reason: "InvalidPath" });
    const digest = createHash("sha256").update(request.body).digest("hex");
    const reserved = await service.reservations.reserve({
      secret,
      path,
      digest,
      bytes: request.body.byteLength,
    });
    if (reserved.reserved !== "Reserved")
      return reply
        .code(reserved.reserved === "QuotaExceeded" ? 413 : 409)
        .send({ action: "stop", reason: reserved.reserved });
    const stored = await service.artifacts.store({
      authority,
      path,
      content: request.body,
    });
    switch (stored.stored) {
      case "Stored":
        return reply.code(204).send();
      case "Conflict":
        return reply.code(409).send({ action: "stop" });
      case "Refused":
        return reply
          .code(stored.reason === "InvalidPath" ? 400 : 413)
          .send({ action: "stop", reason: stored.reason });
      case "Unavailable":
        return reply
          .header("retry-after", String(stored.retryAfterSeconds))
          .code(503)
          .send({ action: "retry" });
    }
  });
}

/**
 * What one refused write answers with, decided before any of it is sent. It is
 * the plane's and not a run's: a status, a body and a retry interval are what
 * every route here refuses with, and a second copy under a session name would
 * be a second renderer to keep true.
 */
interface WorkerPlaneRefusal {
  readonly status: number;
  readonly body: Readonly<Record<string, string>>;
  readonly retryAfterSeconds?: number;
}

/** The refusal storing one object earned, or nothing where its bytes are kept. */
function workerRunObjectRefusal(
  kept: WorkerArtifactStored,
): WorkerPlaneRefusal | undefined {
  switch (kept.stored) {
    case "Stored":
      return undefined;
    case "Conflict":
      return { status: 409, body: { action: "stop", reason: "Conflict" } };
    case "Refused":
      return {
        status: kept.reason === "InvalidPath" ? 400 : 413,
        body: { action: "stop", reason: kept.reason },
      };
    case "Unavailable":
      return {
        status: 503,
        body: { action: "retry" },
        retryAfterSeconds: kept.retryAfterSeconds,
      };
  }
}

/**
 * The bytes of one run-evidence object, kept before the row that points at
 * them: an object no row names is inert, while a row whose object is absent is
 * a hole the transcript's own high-water mark would then advance past.
 */
async function workerRunObjectKept(
  service: WorkerPlaneServerService,
  authority: WorkerAttemptAuthority,
  path: ArtifactPath,
  content: Uint8Array,
): Promise<WorkerPlaneRefusal | undefined> {
  return workerRunObjectRefusal(
    await service.artifacts.store({ authority, path, content }),
  );
}

function workerPlaneRefused(
  reply: FastifyReply,
  refusal: WorkerPlaneRefusal,
): FastifyReply {
  return refusal.retryAfterSeconds === undefined
    ? reply.code(refusal.status).send(refusal.body)
    : reply
        .header("retry-after", String(refusal.retryAfterSeconds))
        .code(refusal.status)
        .send(refusal.body);
}

/** The digest of what a worker offered, which is what the durable row pins. */
function workerRunDigest(content: Uint8Array) {
  return asArtifactDigest(createHash("sha256").update(content).digest("hex"));
}

function workerRunConfigurationRoute(
  register: WorkerJobRegistrar,
  service: WorkerPlaneServerService,
): void {
  register("runConfiguration", async (request, reply, writer) => {
    if (!(request.body instanceof Uint8Array))
      return reply.code(415).send({ action: "stop" });
    const refusal = await workerRunObjectKept(
      service,
      writer.authority,
      runConfigurationPath(),
      request.body,
    );
    if (refusal !== undefined) return workerPlaneRefused(reply, refusal);
    const stored = await service.runEvidence.configurations.record({
      secret: writer.secret,
      generation: writer.authority.generation,
      digest: workerRunDigest(request.body),
      bytes: request.body.byteLength,
    });
    return stored === "Stored" || stored === "AlreadyStored"
      ? reply.code(204).send()
      : reply
          .code(workerRunStatus(stored))
          .send({ action: "stop", reason: stored });
  });
}

function workerRunTranscriptRoute(
  register: WorkerJobRegistrar,
  service: WorkerPlaneServerService,
): void {
  register("runTranscript", async (request, reply, writer) => {
    if (!(request.body instanceof Uint8Array))
      return reply.code(415).send({ action: "stop" });
    const named = (request.params as { "*": string })["*"];
    const batch = /^[1-9][0-9]*$/u.test(named) ? Number(named) : 0;
    if (batch < 1 || batch > runTranscriptBatchesMax)
      return reply.code(400).send({ action: "stop", reason: "InvalidBatch" });
    const refusal = await workerRunObjectKept(
      service,
      writer.authority,
      runTranscriptBatchPath(batch),
      request.body,
    );
    if (refusal !== undefined) return workerPlaneRefused(reply, refusal);
    const stored = await service.runEvidence.transcripts.record({
      secret: writer.secret,
      generation: writer.authority.generation,
      batch,
      digest: workerRunDigest(request.body),
      bytes: request.body.byteLength,
      events: workerRunEvents(request.body),
    });
    return stored === "Stored" || stored === "AlreadyStored"
      ? reply.code(204).send()
      : reply
          .code(workerRunStatus(stored))
          .send({ action: "stop", reason: stored });
  });
}

function workerRunFigureRoutes(
  register: WorkerJobRegistrar,
  service: WorkerPlaneServerService,
): void {
  register("runTurns", async (request, reply, writer) => {
    const offered = workerRunTurnsSchema.safeParse(request.body);
    if (!offered.success) return reply.code(400).send({ action: "stop" });
    const recorded = await service.runEvidence.turns.record({
      secret: writer.secret,
      generation: writer.authority.generation,
      turns: offered.data.turns,
    });
    return recorded.recorded === "Recorded"
      ? reply.code(200).send({ turnsRecorded: recorded.turnsRecorded })
      : reply.code(409).send({ action: "stop", reason: recorded.recorded });
  });
  register("runTotals", async (request, reply, writer) => {
    const offered = workerRunTotalsSchema.safeParse(request.body);
    if (!offered.success) return reply.code(400).send({ action: "stop" });
    const stored = await service.runEvidence.totals.record({
      secret: writer.secret,
      generation: writer.authority.generation,
      totals: workerRunTotals(offered.data),
    });
    return stored === "Stored" || stored === "AlreadyStored"
      ? reply.code(204).send()
      : reply
          .code(workerRunStatus(stored))
          .send({ action: "stop", reason: stored });
  });
  register("runEnded", async (request, reply, writer) => {
    const offered = workerRunEndedSchema.safeParse(request.body);
    if (!offered.success) return reply.code(400).send({ action: "stop" });
    return (await service.runEvidence.endings.end({
      secret: writer.secret,
      generation: writer.authority.generation,
      evidence: offered.data.evidence,
    }))
      ? reply.code(204).send()
      : reply.code(409).send({ action: "stop" });
  });
}

/**
 * The body a refused report is answered with, naming the roster member it was
 * refused for and the row that was reached where there is one. Both rosters are
 * closed, so what a worker may write into an error artifact is bounded.
 */
function workerReportRefused(
  reason: ManifestRejection | ArtifactFailure,
  at: ArtifactSite | undefined,
): {
  readonly action: "stop";
  readonly reason: ManifestRejection | ArtifactFailure;
  readonly at?: ArtifactSite;
} {
  return at === undefined
    ? { action: "stop", reason }
    : { action: "stop", reason, at };
}

function workerReportRoute(
  register: WorkerJobRegistrar,
  service: WorkerPlaneServerService,
): void {
  register("report", async (request, reply, { authority, secret }) => {
    if (
      typeof request.body !== "string" ||
      textCodePointsCount(request.body) > resultManifestTextCharsMax
    )
      return reply.code(400).send({ action: "stop" });
    const ingested = await service.reports.report(secret, {
      partition: authority.partition,
      execution: authority.execution,
      attempt: authority.attempt,
      generation: authority.generation,
      manifest: authority.manifest,
      text: request.body,
    });
    switch (ingested.ingested) {
      case "Terminalized":
      case "Absorbed":
        return reply.code(202).send({ action: "stop" });
      case "Unavailable":
        return reply
          .header("retry-after", String(ingested.retryAfterSeconds))
          .code(503)
          .send({ action: "retry" });
      case "Fenced":
      case "Stale":
      case "NotAdmitted":
      case "Conflicting":
        return reply.code(409).send({ action: "stop" });
      case "Malformed":
        return reply
          .code(409)
          .send(workerReportRefused(ingested.code, ingested.at));
      case "Unconfirmed":
        return reply
          .code(409)
          .send(workerReportRefused(ingested.failure, ingested.at));
    }
  });
}

/** How long a pod leaves a plane that could not reach the forge before asking again. */
const workerCredentialRetryAfterSeconds = 1;

/** What a plane holding no app key answers, which is the pod's signal to fall back. */
const workerCredentialNotConfigured: WorkerCredentialAbsent = {
  reason: "ForgeNotConfigured",
};

/** What a plane that mints answers for a repository it may not mint for. */
const workerCredentialNotMinted: WorkerCredentialAbsent = {
  reason: "NotMinted",
};

/**
 * One minted credential, or the refusal that sends a pod back to what its
 * launcher mounted. A not-found carries no `action`, unlike every other refusal
 * here: the pod neither stops nor retries on it, it resolves its own mounted
 * credential instead, and an outage is the arm that says to wait.
 */
function workerCredentialAnswered(
  reply: FastifyReply,
  minted: WorkerPlaneCredentialMinted,
): FastifyReply {
  switch (minted.minted) {
    case "Credential":
      return reply.code(200).send(minted.value);
    case "NotFound":
      return reply.code(404).send(workerCredentialNotMinted);
    case "Unavailable":
      return workerPlaneRefused(reply, {
        status: 503,
        body: { action: "retry" },
        retryAfterSeconds: workerCredentialRetryAfterSeconds,
      });
  }
}

/**
 * The credential one attempt works under. It carries no body: the repository is
 * the one the attempt's own input bundle pinned and the permission set follows
 * from the kind of task the scheduler recorded, so there is nothing here for a
 * pod to name and nothing for it to widen.
 */
function workerCredentialRoute(
  register: WorkerJobRegistrar,
  service: WorkerPlaneServerService,
): void {
  register("credential", async (_request, reply, { authority }) => {
    const credentials = service.credentials;
    return credentials === undefined
      ? reply.code(404).send(workerCredentialNotConfigured)
      : workerCredentialAnswered(reply, await credentials.attempt(authority));
  });
}

/**
 * The credential one session reads its tree under. It names its repository,
 * because a site may have placed the session against a mirror of the binding
 * rather than the binding itself; the minting holds that name to the project's
 * own bindings, and a session is never minted more than a read.
 */
function sessionCredentialRoute(
  register: SessionRegistrar,
  service: WorkerPlaneServerService,
): void {
  register("credential", async (request, reply, caller) => {
    const offered = sessionCredentialSchema.safeParse(request.body);
    if (!offered.success) return reply.code(400).send({ action: "stop" });
    const credentials = service.credentials;
    return credentials === undefined
      ? reply.code(404).send(workerCredentialNotConfigured)
      : workerCredentialAnswered(
          reply,
          await credentials.session(
            caller.identity.partition,
            asRepositoryId(offered.data.repository),
          ),
        );
  });
}

/** One session bearer as this plane reads it, or nothing where the token is not one. */
function sessionBearer(
  request: FastifyRequest,
): SessionBearerSecret | undefined {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length);
  return sessionBearerPattern.test(token)
    ? asSessionBearerSecret(token)
    : undefined;
}

/**
 * The live session one route acts for. A bearer written in the attempt's
 * language never reaches the session authority and a session bearer never
 * reaches the attempt's, so neither authority is ever handed the other's token.
 */
async function sessionCaller(
  sessions: SessionPlaneService,
  request: FastifyRequest,
): Promise<SessionCaller | undefined> {
  const secret = sessionBearer(request);
  if (secret === undefined) return undefined;
  const identity = await sessions.authority.authenticate(secret);
  return identity === undefined || !identity.live
    ? undefined
    : { identity, secret };
}

/**
 * The segments one store route was called with, read off the raw url rather
 * than a routed parameter: a stream is one percent-encoded segment, and a
 * parameter the router has already decoded has lost the boundary between the
 * stream and whatever followed it.
 */
function sessionStoreSegments(
  request: FastifyRequest,
): readonly string[] | undefined {
  const path = request.url.split("?")[0] ?? "";
  if (!path.startsWith(sessionStorePrefix)) return undefined;
  const segments = path.slice(sessionStorePrefix.length).split("/");
  try {
    return segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
}

/** One query figure as a canonical decimal, or nothing where it is not one this route holds. */
function sessionQueryCount(
  value: unknown,
  fallback: number,
  least: number,
  most: number,
): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value))
    return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= least && parsed <= most
    ? parsed
    : undefined;
}

/** What a refused settlement answers with, a conflict and a fence read alike by the pod. */
function sessionSettled(
  reply: FastifyReply,
  settled: SessionReferenceBound | SessionTurnAnswered | SessionTurnFailed,
): FastifyReply {
  return settled === "Conflict" || settled === "Fenced"
    ? reply.code(409).send({ action: "stop", reason: settled })
    : reply.code(204).send();
}

function sessionFactsRoute(register: SessionRegistrar): void {
  register("facts", (_request, _reply, { identity }) =>
    Promise.resolve({
      tenant: identity.partition.tenant,
      project: identity.partition.project,
      session: identity.session,
      kind: identity.kind,
      capabilities: identity.capabilities,
      credentialSlot: identity.credentialSlot,
      ...(identity.agentReference === undefined
        ? {}
        : { agentReference: identity.agentReference }),
      ...(identity.systemPrompt === undefined
        ? {}
        : { systemPrompt: identity.systemPrompt }),
      ...(identity.forkFrom === undefined
        ? {}
        : { forkFrom: identity.forkFrom }),
    }),
  );
}

function sessionHeartbeatRoute(
  register: SessionRegistrar,
  sessions: SessionPlaneService,
): void {
  register("heartbeat", async (_request, reply, caller) => {
    return (await sessions.heartbeats.heartbeat(
      caller.secret,
      caller.identity.generation,
      sessions.heartbeatLeaseSecs,
    ))
      ? reply.code(204).send()
      : reply.code(409).send({ action: "stop" });
  });
}

function sessionReferenceRoute(
  register: SessionRegistrar,
  sessions: SessionPlaneService,
): void {
  register("reference", async (request, reply, caller) => {
    const offered = sessionReferenceSchema.safeParse(request.body);
    if (!offered.success) return reply.code(400).send({ action: "stop" });
    return sessionSettled(
      reply,
      await sessions.references.bind({
        secret: caller.secret,
        generation: caller.identity.generation,
        reference: offered.data.reference,
      }),
    );
  });
}

/**
 * The mailbox. One request asks for a turn until the poll window is spent and
 * then answers empty, and only so many requests wait at once: over that a
 * caller is answered empty at once rather than queued, so a burst of pods
 * cannot hold every connection this plane has.
 */
function sessionTurnRoute(
  register: SessionRegistrar,
  sessions: SessionPlaneService,
): void {
  const polls = Math.max(
    1,
    Math.ceil((sessions.turnPollSecsMax * 1_000) / sessions.turnPollIntervalMs),
  );
  let waiting = 0;
  register("turn", async (_request, reply, caller) => {
    if (waiting >= sessions.pollsMax) return reply.code(204).send();
    waiting += 1;
    try {
      for (let poll = 0; poll < polls; poll += 1) {
        if (poll > 0) await delay(sessions.turnPollIntervalMs);
        const claimed = await sessions.turns.claim({
          secret: caller.secret,
          generation: caller.identity.generation,
        });
        if (claimed !== undefined) return reply.code(200).send(claimed);
      }
    } finally {
      waiting -= 1;
    }
    return reply.code(204).send();
  });
}

function sessionSettleRoutes(
  register: SessionRegistrar,
  sessions: SessionPlaneService,
): void {
  register("turnAnswer", async (request, reply, caller) => {
    const offered = sessionTurnAnswerSchema.safeParse(request.body);
    if (!offered.success) return reply.code(400).send({ action: "stop" });
    const { turn, result, batchFirst, batchLast, measured } = offered.data;
    return sessionSettled(
      reply,
      await sessions.settlements.answer({
        secret: caller.secret,
        generation: caller.identity.generation,
        turn: asSessionTurnId(turn),
        result,
        ...(batchFirst === undefined ? {} : { batchFirst }),
        ...(batchLast === undefined ? {} : { batchLast }),
        ...(measured === undefined ? {} : { measured }),
      }),
    );
  });
  register("turnFailure", async (request, reply, caller) => {
    const offered = sessionTurnFailureSchema.safeParse(request.body);
    if (!offered.success) return reply.code(400).send({ action: "stop" });
    return sessionSettled(
      reply,
      await sessions.settlements.fail({
        secret: caller.secret,
        generation: caller.identity.generation,
        turn: asSessionTurnId(offered.data.turn),
        failure: offered.data.failure,
      }),
    );
  });
  register("held", async (_request, reply, caller) => {
    const held = await sessions.holds.hold(
      caller.secret,
      caller.identity.generation,
    );
    return held
      ? reply.code(204).send()
      : reply.code(409).send({ action: "stop", reason: "Fenced" });
  });
}

/** A runner's report that its session's container ended, which loses the attempt as the observation of a pod's end would. */
function sessionEndedRoute(
  register: SessionRegistrar,
  sessions: SessionPlaneService,
): void {
  register("ended", async (request, reply, caller) => {
    const offered = sessionEndedSchema.safeParse(request.body);
    if (!offered.success) return reply.code(400).send({ action: "stop" });
    return (await sessionContainerEnded(
      sessions.losses,
      caller.secret,
      caller.identity.generation,
      offered.data.phase,
    ))
      ? reply.code(204).send()
      : reply.code(409).send({ action: "stop", reason: "Fenced" });
  });
}

/** The refusal keeping one batch's bytes earned, or nothing where they are kept. */
function sessionStoreObjectRefusal(
  kept: Awaited<ReturnType<SessionStoreWritePort["storeBatch"]>>,
): WorkerPlaneRefusal | undefined {
  switch (kept.stored) {
    case "Stored":
      return undefined;
    case "Conflict":
      return { status: 409, body: { action: "stop", reason: "Conflict" } };
    case "Refused":
      return { status: 413, body: { action: "stop", reason: kept.reason } };
    case "Unavailable":
      return {
        status: 503,
        body: { action: "retry" },
        retryAfterSeconds: kept.retryAfterSeconds,
      };
  }
}

function sessionStoreWriteRoute(
  register: SessionRegistrar,
  sessions: SessionPlaneService,
): void {
  register("storeBatch", async (request, reply, caller) => {
    if (!(request.body instanceof Uint8Array))
      return reply.code(415).send({ action: "stop" });
    const segments = sessionStoreSegments(request);
    if (segments === undefined || segments.length !== 2)
      return reply.code(400).send({ action: "stop", reason: "InvalidPath" });
    const named = segments[0] ?? "";
    if (!isSessionStoreStream(named))
      return reply.code(400).send({ action: "stop", reason: "InvalidStream" });
    const numbered = segments[1] ?? "";
    const batch = /^[1-9][0-9]*$/u.test(numbered) ? Number(numbered) : 0;
    if (batch < 1 || batch > sessionStoreBatchesMax)
      return reply.code(400).send({ action: "stop", reason: "InvalidBatch" });
    const stream = asSessionStoreStream(named);
    const refusal = sessionStoreObjectRefusal(
      await sessions.store.storeBatch({
        partition: caller.identity.partition,
        session: caller.identity.session,
        stream,
        batch,
        content: request.body,
      }),
    );
    if (refusal !== undefined) return workerPlaneRefused(reply, refusal);
    const recorded = await sessions.records.record({
      secret: caller.secret,
      generation: caller.identity.generation,
      stream,
      batch,
      digest: createHash("sha256").update(request.body).digest("hex"),
      bytes: request.body.byteLength,
      events: workerRunEvents(request.body),
    });
    if (recorded === "Stored" || recorded === "AlreadyStored")
      return reply.code(204).send();
    if (recorded === "Fenced") return reply.code(401).send({ action: "stop" });
    return reply
      .code(recorded === "QuotaExceeded" ? 413 : 409)
      .send({ action: "stop", reason: recorded });
  });
}

/**
 * One page of a stream read back, each object under the session its ROW names
 * and never the caller's — a fork's page is resolved through its parent, the
 * store keys an object by the session that wrote it, and that read is the fence
 * on which sessions may be addressed at all. Only an outage refuses the page: a
 * batch whose object is gone or is not one this store can speak for is marked
 * missing, because a reader of either has the same nothing and the same one
 * thing to do about it, and the batches beside it are what the caller came for.
 */
function sessionStoreReadRoute(
  register: SessionRegistrar,
  sessions: SessionPlaneService,
): void {
  register("storePage", async (request, reply, caller) => {
    const segments = sessionStoreSegments(request);
    if (segments === undefined || segments.length !== 1)
      return reply.code(400).send({ action: "stop", reason: "InvalidPath" });
    const named = segments[0] ?? "";
    if (!isSessionStoreStream(named))
      return reply.code(400).send({ action: "stop", reason: "InvalidStream" });
    const asked = request.query as Record<string, unknown>;
    const after = sessionQueryCount(
      asked["after"],
      0,
      0,
      sessionStoreBatchesMax,
    );
    const limit = sessionQueryCount(
      asked["limit"],
      sessionStorePageBatchesMax,
      1,
      sessionStorePageBatchesMax,
    );
    if (after === undefined || limit === undefined)
      return reply.code(400).send({ action: "stop", reason: "InvalidQuery" });
    const stream = asSessionStoreStream(named);
    const rows = await sessions.queries.batches({
      secret: caller.secret,
      generation: caller.identity.generation,
      stream,
      after,
      limit,
    });
    const batches: unknown[] = [];
    for (const row of rows) {
      const drawn = await sessions.store.readBatch({
        partition: caller.identity.partition,
        session: row.session,
        stream,
        batch: row.batch,
      });
      if (drawn.read === "Unavailable")
        return workerPlaneRefused(reply, {
          status: 503,
          body: { action: "retry" },
          retryAfterSeconds: drawn.retryAfterSeconds,
        });
      batches.push(
        drawn.read === "Content"
          ? { batch: row.batch, content: drawn.content }
          : { batch: row.batch, read: "Missing" },
      );
    }
    const last = rows.at(-1);
    return reply.code(200).send({
      batches,
      ...(last === undefined || rows.length < limit
        ? {}
        : { nextAfter: last.batch }),
    });
  });
}

/**
 * The streams one session's store holds, narrowed here by the prefix the
 * resuming adapter asks under, because the durable side keys them by session
 * alone and a prefix is a question about the name rather than about what the
 * stream holds.
 *
 * AN ANSWER PAST THE BOUND IS REFUSED AND NEVER CUT, there being no cursor to
 * page by: a cut list is a resume that materialises some of a lead's subagent
 * history and reports success, which is the silent wrongness this store exists
 * to prevent.
 */
function sessionStoreStreamsRoute(
  register: SessionRegistrar,
  sessions: SessionPlaneService,
): void {
  register("storeStreams", async (request, reply, caller) => {
    const asked = (request.query as Record<string, unknown>)["stream"];
    if (asked !== undefined && typeof asked !== "string")
      return reply.code(400).send({ action: "stop", reason: "InvalidQuery" });
    const rows = await sessions.queries.streams({
      secret: caller.secret,
      generation: caller.identity.generation,
    });
    const streams = rows.filter(
      (row: { readonly stream: SessionStoreStream }) =>
        asked === undefined || row.stream.startsWith(asked),
    );
    return streams.length > nativeHttpPageItemsMax
      ? reply.code(413).send({ action: "stop", reason: "TooManyStreams" })
      : reply.code(200).send({ streams });
  });
}

/**
 * Refuses at construction what no later call could work around, the way
 * `artifactStore` refuses its own options: a poll interval of zero derives an
 * unbounded loop with no wait in it, and a ceiling of zero is a mailbox that
 * answers empty for the life of the process. None of them has a default,
 * because a default here is a bound nobody chose standing in for one nobody
 * supplied.
 */
function sessionBoundsChecked(sessions: SessionPlaneService): void {
  for (const [name, bound] of [
    ["heartbeatLeaseSecs", sessions.heartbeatLeaseSecs],
    ["turnPollIntervalMs", sessions.turnPollIntervalMs],
    ["turnPollSecsMax", sessions.turnPollSecsMax],
    ["pollsMax", sessions.pollsMax],
  ] as const) {
    if (!Number.isSafeInteger(bound) || bound <= 0) {
      throw new RangeError(
        `worker plane: session ${name} must be a positive safe integer`,
      );
    }
  }
}

export function createWorkerPlaneApp(
  service: WorkerPlaneServerService,
): FastifyInstance {
  const app = planeApp();
  app.addContentTypeParser(
    workerPlaneBytesMediaType,
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    },
  );
  workerContractNamed(app);
  workerHealthRoutes(app, service);
  const register = workerPlaneRegistrar(
    app,
    service,
    workerPlaneRoutes,
    workerPlaneServed(service.uploadBytesMax),
  );
  workerInputRoute(register);
  workerTaskRoute(register, service);
  workerHeartbeatRoute(register, service);
  workerUploadRoute(register, service);
  workerReportRoute(register, service);
  workerRunConfigurationRoute(register, service);
  workerRunTranscriptRoute(register, service);
  workerRunFigureRoutes(register, service);
  workerCredentialRoute(register, service);
  const sessions = service.sessions;
  if (sessions !== undefined) {
    sessionBoundsChecked(sessions);
    const registerSession = workerPlaneRegistrar(
      app,
      service,
      sessionPlaneRoutes,
      sessionPlaneServed,
    );
    sessionCredentialRoute(registerSession, service);
    sessionFactsRoute(registerSession);
    sessionHeartbeatRoute(registerSession, sessions);
    sessionReferenceRoute(registerSession, sessions);
    sessionTurnRoute(registerSession, sessions);
    sessionSettleRoutes(registerSession, sessions);
    sessionEndedRoute(registerSession, sessions);
    sessionStoreWriteRoute(registerSession, sessions);
    sessionStoreReadRoute(registerSession, sessions);
    sessionStoreStreamsRoute(registerSession, sessions);
  }
  return app;
}
