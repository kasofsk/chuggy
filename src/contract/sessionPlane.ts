/**
 * The session plane's wire: the routes a session pod and a runner holding one
 * call, the bodies they offer, every status each route's handler answers with,
 * how a session bearer is written, and what names a store stream.
 *
 * It reads as the job plane's does in `./workerPlane.ts`, whose refusal and
 * credential shapes it shares: an answer schema drops a field it does not name,
 * a request body refuses one, and what the framework answers before a handler
 * runs or after a port throws is in no map here.
 */

import { z } from "zod";

import {
  agentSessionPromptCharsMax,
  countSchema,
  identitySchema,
  isBoundedText,
  nativeHttpPageItemsMax,
  sessionCapabilitiesMax,
  sessionEfforts,
  sessionIdentityCharsMax,
  sessionLiveEventsMax,
  sessionModelSchema,
  sessionStoreBatchBytesMax,
  sessionStoreBatchesMax,
  sessionStorePageBatchesMax,
  sessionStoreStreamCharsMax,
  sessionTurnContextReadingsMax,
  sessionTurnInputCharsMax,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnSeriesMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "./http.ts";
import {
  workerPlaneAnswersRefusingVersions,
  type WorkerPlaneAnswers,
} from "./planeAnswers.ts";
import {
  sessionStoreStreamResponseSchema,
  sessionContextOfferedSchema,
} from "./responses.ts";
import {
  agentReportedTurnFailures,
  sessionCapabilities,
  sessionContainerEnds,
  sessionKinds,
  sessionTurnInputKinds,
} from "./rosters.ts";
import { sessionLiveEventSchema } from "./sessionLive.ts";
import {
  allThreadJobWakeReasons,
  threadTicketWakeSettings,
} from "./threadWake.ts";
import type { WorkerContractFeature } from "./workerContract.ts";
import {
  workerCredentialAbsentSchema,
  workerCredentialAnswerSchema,
  workerCredentialRepositorySchema,
  workerPlaneRefusalSchema,
  workerPlaneRetrySchema,
  workerPlaneStopSchema,
  type WorkerPlaneRoute,
} from "./workerPlane.ts";

/** The bounds a session pod's identities, turns, readings, live events and store are written against, the failures a turn may name, why it may read its context window, and the capabilities a session may hold. */
export {
  jsonTextBytes,
  repositoryIdentityCharsMax,
  sessionIdentityCharsMax,
  sessionLiveBlockCharsMax,
  sessionLiveBlocksMax,
  sessionLiveEventsMax,
  sessionLiveMessageCharsMax,
  sessionLiveTextBytesMax,
  sessionStoreBatchBytesMax,
  sessionStoreBatchesMax,
  sessionStorePageBatchesMax,
  sessionStoreStreamCharsMax,
  sessionTurnContextReadingsMax,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "./http.ts";
export {
  agentReportedTurnFailures,
  sessionCapabilities,
  sessionContainerEnds,
  sessionContextCauses,
} from "./rosters.ts";
export {
  allThreadJobWakeReasons,
  threadTicketWakeSettings,
  threadTicketWakesEffective,
} from "./threadWake.ts";
export {
  isSessionLiveText,
  sessionLiveBlockKinds,
  sessionLiveEventSchema,
} from "./sessionLive.ts";

/** The routes a session pod and the runner holding it call, which a plane composed without sessions does not serve. */
export const sessionPlaneRoutes = {
  facts: { method: "GET", path: "/v1/session" },
  heartbeat: { method: "POST", path: "/v1/session/heartbeat" },
  reference: { method: "PUT", path: "/v1/session/reference" },
  turn: { method: "GET", path: "/v1/session/turn" },
  turnAnswer: { method: "POST", path: "/v1/session/turn/answer" },
  turnFailure: { method: "POST", path: "/v1/session/turn/failure" },
  turnLive: { method: "POST", path: "/v1/session/turn/live" },
  turnStopped: { method: "POST", path: "/v1/session/turn/stopped" },
  held: { method: "POST", path: "/v1/session/held" },
  standing: { method: "PUT", path: "/v1/session/standing" },
  ticketWakes: { method: "PUT", path: "/v1/session/ticket-wakes" },
  wake: { method: "POST", path: "/v1/session/wake" },
  storeStreams: { method: "GET", path: "/v1/session/store" },
  storeBatch: { method: "PUT", path: "/v1/session/store/*" },
  storePage: { method: "GET", path: "/v1/session/store/*" },
  credential: { method: "POST", path: "/v1/session/credential" },
  ended: { method: "POST", path: "/v1/session/ended" },
} as const satisfies Readonly<Record<string, WorkerPlaneRoute>>;
export type SessionPlaneRouteName = keyof typeof sessionPlaneRoutes;

/**
 * The feature each session plane route belongs to, so a client is held only to
 * the routes of the features it lists.
 * A new route names the feature it belongs to, and `null` is for a route every
 * client of the plane must speak.
 */
export const sessionPlaneRouteFeatures: Readonly<
  Record<SessionPlaneRouteName, WorkerContractFeature | null>
> = {
  facts: null,
  heartbeat: null,
  reference: null,
  turn: null,
  turnAnswer: null,
  turnFailure: null,
  turnLive: null,
  turnStopped: null,
  held: null,
  standing: null,
  ticketWakes: "ThreadTicketWakes",
  wake: null,
  storeStreams: null,
  storeBatch: null,
  storePage: null,
  credential: null,
  ended: null,
};

/** What marks a token as a session bearer rather than an OIDC one, so the API never probes. */
export const sessionBearerPrefix = "chgs_";

/** The whole language of session bearer secrets, which no compact JWS inhabits. */
export const sessionBearerPattern = /^chgs_[A-Za-z0-9_-]{32,240}$/u;

/** What neither a directory name nor a stored key holds. */
const sessionStoreStreamRefused = /[\p{Cc}\s]/u;

/**
 * Whether one stream name is one a stored row holds. A route reading a stream
 * out of a path must refuse before it brands, because a caller's bad segment is
 * a status to answer with rather than a raise to catch.
 */
export function isSessionStoreStream(value: string): boolean {
  return (
    isBoundedText(value, sessionStoreStreamCharsMax) &&
    !sessionStoreStreamRefused.test(value)
  );
}

/**
 * One opaque identity a session body carries or an answer names, refused here
 * rather than by the brand it is about to become. `asBoundedText`'s rule is
 * wider than a length: a NUL and an unpaired surrogate are values no stored row
 * holds, and a brand raising on one inside a handler is a five-hundred with an
 * internal message in it where the route's own status map names four-hundred.
 */
export const sessionIdentitySchema = z
  .string()
  .refine((value) => isBoundedText(value, sessionIdentityCharsMax));

/** One repository as a session names it, which a session always does. */
export const sessionCredentialSchema = z.strictObject({
  repository: workerCredentialRepositorySchema,
});

export const sessionReferenceSchema = z.strictObject({
  reference: sessionIdentitySchema,
});

/**
 * What the pod measured of one turn: one measurement rather than five figures,
 * so a body carrying four of them is refused here rather than written as a
 * measurement with a hole in it. Every text is one a stored row holds, because
 * a model or a tool the plane took and PostgreSQL then refused would be a
 * five-hundred where the route's own map names four-hundred.
 */
export const sessionTurnMeasuredSchema = z.strictObject({
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

/** One batch of a session's stream, numbered from one. */
const sessionStoreBatchNumberSchema = z
  .number()
  .int()
  .positive()
  .max(sessionStoreBatchesMax);

/**
 * One answered turn as a pod offers it. A batch range is both of its ends or
 * neither, because the row it is written into says so and a half range is a
 * refusal a caller should read here rather than out of a failed cast, and the
 * measurement is optional for two reasons that are both real: a thread's turn
 * is answered by this same route and has no policy control over it, and a
 * runtime that reported no usage must still be able to answer rather than be
 * stuck; the readings of its context window are optional for the second
 * reason, and are the turn's own in the order it took them.
 */
export const sessionTurnAnswerSchema = z
  .strictObject({
    turn: sessionIdentitySchema,
    result: z.string().max(sessionTurnResultCharsMax),
    measured: sessionTurnMeasuredSchema.optional(),
    readings: z
      .array(sessionContextOfferedSchema)
      .min(1)
      .max(sessionTurnContextReadingsMax)
      .optional(),
    batchFirst: sessionStoreBatchNumberSchema.optional(),
    batchLast: sessionStoreBatchNumberSchema.optional(),
  })
  .refine(
    (offered) =>
      (offered.batchFirst === undefined) ===
        (offered.batchLast === undefined) &&
      (offered.batchFirst ?? 0) <= (offered.batchLast ?? 0),
  );

export const sessionTurnFailureSchema = z.strictObject({
  turn: sessionIdentitySchema,
  failure: z.enum(agentReportedTurnFailures),
});

/**
 * What a model is writing of one claimed turn, in the order it was written. A
 * post of a turn its member stopped is answered with that turn, as the watch
 * on it is, so a runner that is writing hears of the stop from its next post.
 */
export const sessionTurnLiveSchema = z.strictObject({
  turn: sessionIdentitySchema,
  events: z.array(sessionLiveEventSchema).min(1).max(sessionLiveEventsMax),
});

/**
 * The turn a runner asks after while it answers it: whether the member it is
 * answering has stopped it. The plane holds the question as it holds the
 * mailbox's, and answers it spent where no stop was recorded meanwhile.
 */
export const sessionTurnStoppedSchema = z.strictObject({
  turn: sessionIdentitySchema,
});

/**
 * Whether a thread a chat host runs is standing: whether it holds jobs its
 * host restarts with each attempt. The plane keeps the latest report on the
 * thread rather than the attempt, and keeps an attempt placed for a standing
 * thread on the host that ran its last one until the thread closes or an
 * attempt reports it is not.
 */
export const sessionStandingSchema = z.strictObject({
  standing: z.boolean(),
});

/**
 * A thread's choice of whether it is woken for its tickets, made by its own
 * live attempt: `On`, `Off`, or `null` to follow its member's chat host.
 */
export const sessionTicketWakesChoiceSchema = z.strictObject({
  thread: z.enum(threadTicketWakeSettings).nullable(),
});

/**
 * Whether a thread is woken for its tickets: its own choice and its member's
 * chat host's setting, each absent where none was made, and the setting that
 * follows from them, `threadTicketWakesEffective`.
 */
export const sessionTicketWakesSchema = z.object({
  thread: z.enum(threadTicketWakeSettings).optional(),
  host: z.enum(threadTicketWakeSettings).optional(),
  effective: z.enum(threadTicketWakeSettings),
});

/**
 * One wake a thread's attempt on its member's chat host offers its own thread:
 * why, and the name of the job, watch or timer it is about, which is all the
 * turn carries. `event` is the attempt's own identity for what happened, and
 * the turn is derived from it and the session, so the same event posted again
 * is the same turn.
 */
export const sessionWakeSchema = z.strictObject({
  wake: z.enum(allThreadJobWakeReasons),
  resource: sessionIdentitySchema,
  event: sessionIdentitySchema,
});

/** What the thread's mailbox made of a wake: a turn, the same turn again, or no turn to put in it. */
export const sessionWokenAnswerSchema = z.union([
  z.object({
    woken: z.enum(["Woken", "AlreadyWoken"]),
    ordinal: z.number().int().positive().max(sessionTurnSeriesMax),
  }),
  z.object({ woken: z.enum(["NoThread", "Closed", "Backlogged"]) }),
]);

/** How a pool's runner reports that the container its session ran in has ended, under that session's bearer. */
export const sessionEndedSchema = z.strictObject({
  phase: z.enum(sessionContainerEnds),
});

/**
 * What a pod is told of its own session, each optional fact absent where the
 * session has none, as `model` and `effort` are where it opened under the
 * site's session model and the runtime's own effort. `shellCredentialHanded`
 * is present only for a thread a chat host whose settings name its threads'
 * capabilities holds, whose session hands its shell the API's origin, its
 * bearer, its tenant and its project, in `sessionApiOriginVariable`,
 * `sessionBearerVariable`, `sessionTenantVariable` and
 * `sessionProjectVariable`, where a session told nothing hands its shell none
 * of them.
 */
export const sessionFactsAnswerSchema = z.object({
  tenant: identitySchema,
  project: identitySchema,
  session: sessionIdentitySchema,
  kind: z.enum(sessionKinds),
  capabilities: z
    .array(z.enum(sessionCapabilities))
    .max(sessionCapabilitiesMax),
  credentialSlot: sessionIdentitySchema,
  agentReference: sessionIdentitySchema.optional(),
  systemPrompt: z.string().min(1).max(agentSessionPromptCharsMax).optional(),
  model: sessionModelSchema.optional(),
  effort: z.enum(sessionEfforts).optional(),
  shellCredentialHanded: z.literal(true).optional(),
  ticketWakes: sessionTicketWakesSchema.optional(),
});

/** One turn as the mailbox hands it over, its input opaque to the plane. */
export const sessionTurnClaimedSchema = z.object({
  turn: sessionIdentitySchema,
  ordinal: z.number().int().positive().max(sessionTurnSeriesMax),
  inputKind: z.enum(sessionTurnInputKinds),
  input: z.string().max(sessionTurnInputCharsMax),
});

/** The turn a member stopped, which is over: nothing its runner then offers of it is kept. */
export const sessionTurnStoppedAnswerSchema = z.object({
  turn: sessionIdentitySchema,
});

/** The streams a session's store holds under the prefix asked for, answered whole or refused. */
export const sessionStoreStreamsAnswerSchema = z.object({
  streams: z
    .array(sessionStoreStreamResponseSchema)
    .max(nativeHttpPageItemsMax),
});

/**
 * One page of a stream, each batch carrying its bytes or marked missing where
 * its row names an object nothing can draw. `nextAfter` is present only on a
 * full page, and is where the next page starts.
 */
export const sessionStorePageAnswerSchema = z.object({
  batches: z
    .array(
      z.union([
        z.object({
          batch: sessionStoreBatchNumberSchema,
          content: z.string().max(sessionStoreBatchBytesMax),
        }),
        z.object({
          batch: sessionStoreBatchNumberSchema,
          read: z.literal("Missing"),
        }),
      ]),
    )
    .max(sessionStorePageBatchesMax),
  nextAfter: sessionStoreBatchNumberSchema.optional(),
});

/** A settlement refused because another value holds the row, or a newer attempt does. */
const sessionSettleRefusalSchema = workerPlaneRefusalSchema([
  "Conflict",
  "Fenced",
]);

/** Every status each session route's handler answers with, and what it answers. */
export const sessionPlaneAnswers = workerPlaneAnswersRefusingVersions({
  facts: { 200: sessionFactsAnswerSchema, 401: workerPlaneStopSchema },
  heartbeat: {
    204: "empty",
    401: workerPlaneStopSchema,
    409: workerPlaneStopSchema,
  },
  reference: {
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: sessionSettleRefusalSchema,
  },
  turn: {
    200: sessionTurnClaimedSchema,
    204: "empty",
    401: workerPlaneStopSchema,
  },
  turnAnswer: {
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: sessionSettleRefusalSchema,
  },
  turnFailure: {
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: sessionSettleRefusalSchema,
  },
  turnLive: {
    200: sessionTurnStoppedAnswerSchema,
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    503: workerPlaneRetrySchema,
  },
  turnStopped: {
    200: sessionTurnStoppedAnswerSchema,
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
  },
  held: {
    204: "empty",
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["Fenced"]),
  },
  standing: {
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["Fenced", "NotChatHostThread"]),
  },
  ticketWakes: {
    200: sessionTicketWakesSchema,
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["Fenced", "NotThread"]),
  },
  wake: {
    200: sessionWokenAnswerSchema,
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    404: workerPlaneRefusalSchema(["NotConfigured"]),
    409: workerPlaneRefusalSchema([
      "Fenced",
      "NotChatHostThread",
      "NotAdmitted",
    ]),
    503: workerPlaneRetrySchema,
  },
  storeStreams: {
    200: sessionStoreStreamsAnswerSchema,
    400: workerPlaneRefusalSchema(["InvalidQuery"]),
    401: workerPlaneStopSchema,
    413: workerPlaneRefusalSchema(["TooManyStreams"]),
  },
  storeBatch: {
    204: "empty",
    400: workerPlaneRefusalSchema([
      "InvalidPath",
      "InvalidStream",
      "InvalidBatch",
    ]),
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["OutOfOrder", "Conflict"]),
    413: workerPlaneRefusalSchema(["QuotaExceeded"]),
    415: workerPlaneStopSchema,
    503: workerPlaneRetrySchema,
  },
  storePage: {
    200: sessionStorePageAnswerSchema,
    400: workerPlaneRefusalSchema([
      "InvalidPath",
      "InvalidStream",
      "InvalidQuery",
    ]),
    401: workerPlaneStopSchema,
    503: workerPlaneRetrySchema,
  },
  credential: {
    200: workerCredentialAnswerSchema,
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    404: workerCredentialAbsentSchema,
    503: workerPlaneRetrySchema,
  },
  ended: {
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["Fenced"]),
  },
} as const satisfies WorkerPlaneAnswers<SessionPlaneRouteName>);
