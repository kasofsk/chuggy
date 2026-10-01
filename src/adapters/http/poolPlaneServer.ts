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
 * caller no registration names or the authority refuses is 404 on a contract
 * route, an issuer or authority that could not answer is 503 and asks for a
 * retry, and only the last of those is a pool that should come back unchanged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  assignmentOutcomeSchema,
  workerPoolAssignmentIdentitySchema,
  workerPoolEvidenceCharsMax,
  workerPoolPollQuery,
  workerPoolPollQuerySchema,
  workerPoolPollRoute,
  workerPoolSettlementRoutes,
  type AssignmentOutcome,
} from "../../contract/workerPool.ts";
import { ProjectAccessUnavailable } from "../../interpreter/projectAccess.ts";
import type { ProjectAccess } from "../../interpreter/projectAccess.ts";
import {
  workerPoolImagePullAllowed,
  workerPoolImagePullRequested,
} from "../../interpreter/workerPoolImagePull.ts";
import {
  workerPoolAdmitted,
  workerPoolContractAccepted,
  workerPoolPoll,
  workerPoolReconciliationUnsessioned,
  workerPoolSessionsRead,
  type WorkerPoolAssignments,
  type WorkerPoolIdentity,
  type WorkerPoolMint,
  type WorkerPoolPollSettings,
  type WorkerPoolRegistry,
} from "../../interpreter/workerPool.ts";
import {
  planeApp,
  planeJsonObjectBytesMax,
  planeRouteServed,
  type PlaneRoute,
} from "./planeRoutes.ts";
import type { PrincipalAuthentication } from "./server.ts";
import {
  workerContractChecked,
  workerContractNamed,
  workerContractOffered,
} from "./workerContractVersion.ts";

/** A contract route's refusal of a release outside the range the pool plane serves. */
const poolPlaneContractChecked = workerContractChecked(
  workerPoolContractAccepted,
);

/** The most a settlement is sent: a refusal's evidence at its bound, and nothing else. */
export const poolPlaneSettlementBytesMax = planeJsonObjectBytesMax(
  workerPoolEvidenceCharsMax,
);

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

/** The pool whose token `token` is, or which of the three refusals it met. */
async function poolCaller(
  service: PoolPlaneService,
  token: string | undefined,
): Promise<PoolCaller> {
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

/** Serves `handler` at one route for the pool its bearer names, every other caller refused before any of its body is read. */
function poolPlaneRoute(
  app: FastifyInstance,
  service: PoolPlaneService,
  route: Omit<PlaneRoute, "released">,
  handler: (
    request: FastifyRequest,
    reply: FastifyReply,
    identity: WorkerPoolIdentity,
  ) => Promise<unknown>,
): void {
  planeRouteServed(
    app,
    { ...route, released: poolPlaneContractChecked },
    async (request, reply) => {
      const caller = await poolCaller(service, poolBearer(request));
      if (caller.caller === "Pool") return caller.identity;
      void poolRefused(reply, caller.caller);
      return undefined;
    },
    handler,
  );
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

/** The reconciliation poll, which is the whole of what a pool asks for, answered in the shape the release the pool names reads. */
function poolAssignmentsRoute(
  app: FastifyInstance,
  service: PoolPlaneService,
): void {
  poolPlaneRoute(
    app,
    service,
    {
      method: "GET",
      url: workerPoolPollRoute,
      bodyBytesMax: planeJsonObjectBytesMax(),
    },
    async (request, reply, identity) => {
      const query = workerPoolPollQuerySchema(
        service.settings.heldMax,
      ).safeParse(request.query);
      if (!query.success) return reply.code(400).send();
      const sessionsRead = workerPoolSessionsRead(
        workerContractOffered(request),
      );
      const answered = await workerPoolPoll(
        service.assignments,
        identity,
        {
          held: query.data[workerPoolPollQuery.held],
          wanted: query.data[workerPoolPollQuery.wanted],
          wantedSessions: sessionsRead
            ? query.data[workerPoolPollQuery.wantedSessions]
            : 0,
        },
        service.settings,
        service.mint,
      );
      return reply
        .code(200)
        .send(
          sessionsRead
            ? answered
            : workerPoolReconciliationUnsessioned(answered),
        );
    },
  );
}

/**
 * The three settlements a pool can report, each one the path rather than the
 * body: an accepted assignment is already leased and needs no write, a refusal
 * is evidence the orchestrator turns into the attempt's terminal, and an
 * unavailable releases the assignment, which concludes its execution as a
 * failed process.
 */
function poolOutcomeRoutes(
  app: FastifyInstance,
  service: PoolPlaneService,
): void {
  for (const outcome of ["Accepted", "Refused", "Unavailable"] as const)
    poolPlaneRoute(
      app,
      service,
      {
        method: "POST",
        url: workerPoolSettlementRoutes[outcome],
        bodyBytesMax: poolPlaneSettlementBytesMax,
      },
      async (request, reply, identity) =>
        poolOutcomeAnswered(service, request, reply, identity, outcome),
    );
}

async function poolOutcomeAnswered(
  service: PoolPlaneService,
  request: FastifyRequest,
  reply: FastifyReply,
  identity: WorkerPoolIdentity,
  outcome: AssignmentOutcome["outcome"],
): Promise<unknown> {
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
    identity,
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
      return service.assignments.release(identity, assignment);
  }
}

/** Where the image registry's front asks whether one request may pass, outside `/v1` so the pool plane's public address never serves it. */
const poolPullAuthorizeRoute = "/registry/authorize";

/** The challenge that makes a registry client send its credential at all. */
const poolPullChallenge = 'Basic realm="chuggy-registry"';

const poolPullBase64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** The password a Basic credential carries, which is the pool's own token, whatever user it names. */
function poolPullPassword(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith("Basic ") !== true) return undefined;
  const encoded = header.slice("Basic ".length);
  if (!poolPullBase64.test(encoded)) return undefined;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon === -1 ? undefined : decoded.slice(colon + 1);
}

