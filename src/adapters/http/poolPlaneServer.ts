/**
 * The plane a worker pool polls, and the only door a machine this tree never
 * saw is given.
 *
 * IT IS NOT THE PLANE THE HARNESS REACHES. That one authenticates an attempt
 * bearer and holds `UPDATE(worker_outcome)` and nothing else; this one claims
 * work, renews leases and releases what a pool would not take, and holds no
 * privilege on an outcome at all. Serving pools from the pod-facing plane would
 * have widened the process a workload can talk to into one that claims, which
 * is the direction this tree keeps narrowing.
 *
 * FOUR JOBS THROUGH ONE CALL. A poll renews every lease the pool says it holds,
 * answers which of them must stop, claims what the pool's capabilities cover,
 * and by being made at all says the pool is alive. Nothing here is a heartbeat
 * and nothing here is a placement.
 */
import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import {
  assignmentOutcomeSchema,
  workerPoolIdentityCharsMax,
} from "../../contract/workerPool.ts";
import { isBoundedText } from "../../interpreter/boundedText.ts";
import {
  workerPoolPoll,
  type WorkerPoolAssignments,
  type WorkerPoolIdentity,
  type WorkerPoolMint,
  type WorkerPoolPollSettings,
  type WorkerPoolRegistry,
} from "../../interpreter/workerPool.ts";

export const poolPlaneRoutes = [
  "/health/live",
  "/health/ready",
  "/v1/assignments",
  "/v1/assignments/:assignment/accepted",
  "/v1/assignments/:assignment/refused",
  "/v1/assignments/:assignment/unavailable",
] as const;

export interface PoolPlaneService {
  readonly registry: WorkerPoolRegistry;
  readonly assignments: WorkerPoolAssignments;
  readonly settings: WorkerPoolPollSettings;
  readonly mint: WorkerPoolMint;
  readonly ready: () => Promise<boolean>;
}

function poolBearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") && header.length > "Bearer ".length
    ? header.slice("Bearer ".length)
    : undefined;
}

/** The pool one call acts for, or nothing where its credential names no registration. */
async function poolCaller(
  service: PoolPlaneService,
  request: FastifyRequest,
): Promise<WorkerPoolIdentity | undefined> {
  const secret = poolBearer(request);
  return secret === undefined
    ? undefined
    : service.registry.authenticate(secret);
}

/**
 * What the pool says it holds, read off a repeated query parameter. A list
 * longer than the bound is refused rather than cut, because a cut list reads as
 * a pool that let go of work it is still running.
 */
function poolHeld(
  request: FastifyRequest,
  heldMax: number,
): readonly string[] | undefined {
  const asked = (request.query as Record<string, unknown>)["held"];
  const held =
    asked === undefined
      ? []
      : Array.isArray(asked)
        ? (asked as unknown[])
        : [asked];
  if (held.length > heldMax) return undefined;
  return held.every(
    (value) =>
      typeof value === "string" &&
      isBoundedText(value, workerPoolIdentityCharsMax),
  )
    ? (held as string[])
    : undefined;
}

function poolAssignmentNamed(request: FastifyRequest): string | undefined {
  const named = (request.params as Record<string, unknown>)["assignment"];
  return typeof named === "string" &&
    isBoundedText(named, workerPoolIdentityCharsMax)
    ? named
    : undefined;
}

function poolHealthRoutes(
  app: FastifyInstance,
  service: PoolPlaneService,
): void {
  app.get(poolPlaneRoutes[0], () => ({ status: "live" }));
  app.get(poolPlaneRoutes[1], async (_request, reply) =>
    (await service.ready())
      ? { status: "ready" }
      : reply.code(503).send({ status: "unready" }),
  );
}

/** The reconciliation poll, which is the whole of what a pool asks for. */
function poolAssignmentsRoute(
  app: FastifyInstance,
  service: PoolPlaneService,
): void {
  app.get(poolPlaneRoutes[2], async (request, reply) => {
    const identity = await poolCaller(service, request);
    if (identity === undefined) return reply.code(401).send({ action: "stop" });
    const held = poolHeld(request, service.settings.heldMax);
    if (held === undefined)
      return reply.code(400).send({ action: "stop", reason: "InvalidHeld" });
    const answered = await workerPoolPoll(
      service.assignments,
      identity,
      held,
      service.settings,
      service.mint,
    );
    return reply.code(200).send(answered);
  });
}

/**
 * The three settlements a pool can report, each one the path rather than the
 * body: an accepted assignment is already leased and needs no write, a refusal
 * is evidence the orchestrator turns into the attempt's terminal, and an
 * unavailable is the pool's own backpressure and returns the work to the queue.
 */
function poolOutcomeRoutes(
  app: FastifyInstance,
  service: PoolPlaneService,
): void {
  app.post(poolPlaneRoutes[3], async (request, reply) =>
    poolOutcomeAnswered(service, request, reply, "Accepted"),
  );
  app.post(poolPlaneRoutes[4], async (request, reply) =>
    poolOutcomeAnswered(service, request, reply, "Refused"),
  );
  app.post(poolPlaneRoutes[5], async (request, reply) =>
    poolOutcomeAnswered(service, request, reply, "Unavailable"),
  );
}

async function poolOutcomeAnswered(
  service: PoolPlaneService,
  request: FastifyRequest,
  reply: FastifyReply,
  outcome: "Accepted" | "Refused" | "Unavailable",
): Promise<unknown> {
  const identity = await poolCaller(service, request);
  if (identity === undefined) return reply.code(401).send({ action: "stop" });
  const assignment = poolAssignmentNamed(request);
  if (assignment === undefined)
    return reply
      .code(400)
      .send({ action: "stop", reason: "InvalidAssignment" });
  const body =
    request.body === undefined || request.body === null ? {} : request.body;
  const offered = assignmentOutcomeSchema.safeParse({
    outcome,
    ...(body as Record<string, unknown>),
  });
  if (!offered.success)
    return reply.code(400).send({ action: "stop", reason: "InvalidOutcome" });
  const settled = await poolOutcomeSettled(
    service,
    identity,
    assignment,
    offered.data,
  );
  return settled
    ? reply.code(204).send()
    : reply.code(409).send({ action: "stop" });
}

async function poolOutcomeSettled(
  service: PoolPlaneService,
  identity: WorkerPoolIdentity,
  assignment: string,
  offered: ReturnType<typeof assignmentOutcomeSchema.parse>,
): Promise<boolean> {
  switch (offered.outcome) {
    case "Accepted":
      return service.assignments.held(identity, assignment);
    case "Refused":
      return service.assignments.refuse(identity, assignment, offered.evidence);
    case "Unavailable":
      return service.assignments.release(
        identity,
        assignment,
        offered.retryAfterSecs,
      );
  }
}

export function createPoolPlaneApp(service: PoolPlaneService): FastifyInstance {
  const app = fastify({ logger: false });
  poolHealthRoutes(app, service);
  poolAssignmentsRoute(app, service);
  poolOutcomeRoutes(app, service);
  return app;
}
