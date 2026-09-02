import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";

import {
  countSchema,
  nativeHttpPageItemsMax,
  runConfigurationBytesMax,
  runModelCharsMax,
  runTranscriptBatchBytesMax,
  runTranscriptBatchesMax,
  runTurnSeriesMax,
  sessionStoreBatchBytesMax,
  sessionStoreBatchesMax,
  sessionStorePageBatchesMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "../../contract/http.ts";
import {
  runModelUsageSchema,
  runTotalsSchema,
} from "../../contract/responses.ts";
import { isBoundedText } from "../../interpreter/boundedText.ts";
import {
  allAgentReportedTurnFailures,
  asSessionBearerSecret,
  asSessionStoreStream,
  asSessionTurnId,
  isSessionStoreStream,
  sessionBearerPattern,
  sessionIdentityCharsMax,
  type SessionBearerSecret,
  type SessionStoreStream,
} from "../../interpreter/agentSession.ts";
import type {
  SessionAttemptHoldPort,
  SessionHeartbeatPort,
  SessionPlaneAuthority,
  SessionPlaneIdentity,
  SessionReferenceBound,
  SessionReferencePort,
  SessionStoreQueryPort,
  SessionStoreRecordPort,
  SessionTurnAnswered,
  SessionTurnClaimPort,
  SessionTurnFailed,
  SessionTurnSettlePort,
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
  runEndedEvidences,
  runTranscriptBatchPath,
  type RunEvidenceStored,
  type RunTotals,
  type WorkerRunConfigurationPort,
  type WorkerRunEndedPort,
  type WorkerRunTotalPort,
  type WorkerRunTranscriptPort,
  type WorkerRunTurnsPort,
} from "../../interpreter/runEvidence.ts";
import {
  artifactPathRejection,
  asArtifactDigest,
  resultManifestTextCharsMax,
  type ArtifactFailure,
  type ArtifactPath,
  type ArtifactSite,
  type ManifestRejection,
} from "../../interpreter/resultManifest.ts";
import type {
  WorkerArtifactReservationPort,
  WorkerArtifactStored,
  WorkerArtifactUploadPort,
  WorkerAttemptHeartbeatPort,
  WorkerAttemptAuthority,
  WorkerPlaneAuthority,
  WorkerReportPort,
} from "../../interpreter/workerPlane.ts";

export const workerPlaneRoutes = [
  "/health/live",
  "/health/ready",
  "/v1/input",
  "/v1/heartbeat",
  "/v1/artifacts/*",
  "/v1/report",
  "/v1/run/configuration",
  "/v1/run/transcript/*",
  "/v1/run/turns",
  "/v1/run/totals",
  "/v1/run/ended",
  "/v1/session",
  "/v1/session/heartbeat",
  "/v1/session/reference",
  "/v1/session/turn",
  "/v1/session/turn/answer",
  "/v1/session/turn/failure",
  "/v1/session/held",
  "/v1/session/store",
  "/v1/session/store/*",
] as const;

/** What marks a route as one only a composed session plane answers. */
const sessionRoutePrefix = "/v1/session";

/** Where a store route's own segments begin, which is what the raw url is cut at. */
const sessionStorePrefix = "/v1/session/store/";

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
  readonly ready: () => Promise<boolean>;
  readonly uploadBytesMax: number;
}

/** Which of this plane's routes a service composed like this one serves. */
export function workerPlaneServed(
  service: WorkerPlaneServerService,
): readonly string[] {
  return service.sessions === undefined
    ? workerPlaneRoutes.filter((route) => !route.startsWith(sessionRoutePrefix))
    : workerPlaneRoutes;
}

/** One turn as a worker offers it; the server is what dates the stored row. */
const workerRunTurnsSchema = z.strictObject({
  turns: z
    .array(
      z.strictObject({
        ordinal: z.number().int().positive().max(runTurnSeriesMax),
        model: z.string().min(1).max(runModelCharsMax),
        tokensInput: countSchema,
        tokensOutput: countSchema,
        tokensCacheCreation: countSchema,
        tokensCacheRead: countSchema,
      }),
    )
    .min(1)
    .max(nativeHttpPageItemsMax),
});

/**
 * The same figures as a worker offers them. A response schema drops a field the
 * wire does not name, so an older browser survives a newer server; a write
 * refuses one instead, because a field the plane dropped in silence is a figure
 * the worker believes it put on record.
 */
const workerRunTotalsSchema = z.strictObject({
  ...runTotalsSchema.shape,
  models: z
    .array(z.strictObject(runModelUsageSchema.shape))
    .max(nativeHttpPageItemsMax),
});

const workerRunEndedSchema = z.strictObject({
  evidence: z.enum(runEndedEvidences),
});

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
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  app.post(workerPlaneRoutes[3], async (request, reply) => {
    const secret = workerBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
    const authority = await workerAuthority(service, request);
    if (authority === undefined || !authority.live)
      return reply.code(401).send({ action: "stop" });
    return (await service.heartbeats.heartbeat(
      secret,
      authority.generation,
      service.heartbeatLeaseSecs,
    ))
      ? reply.code(204).send()
      : reply.code(409).send({ action: "stop" });
  });
}

