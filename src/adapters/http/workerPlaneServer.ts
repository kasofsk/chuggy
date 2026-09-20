import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";

import {
  countSchema,
  nativeHttpPageItemsMax,
  sessionStoreBatchBytesMax,
  sessionStoreBatchesMax,
  sessionStorePageBatchesMax,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
  ticketExecutionRunModelCharsMax,
  ticketExecutionRunModelsMax,
  ticketExecutionRunReasonCharsMax,
  ticketExecutionRunTurnsMax,
  ticketExecutionRunTurnsPageMax,
} from "../../contract/http.ts";
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
  asRepositoryId,
  finalizerIdentityCharsMax,
} from "../../interpreter/finalizer.ts";
import type { TicketExecutionCredentialSubject } from "../../interpreter/ticketExecution.ts";
import type {
  TicketExecutionRunEvidenceStored,
  TicketExecutionRunPort,
  TicketExecutionRunStored,
} from "../../interpreter/ticketExecutionRun.ts";
import type {
  WorkerPlaneCredentialMinted,
  WorkerPlaneCredentialMinting,
} from "../../interpreter/workerPlaneCredentials.ts";

export const workerPlaneRoutes = [
  "/health/live",
  "/health/ready",
  "/v1/session",
  "/v1/session/heartbeat",
  "/v1/session/reference",
  "/v1/session/turn",
  "/v1/session/turn/answer",
  "/v1/session/turn/failure",
  "/v1/session/held",
  "/v1/session/store",
  "/v1/session/store/*",
  "/v1/session/credential",
  "/v1/ticket-execution/terminal",
  "/v1/ticket-execution/view",
  "/v1/ticket-execution/credentials",
  "/v1/ticket-execution/heartbeat",
  "/v1/ticket-execution/run/turns",
  "/v1/ticket-execution/run/totals",
  "/v1/ticket-execution/run/transcript/:batch",
  "/v1/ticket-execution/run/configuration",
] as const;

const sessionStorePrefix = "/v1/session/store/";

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
  readonly turnPollIntervalMs: number;
  readonly turnPollSecsMax: number;
  readonly pollsMax: number;
}

export interface WorkerPlaneServerService {
  readonly sessions?: SessionPlaneService;
  readonly credentials?: WorkerPlaneCredentialMinting;
  readonly ready: () => Promise<boolean>;
  readonly ticketExecutions?: {
    report(
      secret: string,
      body: unknown,
    ): Promise<"Recorded" | "Conflict" | "Fenced">;
    heartbeat(secret: string): Promise<"Recorded" | "Fenced">;
    readonly run?: TicketExecutionRunPort;
    view(secret: string): Promise<unknown>;
    credential(
      secret: string,
    ): Promise<TicketExecutionCredentialSubject | undefined>;
  };
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

function rawBearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") && header.length > "Bearer ".length
    ? header.slice("Bearer ".length)
    : undefined;
}

/**
 * The envelope a terminal arrives in, which is checked at the door while what it
 * carries is not. An outcome this tree cannot read is a process failure the next
 * cycle is told about, so only a body with nowhere to put an outcome is refused
 * here.
 */
const ticketTerminalSchema = z
  .strictObject({ outcome: z.unknown() })
  .refine((offered) => offered.outcome !== undefined);

/**
 * What one attempt is and what it produced, both reached by the same attempt
 * bearer and by nothing else. Neither route names a pod, a namespace or a
 * launcher: a harness a worker pool started on a machine this tree has never
 * seen calls exactly these, which is the whole point of them being here.
 */
