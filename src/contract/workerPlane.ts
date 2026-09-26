/**
 * The job plane's wire: the routes one attempt's pod calls, the bodies it
 * offers, and every status each route's handler answers with.
 *
 * An answer schema drops a field it does not name, so an older pod survives a
 * newer plane; a request body refuses one instead, because a field the plane
 * dropped in silence is a figure the pod believes it put on record. A request
 * the framework refuses before any handler runs, and a handler whose port
 * throws, are answered in the framework's own body, which no map here
 * describes.
 */

import { z } from "zod";

import {
  countSchema,
  digestSchema,
  identitySchema,
  nativeHttpPageItemsMax,
  runModelCharsMax,
  runTurnSeriesMax,
} from "./http.ts";
import { runModelUsageSchema, runTotalsSchema } from "./responses.ts";
import { artifactRoles, runEndedEvidences } from "./rosters.ts";
import {
  artifactFailures,
  resultManifestRejections,
} from "./workerDocuments.ts";

/** One route as the plane registers it, a trailing `*` standing for the rest of the path. */
export interface WorkerPlaneRoute {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
}

export const workerPlaneRoutes = {
  input: { method: "GET", path: "/v1/input" },
  heartbeat: { method: "POST", path: "/v1/heartbeat" },
  artifact: { method: "PUT", path: "/v1/artifacts/*" },
  report: { method: "POST", path: "/v1/report" },
  runConfiguration: { method: "PUT", path: "/v1/run/configuration" },
  runTranscript: { method: "PUT", path: "/v1/run/transcript/*" },
  runTurns: { method: "POST", path: "/v1/run/turns" },
  runTotals: { method: "POST", path: "/v1/run/totals" },
  runEnded: { method: "POST", path: "/v1/run/ended" },
  credential: { method: "POST", path: "/v1/credential" },
} as const satisfies Readonly<Record<string, WorkerPlaneRoute>>;
export type WorkerPlaneRouteName = keyof typeof workerPlaneRoutes;

/** The media type an artifact, a configuration snapshot and a transcript batch are offered under. */
export const workerPlaneBytesMediaType = "application/octet-stream";

/** The most references one input bundle holds, restating the interpreter's bound. */
export const workerInputReferencesMax = 1_024;

/** The longest minted password, restating the interpreter's repository credential bound. */
export const repositoryCredentialCharsMax = 4_096;

/** One turn as a worker offers it; the server is what dates the stored row. */
export const workerRunTurnsSchema = z.strictObject({
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

/** A run's totals as a worker offers them, the same figures a reader is answered with. */
export const workerRunTotalsSchema = z.strictObject({
  ...runTotalsSchema.shape,
  models: z
    .array(z.strictObject(runModelUsageSchema.shape))
    .max(nativeHttpPageItemsMax),
});

export const workerRunEndedSchema = z.strictObject({
  evidence: z.enum(runEndedEvidences),
});

/** A refusal the pod stops on. */
export const workerPlaneStopSchema = z.object({ action: z.literal("stop") });

/** An outage the pod waits out, answered with a `retry-after` header naming how long. */
export const workerPlaneRetrySchema = z.object({ action: z.literal("retry") });

/** A refusal the pod stops on, naming which of `reasons` it was refused for. */
export function workerPlaneRefusalSchema<
  const Reasons extends readonly [string, ...string[]],
>(reasons: Reasons) {
  return z.object({ action: z.literal("stop"), reason: z.enum(reasons) });
}

const workerInputReferenceSchema = z.object({
  ordinal: z.number().int().positive().max(workerInputReferencesMax),
  kind: identitySchema,
  reference: identitySchema,
  digest: digestSchema.optional(),
});

/** The input bundle an attempt was placed with, which is where a pod learns its repository and base. */
export const workerInputAnswerSchema = z.object({
  bundle: identitySchema,
  digest: digestSchema,
  references: z.array(workerInputReferenceSchema).max(workerInputReferencesMax),
});

/** A report refused for its manifest names why, and the row it was reached at where there is one. */
export const workerReportRefusalSchema = z.object({
  action: z.literal("stop"),
  reason: z.enum([...resultManifestRejections, ...artifactFailures]).optional(),
  at: z.object({ role: z.enum(artifactRoles), index: countSchema }).optional(),
});

/** How far a run's turn series is stored, which is what the pod stops offering below. */
export const workerRunTurnsAnswerSchema = z.object({
  turnsRecorded: countSchema,
});

/** One git credential, presented to git as a username and a password until it expires. */
export const workerCredentialAnswerSchema = z.object({
  username: identitySchema,
  password: z.string().min(1).max(repositoryCredentialCharsMax),
  expiresAtMs: countSchema,
});

/** Why the plane minted nothing, which sends the pod back to the credential its launcher mounted. */
export const workerCredentialAbsences = [
  "ForgeNotConfigured",
  "NotMinted",
] as const;

export const workerCredentialAbsentSchema = z.object({
  reason: z.enum(workerCredentialAbsences),
});
export type WorkerCredentialAbsent = z.infer<
  typeof workerCredentialAbsentSchema
>;

/** What one status answers with: a body its schema reads, or no body at all. */
export type WorkerPlaneAnswer = z.ZodType | "empty";

/** The refusals every write keeping a run's bytes answers with, whichever run object it keeps. */
const workerRunObjectAnswers = {
  204: "empty",
  401: workerPlaneStopSchema,
  409: workerPlaneRefusalSchema(["OutOfOrder", "Conflict", "Fenced"]),
  413: workerPlaneRefusalSchema(["QuotaExceeded"]),
  415: workerPlaneStopSchema,
  503: workerPlaneRetrySchema,
} as const;

/** Every status each job route's handler answers with, and what it answers. */
export const workerPlaneAnswers = {
  input: { 200: workerInputAnswerSchema, 401: workerPlaneStopSchema },
  heartbeat: {
    204: "empty",
    401: workerPlaneStopSchema,
    409: workerPlaneStopSchema,
  },
  artifact: {
    204: "empty",
    400: workerPlaneRefusalSchema(["InvalidPath"]),
    401: workerPlaneStopSchema,
    409: workerPlaneStopSchema.extend({
      reason: z.enum(["Conflict", "Fenced"]).optional(),
    }),
    413: workerPlaneRefusalSchema(["QuotaExceeded"]),
    415: workerPlaneStopSchema,
    503: workerPlaneRetrySchema,
  },
  report: {
    202: workerPlaneStopSchema,
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: workerReportRefusalSchema,
    503: workerPlaneRetrySchema,
  },
  runConfiguration: {
    ...workerRunObjectAnswers,
    400: workerPlaneRefusalSchema(["InvalidPath"]),
  },
  runTranscript: {
    ...workerRunObjectAnswers,
    400: workerPlaneRefusalSchema(["InvalidBatch", "InvalidPath"]),
  },
  runTurns: {
    200: workerRunTurnsAnswerSchema,
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["Conflict", "Fenced"]),
  },
  runTotals: {
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["OutOfOrder", "Conflict", "Fenced"]),
    413: workerPlaneRefusalSchema(["QuotaExceeded"]),
  },
  runEnded: {
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: workerPlaneStopSchema,
  },
  credential: {
    200: workerCredentialAnswerSchema,
    401: workerPlaneStopSchema,
    404: workerCredentialAbsentSchema,
    503: workerPlaneRetrySchema,
  },
} as const satisfies Readonly<
  Record<WorkerPlaneRouteName, Readonly<Record<number, WorkerPlaneAnswer>>>
>;
