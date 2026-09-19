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
 *
 * IT VERIFIES AND IT NEVER MINTS. A pool arrives as an OAuth2 client of the
 * issuer this installation already runs, so what this process holds is the
 * issuer's published keys and a question for the authority — never the admin
 * privilege that made the client. Four answers come out of that pair and each
 * one says something different: a token this side read and rejected is 401, a
 * caller no registration names or the authority refuses is 404, an issuer or
 * authority that could not answer is 503 and asks for a retry, and only the
 * last of those is a pool that should come back unchanged.
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
import { ProjectAccessUnavailable } from "../../interpreter/projectAccess.ts";
import type { ProjectAccess } from "../../interpreter/projectAccess.ts";
import {
  workerPoolAdmitted,
  workerPoolPoll,
  type WorkerPoolAssignments,
  type WorkerPoolIdentity,
  type WorkerPoolMint,
  type WorkerPoolPollSettings,
  type WorkerPoolRegistry,
} from "../../interpreter/workerPool.ts";
import type { PrincipalAuthentication } from "./server.ts";

export const poolPlaneRoutes = [
  "/health/live",
  "/health/ready",
  "/v1/assignments",
  "/v1/assignments/:assignment/accepted",
  "/v1/assignments/:assignment/refused",
  "/v1/assignments/:assignment/unavailable",
] as const;

export interface PoolPlaneService {
  readonly authentication: PrincipalAuthentication;
  readonly access: ProjectAccess;
  readonly registry: WorkerPoolRegistry;
  readonly assignments: WorkerPoolAssignments;
  readonly settings: WorkerPoolPollSettings;
  readonly mint: WorkerPoolMint;
  readonly ready: () => Promise<boolean>;
}

/**
 * What resolving a caller came to. `Unknown` and `Unavailable` are kept apart
 * for the reason the authority keeps a refusal and an outage apart: one is a
 * pool that should stop, and the other is a pool that should ask again.
 */
type PoolCaller =
  | { readonly caller: "Pool"; readonly identity: WorkerPoolIdentity }
  | { readonly caller: "InvalidToken" }
  | { readonly caller: "Unknown" }
  | { readonly caller: "Unavailable" };

function poolBearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") && header.length > "Bearer ".length
    ? header.slice("Bearer ".length)
    : undefined;
}

/** The pool one call acts for, or which of the three refusals it met. */
async function poolCaller(
  service: PoolPlaneService,
  request: FastifyRequest,
): Promise<PoolCaller> {
  const token = poolBearer(request);
  if (token === undefined) return { caller: "InvalidToken" };
  const authenticated = await service.authentication.authenticateBearer(token);
  if (authenticated.authenticated === "InvalidToken")
    return { caller: "InvalidToken" };
  if (authenticated.authenticated === "AuthorityUnavailable")
    return { caller: "Unavailable" };
  let identity: WorkerPoolIdentity | undefined;
  try {
    identity = await workerPoolAdmitted(
      service.registry,
      service.access,
      authenticated.bearer.principal,
    );
  } catch (failure) {
    if (failure instanceof ProjectAccessUnavailable)
      return { caller: "Unavailable" };
    throw failure;
  }
  return identity === undefined
    ? { caller: "Unknown" }
    : { caller: "Pool", identity };
}

/** The one answer each refusal is given, so no route spells a status of its own. */
function poolRefused(
  reply: FastifyReply,
  caller: Exclude<PoolCaller["caller"], "Pool">,
): FastifyReply {
  switch (caller) {
    case "InvalidToken":
      return reply.code(401).send({ action: "stop" });
    case "Unknown":
      return reply.code(404).send({ action: "stop" });
    case "Unavailable":
      return reply.code(503).send({ action: "retry" });
  }
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
    const caller = await poolCaller(service, request);
    if (caller.caller !== "Pool") return poolRefused(reply, caller.caller);
    const held = poolHeld(request, service.settings.heldMax);
    if (held === undefined)
      return reply.code(400).send({ action: "stop", reason: "InvalidHeld" });
    const answered = await workerPoolPoll(
      service.assignments,
      caller.identity,
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
  const caller = await poolCaller(service, request);
  if (caller.caller !== "Pool") return poolRefused(reply, caller.caller);
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
    caller.identity,
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
