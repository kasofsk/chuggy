/**
 * The session plane's wire: the routes a session pod calls, the bodies it
 * offers, every status each route's handler answers with, how a session bearer
 * is written, and what names a store stream.
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
  repositoryIdentityCharsMax,
  sessionCapabilitiesMax,
  sessionIdentityCharsMax,
  sessionStoreBatchBytesMax,
  sessionStoreBatchesMax,
  sessionStorePageBatchesMax,
  sessionStoreStreamCharsMax,
  sessionTurnInputCharsMax,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnSeriesMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "./http.ts";
import { leadStoreStreamResponseSchema } from "./responses.ts";
import {
  agentReportedTurnFailures,
  sessionCapabilities,
  sessionKinds,
  sessionTurnInputKinds,
} from "./rosters.ts";
import {
  workerCredentialAbsentSchema,
  workerCredentialAnswerSchema,
  workerPlaneRefusalSchema,
  workerPlaneRetrySchema,
  workerPlaneStopSchema,
  type WorkerPlaneAnswer,
  type WorkerPlaneRoute,
} from "./workerPlane.ts";

/** The bounds a session pod's turns and store are written against, the failures a turn may name, and the capabilities a session may hold. */
export {
  sessionStoreBatchBytesMax,
  sessionStoreBatchesMax,
  sessionStorePageBatchesMax,
  sessionStoreStreamCharsMax,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "./http.ts";
export { agentReportedTurnFailures, sessionCapabilities } from "./rosters.ts";

/** The routes a session pod calls, which a plane composed without sessions does not serve. */
export const sessionPlaneRoutes = {
  facts: { method: "GET", path: "/v1/session" },
  heartbeat: { method: "POST", path: "/v1/session/heartbeat" },
  reference: { method: "PUT", path: "/v1/session/reference" },
  turn: { method: "GET", path: "/v1/session/turn" },
  turnAnswer: { method: "POST", path: "/v1/session/turn/answer" },
  turnFailure: { method: "POST", path: "/v1/session/turn/failure" },
  held: { method: "POST", path: "/v1/session/held" },
  storeStreams: { method: "GET", path: "/v1/session/store" },
  storeBatch: { method: "PUT", path: "/v1/session/store/*" },
  storePage: { method: "GET", path: "/v1/session/store/*" },
  credential: { method: "POST", path: "/v1/session/credential" },
} as const satisfies Readonly<Record<string, WorkerPlaneRoute>>;
export type SessionPlaneRouteName = keyof typeof sessionPlaneRoutes;

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

/** One repository as a session names it, refused here rather than by the brand. */
export const sessionCredentialSchema = z.strictObject({
  repository: z
    .string()
    .refine((value) => isBoundedText(value, repositoryIdentityCharsMax)),
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
 * stuck.
 */
export const sessionTurnAnswerSchema = z
  .strictObject({
    turn: sessionIdentitySchema,
    result: z.string().max(sessionTurnResultCharsMax),
    measured: sessionTurnMeasuredSchema.optional(),
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

/** What a pod is told of its own session, each optional fact absent where the session has none. */
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
  forkFrom: sessionIdentitySchema.optional(),
});

/** One turn as the mailbox hands it over, its input opaque to the plane. */
export const sessionTurnClaimedSchema = z.object({
  turn: sessionIdentitySchema,
  ordinal: z.number().int().positive().max(sessionTurnSeriesMax),
  inputKind: z.enum(sessionTurnInputKinds),
  input: z.string().max(sessionTurnInputCharsMax),
});

/** The streams a session's store holds under the prefix asked for, answered whole or refused. */
export const sessionStoreStreamsAnswerSchema = z.object({
  streams: z.array(leadStoreStreamResponseSchema).max(nativeHttpPageItemsMax),
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
export const sessionPlaneAnswers = {
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
  held: {
    204: "empty",
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["Fenced"]),
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
} as const satisfies Readonly<
  Record<SessionPlaneRouteName, Readonly<Record<number, WorkerPlaneAnswer>>>
>;