function ticketExecutionRoutes(
  app: FastifyInstance,
  service: WorkerPlaneServerService,
): void {
  const attempts = service.ticketExecutions;
  if (attempts === undefined) return;
  app.post(workerPlaneRoutes[12], async (request, reply) => {
    const secret = rawBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
    const offered = ticketTerminalSchema.safeParse(request.body);
    if (!offered.success)
      return reply
        .code(400)
        .send({ action: "stop", reason: "InvalidTerminal" });
    const reported = await attempts.report(secret, offered.data);
    return reported === "Recorded"
      ? reply.code(204).send()
      : reply.code(409).send({ action: "stop", reason: reported });
  });
  app.get(workerPlaneRoutes[13], async (request, reply) => {
    const secret = rawBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
    const view = await attempts.view(secret);
    return view === undefined
      ? reply.code(401).send({ action: "stop" })
      : reply.code(200).send(view);
  });
  ticketCredentialRoute(app, service, attempts);
  ticketHeartbeatRoute(app, attempts);
  ticketRunRoutes(app, attempts);
}

const ticketRunModelSchema = z
  .string()
  .refine((value) => isBoundedText(value, ticketExecutionRunModelCharsMax));

const ticketRunReasonSchema = z
  .string()
  .refine((value) => isBoundedText(value, ticketExecutionRunReasonCharsMax));

const ticketRunTokensSchema = {
  tokensInput: countSchema,
  tokensOutput: countSchema,
  tokensCacheCreation: countSchema,
  tokensCacheRead: countSchema,
};

const ticketRunTurnsSchema = z.strictObject({
  turns: z
    .array(
      z.strictObject({
        ordinal: z.number().int().positive().max(ticketExecutionRunTurnsMax),
        model: ticketRunModelSchema,
        ...ticketRunTokensSchema,
      }),
    )
    .max(ticketExecutionRunTurnsPageMax),
});

const ticketRunTotalsSchema = z.strictObject({
  turns: countSchema,
  durationMs: countSchema,
  durationApiMs: countSchema,
  ...ticketRunTokensSchema,
  costUsdMicros: countSchema,
  costBasis: z.literal("List"),
  permissionDenials: countSchema,
  models: z
    .array(
      z.strictObject({
        model: ticketRunModelSchema,
        ...ticketRunTokensSchema,
        costUsdMicros: countSchema,
      }),
    )
    .max(ticketExecutionRunModelsMax),
  resultSubtype: ticketRunReasonSchema.optional(),
  stopReason: ticketRunReasonSchema.optional(),
});

/** How stored evidence answers, each refusal separated because they are acted on differently. */
function ticketRunEvidenceStored(
  reply: FastifyReply,
  stored: TicketExecutionRunEvidenceStored,
): FastifyReply {
  if (stored === "Stored" || stored === "AlreadyStored")
    return reply.code(204).send();
  if (stored === "TooLarge")
    return reply.code(413).send({ action: "stop", reason: stored });
  if (stored === "Unavailable")
    return reply
      .code(503)
      .header("retry-after", "1")
      .send({ action: "stop", reason: stored });
  return reply.code(409).send({ action: "stop", reason: stored });
}

/**
 * The bytes a run left behind, measured here rather than believed. A harness
 * states a batch number and nothing else about what it sends: the digest, the
 * size and the event count are all read off what arrived.
 */
function ticketRunEvidenceRoutes(
  app: FastifyInstance,
  run: TicketExecutionRunPort,
): void {
  app.put(workerPlaneRoutes[18], async (request, reply) => {
    const secret = rawBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
    const batch = Number(
      (request.params as Record<string, string>)["batch"] ?? "",
    );
    if (!Number.isSafeInteger(batch))
      return reply.code(400).send({ action: "stop", reason: "InvalidBatch" });
    const content = ticketRunBody(request);
    if (content === undefined)
      return reply.code(400).send({ action: "stop", reason: "InvalidBody" });
    return ticketRunEvidenceStored(
      reply,
      await run.transcript(secret, batch, content),
    );
  });
  app.put(workerPlaneRoutes[19], async (request, reply) => {
    const secret = rawBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
    const content = ticketRunBody(request);
    if (content === undefined)
      return reply.code(400).send({ action: "stop", reason: "InvalidBody" });
    return ticketRunEvidenceStored(
      reply,
      await run.configuration(secret, content),
    );
  });
}

