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
 * answers which of them must stop, claims what the pool's capabilities cover
 * up to the room it said it has, and by being made at all says the pool is
 * alive. Nothing here is a heartbeat and nothing here is a placement.
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
  workerPoolAssignmentIdentitySchema,
  workerPoolPollQuery,
  workerPoolPollQuerySchema,
  workerPoolPollRoute,
  workerPoolSettlementRoutes,
  type AssignmentOutcome,
} from "../../contract/workerPool.ts";
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
import {
  workerContractChecked,
  workerContractNamed,
} from "./workerContractVersion.ts";

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

/**
 * The one answer each refusal is given, so no route spells a status of its
 * own. The status is the whole answer: a pool reads nothing else from it.
 */
function poolRefused(
  reply: FastifyReply,
  caller: Exclude<PoolCaller["caller"], "Pool">,
): FastifyReply {
  switch (caller) {
    case "InvalidToken":
      return reply.code(401).send();
    case "Unknown":
      return reply.code(404).send();
    case "Unavailable":
      return reply.code(503).send();
  }
}

/** The assignment a settlement's path names, held to the same bound as everywhere else on the wire. */
function poolAssignmentNamed(request: FastifyRequest): string | undefined {
  const named = workerPoolAssignmentIdentitySchema.safeParse(
    (request.params as Record<string, unknown>)["assignment"],
  );
  return named.success ? named.data : undefined;
}

function poolHealthRoutes(
  app: FastifyInstance,
  service: PoolPlaneService,
): void {
  app.get("/health/live", () => ({ status: "live" }));
  app.get("/health/ready", async (_request, reply) =>
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
  app.get(
    workerPoolPollRoute,
    { onRequest: workerContractChecked },
    async (request, reply) => {
      const caller = await poolCaller(service, request);
      if (caller.caller !== "Pool") return poolRefused(reply, caller.caller);
      const query = workerPoolPollQuerySchema(
        service.settings.heldMax,
      ).safeParse(request.query);
      if (!query.success) return reply.code(400).send();
      const answered = await workerPoolPoll(
        service.assignments,
        caller.identity,
        query.data[workerPoolPollQuery.held],
        query.data[workerPoolPollQuery.wanted],
        service.settings,
        service.mint,
      );
      return reply.code(200).send(answered);
    },
  );
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
  for (const outcome of ["Accepted", "Refused", "Unavailable"] as const)
    app.post(
      workerPoolSettlementRoutes[outcome],
      { onRequest: workerContractChecked },
      async (request, reply) =>
        poolOutcomeAnswered(service, request, reply, outcome),
    );
}

async function poolOutcomeAnswered(
  service: PoolPlaneService,
  request: FastifyRequest,
  reply: FastifyReply,
  outcome: AssignmentOutcome["outcome"],
): Promise<unknown> {
  const caller = await poolCaller(service, request);
  if (caller.caller !== "Pool") return poolRefused(reply, caller.caller);
  const assignment = poolAssignmentNamed(request);
  if (assignment === undefined) return reply.code(400).send();
  const body =
    request.body === undefined || request.body === null ? {} : request.body;
  const offered = assignmentOutcomeSchema.safeParse({
    outcome,
    ...(body as Record<string, unknown>),
  });
  if (!offered.success) return reply.code(400).send();
  const settled = await poolOutcomeSettled(
    service,
    caller.identity,
    assignment,
    offered.data,
  );
  return settled ? reply.code(204).send() : reply.code(409).send();
}

async function poolOutcomeSettled(
  service: PoolPlaneService,
  identity: WorkerPoolIdentity,
  assignment: string,
  offered: AssignmentOutcome,
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
  workerContractNamed(app);
  poolHealthRoutes(app, service);
  poolAssignmentsRoute(app, service);
  poolOutcomeRoutes(app, service);
  return app;
}
