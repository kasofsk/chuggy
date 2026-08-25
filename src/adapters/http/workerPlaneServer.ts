import { createHash } from "node:crypto";
import fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { asAttemptCapabilitySecret } from "../../interpreter/executionScheduler.ts";
import {
  artifactPathRejection,
  resultManifestTextCharsMax,
} from "../../interpreter/resultManifest.ts";
import type {
  WorkerArtifactReservationPort,
  WorkerArtifactUploadPort,
  WorkerAttemptAuthority,
  WorkerPlaneAuthority,
  WorkerReportPort,
} from "../../interpreter/workerPlane.ts";

export const workerPlaneRoutes = [
  "/health/live",
  "/health/ready",
  "/v1/input",
  "/v1/artifacts/*",
  "/v1/report",
] as const;

export interface WorkerPlaneServerService {
  readonly authority: WorkerPlaneAuthority;
  readonly artifacts: WorkerArtifactUploadPort;
  readonly reservations: WorkerArtifactReservationPort;
  readonly reports: WorkerReportPort;
  readonly ready: () => Promise<boolean>;
  readonly uploadBytesMax: number;
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
  app.put(workerPlaneRoutes[3], async (request, reply) => {
    const authority = await workerAuthority(service, request);
    if (authority === undefined || !authority.live)
      return reply.code(401).send({ action: "stop" });
    const path = (request.params as { "*": string })["*"];
    if (!(request.body instanceof Uint8Array))
      return reply.code(415).send({ action: "stop" });
    if (artifactPathRejection(path) !== undefined)
      return reply
        .code(400)
        .send({ action: "stop", reason: "InvalidPath" });
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

function workerReportRoute(
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  app.post(workerPlaneRoutes[4], async (request, reply) => {
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
      case "Malformed":
      case "Unconfirmed":
        return reply.code(409).send({ action: "stop" });
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
  workerUploadRoute(app, service);
  workerReportRoute(app, service);
  return app;
}