function poolPullForwarded(
  request: FastifyRequest,
  name: "x-forwarded-method" | "x-forwarded-uri",
): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

/** The status the front is answered with, which is the whole of what it passes on. */
type PoolPullAnswer = 200 | 401 | 403 | 503;

/** A caller no registration names is 403 here, because a registry client reports that as denied where a 404 reads as an image that is not there. */
const poolPullRefused = {
  InvalidToken: 401,
  Unknown: 403,
  Unavailable: 503,
} as const satisfies Record<
  Exclude<PoolCaller["caller"], "Pool">,
  PoolPullAnswer
>;

async function poolPullAnswered(
  service: PoolPlaneService,
  request: FastifyRequest,
): Promise<PoolPullAnswer> {
  const caller = await poolCaller(service, poolPullPassword(request));
  if (caller.caller !== "Pool") return poolPullRefused[caller.caller];
  const pull = workerPoolImagePullRequested(
    poolPullForwarded(request, "x-forwarded-method"),
    poolPullForwarded(request, "x-forwarded-uri"),
  );
  if (pull === undefined) return 403;
  const held = await service.assignments.heldImages(
    caller.identity,
    service.settings.heldMax,
  );
  return workerPoolImagePullAllowed(pull, held, service.settings.imageHosts)
    ? 200
    : 403;
}

/**
 * The image registry front's question, which names no release and, being a
 * GET, has no body read. A store that could not answer is an outage like the
 * issuer's or the authority's, and the front is told to have the client retry.
 */
function poolPullRoute(app: FastifyInstance, service: PoolPlaneService): void {
  app.get(poolPullAuthorizeRoute, async (request, reply) => {
    const answer = await poolPullAnswered(service, request).catch(
      () => 503 as const,
    );
    if (answer === 401)
      void reply.header("www-authenticate", poolPullChallenge);
    return reply.code(answer).send();
  });
}

export function createPoolPlaneApp(service: PoolPlaneService): FastifyInstance {
  const app = planeApp();
  workerContractNamed(app);
  poolHealthRoutes(app, service);
  poolAssignmentsRoute(app, service);
  poolOutcomeRoutes(app, service);
  poolPullRoute(app, service);
  return app;
}
