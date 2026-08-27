import { createHash } from "node:crypto";
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
} from "../../contract/http.ts";
import {
  runModelUsageSchema,
  runTotalsSchema,
} from "../../contract/responses.ts";
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
] as const;

/** The ports a run's own evidence is written through, all five attempt-fenced. */
export interface WorkerRunEvidencePorts {
  readonly configurations: WorkerRunConfigurationPort;
  readonly transcripts: WorkerRunTranscriptPort;
  readonly turns: WorkerRunTurnsPort;
  readonly totals: WorkerRunTotalPort;
  readonly endings: WorkerRunEndedPort;
}

export interface WorkerPlaneServerService {
  readonly authority: WorkerPlaneAuthority;
  readonly heartbeats: WorkerAttemptHeartbeatPort;
  readonly heartbeatLeaseSecs: number;
  readonly artifacts: WorkerArtifactUploadPort;
  readonly reservations: WorkerArtifactReservationPort;
  readonly reports: WorkerReportPort;
  readonly runEvidence: WorkerRunEvidencePorts;
  readonly ready: () => Promise<boolean>;
  readonly uploadBytesMax: number;
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
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length);
  if (token.length === 0 || token.length > 256) return undefined;
  return service.authority.authenticate(asAttemptCapabilitySecret(token));
}

function workerBearer(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length);
  return token.length > 0 && token.length <= 256
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

/** What one refused write answers with, decided before any of it is sent. */
interface WorkerRunRefusal {
  readonly status: number;
  readonly body: Readonly<Record<string, string>>;
  readonly retryAfterSeconds?: number;
}

/** The refusal storing one object earned, or nothing where its bytes are kept. */
function workerRunObjectRefusal(
  kept: WorkerArtifactStored,
): WorkerRunRefusal | undefined {
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
): Promise<WorkerRunRefusal | undefined> {
  return workerRunObjectRefusal(
    await service.artifacts.store({ authority, path, content }),
  );
}

function workerRunRefused(
  reply: FastifyReply,
  refusal: WorkerRunRefusal,
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
    if (refusal !== undefined) return workerRunRefused(reply, refusal);
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
    if (refusal !== undefined) return workerRunRefused(reply, refusal);
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
  return app;
}