/** The bytes a harness uploaded, which only an octet-stream body carries. */
function ticketRunBody(request: FastifyRequest): Uint8Array | undefined {
  return Buffer.isBuffer(request.body)
    ? new Uint8Array(request.body)
    : undefined;
}

/** How a measure that was refused answers, a fence and a conflict read alike by the harness. */
function ticketRunStored(
  reply: FastifyReply,
  stored: TicketExecutionRunStored,
): FastifyReply {
  return stored === "Stored" || stored === "AlreadyStored"
    ? reply.code(204).send()
    : reply.code(409).send({ action: "stop", reason: stored });
}

/**
 * What one attempt's run spent, reported while it runs and settled by nothing.
 * A measure moves no lease and ends no attempt, so a plane composed without
 * somewhere to put one serves these routes not at all rather than accepting a
 * report it would drop.
 */
function ticketRunRoutes(
  app: FastifyInstance,
  attempts: NonNullable<WorkerPlaneServerService["ticketExecutions"]>,
): void {
  const run = attempts.run;
  if (run === undefined) return;
  app.post(workerPlaneRoutes[16], async (request, reply) => {
    const secret = rawBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
    const offered = ticketRunTurnsSchema.safeParse(request.body);
    if (!offered.success)
      return reply.code(400).send({ action: "stop", reason: "InvalidMeasure" });
    return ticketRunStored(reply, await run.turns(secret, offered.data.turns));
  });
  ticketRunEvidenceRoutes(app, run);
  app.post(workerPlaneRoutes[17], async (request, reply) => {
    const secret = rawBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
    const offered = ticketRunTotalsSchema.safeParse(request.body);
    if (!offered.success)
      return reply.code(400).send({ action: "stop", reason: "InvalidMeasure" });
    const { resultSubtype, stopReason, ...measured } = offered.data;
    return ticketRunStored(
      reply,
      await run.totals(secret, {
        ...measured,
        ...(resultSubtype === undefined ? {} : { resultSubtype }),
        ...(stopReason === undefined ? {} : { stopReason }),
      }),
    );
  });
}

/**
 * That the workload is still going, said by the workload and by nothing else.
 * A lease renewed by a pool's poll says its fabric still lists a pod, which a
 * wedged harness keeps true, so this is the one signal that separates a run
 * making progress from a run that stopped making any.
 */
function ticketHeartbeatRoute(
  app: FastifyInstance,
  attempts: NonNullable<WorkerPlaneServerService["ticketExecutions"]>,
): void {
  app.post(workerPlaneRoutes[15], async (request, reply) => {
    const secret = rawBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
    return (await attempts.heartbeat(secret)) === "Recorded"
      ? reply.code(204).send()
      : reply.code(409).send({ action: "stop", reason: "Fenced" });
  });
}

/**
 * The credential one attempt works under. It carries no body: the repository is
 * the one the attempt's own input bundle pinned and the permission set follows
 * from the kind of task the scheduler recorded, so there is nothing here for a
 * harness to name and nothing for it to widen.
 */
function ticketCredentialRoute(
  app: FastifyInstance,
  service: WorkerPlaneServerService,
  attempts: NonNullable<WorkerPlaneServerService["ticketExecutions"]>,
): void {
  app.post(workerPlaneRoutes[14], async (request, reply) => {
    const secret = rawBearer(request);
    if (secret === undefined) return reply.code(401).send({ action: "stop" });
    const subject = await attempts.credential(secret);
    if (subject === undefined) return reply.code(401).send({ action: "stop" });
    const credentials = service.credentials;
    return credentials === undefined
      ? reply.code(404).send(workerCredentialNotConfigured)
      : workerCredentialAnswered(
          reply,
          await credentials.attempt(
            subject.partition,
            subject.repository,
            subject.access,
          ),
        );
  });
}