function workerHealthRoutes(
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  app.get(workerPlaneRoutes[0], () => ({ status: "live" }));
  app.get(workerPlaneRoutes[1], async (_request, reply) =>
    (await service.ready())
      ? { status: "ready" }
      : reply.code(503).send({ status: "unready" }),
  );
}

async function workerAuthority(
  service: WorkerPlaneServerService,
  request: FastifyRequest,
): Promise<WorkerAttemptAuthority | undefined> {
  const secret = workerBearer(request);
  return secret === undefined
    ? undefined
    : service.authority.authenticate(secret);
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

function workerInputRoute(
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  app.get(workerPlaneRoutes[2], async (request, reply) => {
    const authority = await workerAuthority(service, request);
    if (authority === undefined || !authority.live)
      return reply.code(401).send({ action: "stop" });
    return {
      bundle: authority.inputBundle,
      digest: authority.inputBundleDigest,
      references: authority.inputs,
    };
  });
}

function workerUploadRoute(
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  app.put(workerPlaneRoutes[4], async (request, reply) => {
    const authority = await workerAuthority(service, request);
    if (authority === undefined || !authority.live)
      return reply.code(401).send({ action: "stop" });
    const path = (request.params as { "*": string })["*"];
    if (!(request.body instanceof Uint8Array))
      return reply.code(415).send({ action: "stop" });
    if (artifactPathRejection(path) !== undefined)
      return reply.code(400).send({ action: "stop", reason: "InvalidPath" });
    const secret = workerBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
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

/** The live attempt one run-evidence write is keyed by, or nothing at all. */
async function workerRunWriter(
  service: WorkerPlaneServerService,
  request: FastifyRequest,
): Promise<
  | {
      readonly authority: WorkerAttemptAuthority;
      readonly secret: AttemptCapabilitySecret;
    }
  | undefined
> {
  const authority = await workerAuthority(service, request);
  const secret = workerBearer(request);
  return authority === undefined || !authority.live || secret === undefined
    ? undefined
    : { authority, secret };
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
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  app.put(workerPlaneRoutes[6], async (request, reply) => {
    const writer = await workerRunWriter(service, request);
    if (writer === undefined) return reply.code(401).send({ action: "stop" });
    if (!(request.body instanceof Uint8Array))
      return reply.code(415).send({ action: "stop" });
    if (request.body.byteLength > runConfigurationBytesMax)
      return reply.code(413).send({ action: "stop", reason: "QuotaExceeded" });
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
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  app.put(workerPlaneRoutes[7], async (request, reply) => {
    const writer = await workerRunWriter(service, request);
    if (writer === undefined) return reply.code(401).send({ action: "stop" });
    if (!(request.body instanceof Uint8Array))
      return reply.code(415).send({ action: "stop" });
    const named = (request.params as { "*": string })["*"];
    const batch = /^[1-9][0-9]*$/u.test(named) ? Number(named) : 0;
    if (batch < 1 || batch > runTranscriptBatchesMax)
      return reply.code(400).send({ action: "stop", reason: "InvalidBatch" });
    if (request.body.byteLength > runTranscriptBatchBytesMax)
      return reply.code(413).send({ action: "stop", reason: "QuotaExceeded" });
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
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  app.post(workerPlaneRoutes[8], async (request, reply) => {
    const writer = await workerRunWriter(service, request);
    if (writer === undefined) return reply.code(401).send({ action: "stop" });
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
  app.post(workerPlaneRoutes[9], async (request, reply) => {
    const writer = await workerRunWriter(service, request);
    if (writer === undefined) return reply.code(401).send({ action: "stop" });
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
  app.post(workerPlaneRoutes[10], async (request, reply) => {
    const writer = await workerRunWriter(service, request);
    if (writer === undefined) return reply.code(401).send({ action: "stop" });
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
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  app.post(workerPlaneRoutes[5], async (request, reply) => {
    const secret = workerBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
    const authority = await workerAuthority(service, request);
    if (authority === undefined)
      return reply.code(401).send({ action: "stop" });
    if (
      typeof request.body !== "string" ||
      request.body.length > resultManifestTextCharsMax
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
): Promise<
  | {
      readonly identity: SessionPlaneIdentity;
      readonly secret: SessionBearerSecret;
    }
  | undefined
> {
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

/**
 * One opaque identity a session body carries, refused here rather than by the
 * brand it is about to become. `asBoundedText`'s rule is wider than a length:
 * a NUL and an unpaired surrogate are values no stored row holds, and a brand
 * raising on one inside a handler is a five-hundred with an internal message in
 * it where the route's own status map names four-hundred.
 */
const sessionIdentitySchema = z
  .string()
  .refine((value) => isBoundedText(value, sessionIdentityCharsMax));

const sessionReferenceSchema = z.strictObject({
  reference: sessionIdentitySchema,
});

/**
 * What the pod measured of one turn: one measurement rather than five figures,
 * so a body carrying four of them is refused here rather than written as a
 * measurement with a hole in it. Every text is one a stored row holds, because
 * a model or a tool the plane took and PostgreSQL then refused would be a
 * five-hundred where the route's own map names four-hundred.
 */
const sessionTurnMeasuredSchema = z.strictObject({
  model: z.string().refine((value) => isBoundedText(value, runModelCharsMax)),
  tokens: countSchema,
  costMicros: countSchema,
  durationMs: countSchema,
  tools: z
    .array(
      z
        .string()
        .refine((value) => isBoundedText(value, sessionTurnToolNameCharsMax)),
    )
    .max(sessionTurnToolsMax),
});

/**
 * One answered turn as a pod offers it. A batch range is both of its ends or
 * neither, because the row it is written into says so and a half range is a
 * refusal a caller should read here rather than out of a failed cast, and the
 * measurement is optional for two reasons that are both real: a thread's turn
 * is answered by this same route and has no policy control over it, and a
 * runtime that reported no usage must still be able to answer rather than be
 * stuck.
 */
const sessionTurnAnswerSchema = z
  .strictObject({
    turn: sessionIdentitySchema,
    result: z.string().max(sessionTurnResultCharsMax),
    measured: sessionTurnMeasuredSchema.optional(),
    batchFirst: z
      .number()
      .int()
      .positive()
      .max(sessionStoreBatchesMax)
      .optional(),
    batchLast: z
      .number()
      .int()
      .positive()
      .max(sessionStoreBatchesMax)
      .optional(),
  })
  .refine(
    (offered) =>
      (offered.batchFirst === undefined) ===
        (offered.batchLast === undefined) &&
      (offered.batchFirst ?? 0) <= (offered.batchLast ?? 0),
  );

const sessionTurnFailureSchema = z.strictObject({
  turn: sessionIdentitySchema,
  failure: z.enum(allAgentReportedTurnFailures),
});

/** What a refused settlement answers with, a conflict and a fence read alike by the pod. */
function sessionSettled(
  reply: FastifyReply,
  settled: SessionReferenceBound | SessionTurnAnswered | SessionTurnFailed,
): FastifyReply {
  return settled === "Conflict" || settled === "Fenced"
    ? reply.code(409).send({ action: "stop", reason: settled })
    : reply.code(204).send();
}

function sessionFactsRoute(
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  app.get(workerPlaneRoutes[11], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
    const identity = caller.identity;
    return {
      tenant: identity.partition.tenant,
      project: identity.partition.project,
      session: identity.session,
      kind: identity.kind,
      capabilities: identity.capabilities,
      credentialSlot: identity.credentialSlot,
      ...(identity.agentReference === undefined
        ? {}
        : { agentReference: identity.agentReference }),
    };
  });
}

function sessionHeartbeatRoute(
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  app.post(workerPlaneRoutes[12], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
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
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  app.put(workerPlaneRoutes[13], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
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
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  const polls = Math.max(
    1,
    Math.ceil((sessions.turnPollSecsMax * 1_000) / sessions.turnPollIntervalMs),
  );
  let waiting = 0;
  app.get(workerPlaneRoutes[14], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
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
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  app.post(workerPlaneRoutes[15], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
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
  app.post(workerPlaneRoutes[16], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
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
  app.post(workerPlaneRoutes[17], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
    const held = await sessions.holds.hold(
      caller.secret,
      caller.identity.generation,
    );
    return held
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
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  app.put(workerPlaneRoutes[19], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
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
    if (request.body.byteLength > sessionStoreBatchBytesMax)
      return reply.code(413).send({ action: "stop", reason: "QuotaExceeded" });
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
 * One page of a stream read back. Only an outage refuses the page: a batch
 * whose object is gone or is not one this store can speak for is marked
 * missing, because a reader of either has the same nothing and the same one
 * thing to do about it, and the batches beside it are what the caller came for.
 */
function sessionStoreReadRoute(
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  app.get(workerPlaneRoutes[19], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
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
        session: caller.identity.session,
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
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  app.get(workerPlaneRoutes[18], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
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
  const app = fastify({ logger: false, bodyLimit: service.uploadBytesMax });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    },
  );
  workerHealthRoutes(app, service);
  workerInputRoute(app, service);
  workerHeartbeatRoute(app, service);
  workerUploadRoute(app, service);
  workerReportRoute(app, service);
  workerRunConfigurationRoute(app, service);
  workerRunTranscriptRoute(app, service);
  workerRunFigureRoutes(app, service);
  const sessions = service.sessions;
  if (sessions !== undefined) {
    sessionBoundsChecked(sessions);
    sessionFactsRoute(app, sessions);
    sessionHeartbeatRoute(app, sessions);
    sessionReferenceRoute(app, sessions);
    sessionTurnRoute(app, sessions);
    sessionSettleRoutes(app, sessions);
    sessionStoreWriteRoute(app, sessions);
    sessionStoreReadRoute(app, sessions);
    sessionStoreStreamsRoute(app, sessions);
  }
  return app;
}