export function workerPlaneServed(
  service: WorkerPlaneServerService,
): readonly string[] {
  return service.sessions === undefined
    ? workerPlaneRoutes.filter((route) => !route.startsWith("/v1/session"))
    : workerPlaneRoutes;
}

interface WorkerPlaneRefusal {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly retryAfterSeconds?: number;
}

function workerPlaneRefused(
  reply: FastifyReply,
  refusal: WorkerPlaneRefusal,
): FastifyReply {
  if (refusal.retryAfterSeconds !== undefined)
    void reply.header("retry-after", String(refusal.retryAfterSeconds));
  return reply.code(refusal.status).send(refusal.body);
}

function sessionStoreEvents(content: Uint8Array): number {
  let events = 0;
  for (const byte of content) if (byte === 0x0a) events += 1;
  return events;
}

/** How long a pod leaves a plane that could not reach the forge before asking again. */
const workerCredentialRetryAfterSeconds = 1;

/**
 * What a plane holding neither an app key nor a mounted source answers, which
 * is the pod's signal to fall back. A plane holding either composes a minting
 * and refuses a repository it cannot answer for with `NotMinted` instead.
 */
const workerCredentialNotConfigured = { reason: "ForgeNotConfigured" };

/** What a plane that mints answers for a repository it may not mint for. */
const workerCredentialNotMinted = { reason: "NotMinted" };

/** One repository as a session names it, refused here rather than by the brand. */
const sessionCredentialSchema = z.strictObject({
  repository: z
    .string()
    .refine((value) => isBoundedText(value, finalizerIdentityCharsMax)),
});

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
 * The credential one session reads its tree under. It names its repository,
 * because a site may have placed the session against a mirror of the binding
 * rather than the binding itself; the minting holds that name to the project's
 * own bindings, and a session is never minted more than a read.
 */
function sessionCredentialRoute(
  app: FastifyInstance,
  service: WorkerPlaneServerService,
  sessions: SessionPlaneService,
): void {
  app.post(workerPlaneRoutes[11], async (request, reply) => {
    const caller = await sessionCaller(sessions, request);
    if (caller === undefined) return reply.code(401).send({ action: "stop" });
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
  model: z
    .string()
    .refine((value) => isBoundedText(value, sessionTurnModelCharsMax)),
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
  app.get(workerPlaneRoutes[2], async (request, reply) => {
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
      ...(identity.systemPrompt === undefined
        ? {}
        : { systemPrompt: identity.systemPrompt }),
      ...(identity.forkFrom === undefined
        ? {}
        : { forkFrom: identity.forkFrom }),
    };
  });
}

function sessionHeartbeatRoute(
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  app.post(workerPlaneRoutes[3], async (request, reply) => {
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
  app.put(workerPlaneRoutes[4], async (request, reply) => {
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
  app.get(workerPlaneRoutes[5], async (request, reply) => {
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
  app.post(workerPlaneRoutes[6], async (request, reply) => {
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
  app.post(workerPlaneRoutes[7], async (request, reply) => {
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
  app.post(workerPlaneRoutes[8], async (request, reply) => {
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
  app.put(workerPlaneRoutes[10], async (request, reply) => {
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
      events: sessionStoreEvents(request.body),
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
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  app.get(workerPlaneRoutes[10], async (request, reply) => {
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
  app: FastifyInstance,
  sessions: SessionPlaneService,
): void {
  app.get(workerPlaneRoutes[9], async (request, reply) => {
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
  const app = fastify({ logger: false });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    },
  );
  workerHealthRoutes(app, service);
  ticketExecutionRoutes(app, service);
  const sessions = service.sessions;
  if (sessions !== undefined) {
    sessionBoundsChecked(sessions);
    sessionCredentialRoute(app, service, sessions);
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
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
