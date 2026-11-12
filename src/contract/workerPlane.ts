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
  isBoundedText,
  nativeHttpPageItemsMax,
  repositoryIdentityCharsMax,
  runContextPageReadingsMax,
  runModelCharsMax,
  runTurnSeriesMax,
  runUsageInstantSchema,
  textUtf8Bytes,
} from "./http.ts";
import {
  workerPlaneAnswersRefusingVersions,
  type WorkerPlaneAnswers,
} from "./planeAnswers.ts";
import {
  runContextOfferedSchema,
  runModelUsageSchema,
  runToolUseIdSchema,
  runTotalsSchema,
} from "./responses.ts";
import {
  artifactRoles,
  forgeApps,
  runEndedEvidences,
  runUsageWindows,
} from "./rosters.ts";
import {
  artifactFailures,
  resultManifestRejections,
} from "./workerDocuments.ts";
import {
  isHeldCredentialValueVariable,
  isHeldCredentialVariable,
} from "./workerEnvironment.ts";
import { workerTaskAnswerSchema } from "./workerTask.ts";

/** One route as the plane registers it, a trailing `*` standing for the rest of the path. */
export interface WorkerPlaneRoute {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
}

export const workerPlaneRoutes = {
  input: { method: "GET", path: "/v1/input" },
  inputArtifact: { method: "GET", path: "/v1/input/artifacts/*" },
  task: { method: "GET", path: "/v1/task" },
  heartbeat: { method: "POST", path: "/v1/heartbeat" },
  artifact: { method: "PUT", path: "/v1/artifacts/*" },
  report: { method: "POST", path: "/v1/report" },
  runConfiguration: { method: "PUT", path: "/v1/run/configuration" },
  runTranscript: { method: "PUT", path: "/v1/run/transcript/*" },
  runTurns: { method: "POST", path: "/v1/run/turns" },
  runTotals: { method: "POST", path: "/v1/run/totals" },
  runContext: { method: "POST", path: "/v1/run/context" },
  runEnded: { method: "POST", path: "/v1/run/ended" },
  credential: { method: "POST", path: "/v1/credential" },
  heldCredentials: { method: "POST", path: "/v1/credentials/held" },
} as const satisfies Readonly<Record<string, WorkerPlaneRoute>>;
export type WorkerPlaneRouteName = keyof typeof workerPlaneRoutes;

/**
 * The media type an artifact, a configuration snapshot, a transcript batch
 * and an input reference's own bytes are offered under.
 */
export const workerPlaneBytesMediaType = "application/octet-stream";

/** The most references one input bundle holds, restating the interpreter's bound. */
export const workerInputReferencesMax = 1_024;

/**
 * The most bytes one input reference's own read answers, the plane's read
 * bound the way `workerPlaneUploadBytesMax` bounds the write.
 */
export const workerPlaneInputArtifactBytesMax = 4_194_304;

/** The longest minted password, restating the interpreter's repository credential bound. */
export const repositoryCredentialCharsMax = 4_096;

/** The bounds a pod's uploads and run records are written against, and the ways a run may be said to have ended. */
export {
  nativeHttpPageItemsMax,
  runConfigurationBytesMax,
  runContextItemsMax,
  runContextNameCharsMax,
  runContextPageReadingsMax,
  runContextPathCharsMax,
  runContextReadingsMax,
  runModelCharsMax,
  runOutcomeLabelCharsMax,
  runToolUseIdCharsMax,
  runTranscriptBatchBytesMax,
  runTranscriptBatchesMax,
  runTurnSeriesMax,
  runUsageInstantSecsMax,
  workerPlaneUploadBytesMax,
} from "./http.ts";
export {
  runCompactionTriggers,
  runContextCategoryKinds,
  runEndedEvidences,
  runUsageWindows,
} from "./rosters.ts";
export type { WorkerPlaneAnswer } from "./planeAnswers.ts";

/** One turn as a worker offers it, naming the subagent call it was made under where it was; the server is what dates the stored row. */
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
        parentToolUseId: runToolUseIdSchema.exactOptional(),
      }),
    )
    .min(1)
    .max(nativeHttpPageItemsMax),
});

/** A page of a run's context readings as a worker offers them; the server is what dates each stored row. */
export const workerRunContextSchema = z.strictObject({
  readings: z
    .array(runContextOfferedSchema)
    .min(1)
    .max(runContextPageReadingsMax),
});

/**
 * The most of its window a reading may say an account has used, where the
 * whole window is one: a provider can report an account past its window, so
 * the ceiling sits well above it.
 */
export const runUsageUtilizationMax = 100;

/** How much of one window the account had used, when the window reopens, and when the runtime read it. */
const runUsageReadingSchema = z.strictObject({
  utilization: z.number().nonnegative().max(runUsageUtilizationMax),
  resetsAt: runUsageInstantSchema,
  observedAt: runUsageInstantSchema,
});

/** The account's latest reading of each window the runtime saw one of, keyed by the window so each appears at most once. */
export const workerRunUsageSchema = z.strictObject({
  five_hour: runUsageReadingSchema.exactOptional(),
  seven_day: runUsageReadingSchema.exactOptional(),
});

/** A run's totals as a worker offers them, the same figures a reader is answered with, and the usage of the account it spent. */
export const workerRunTotalsSchema = z.strictObject({
  ...runTotalsSchema.shape,
  models: z
    .array(z.strictObject(runModelUsageSchema.shape))
    .max(nativeHttpPageItemsMax),
  usage: workerRunUsageSchema.exactOptional(),
});

/** The limit a provider stopped a run at: which window, and when it reopens, each where the provider said. */
export const workerRunLimitSchema = z.strictObject({
  window: z.enum(runUsageWindows).exactOptional(),
  resetsAt: runUsageInstantSchema.exactOptional(),
});

/** The label a run ended itself under, and the limit that stopped it, which is kept only beside `RunRateLimited`. */
export const workerRunEndedSchema = z.strictObject({
  evidence: z.enum(runEndedEvidences),
  limit: workerRunLimitSchema.exactOptional(),
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

/** One repository as a pod names it for a credential, refused here rather than by the brand. */
export const workerCredentialRepositorySchema = z
  .string()
  .refine((value) => isBoundedText(value, repositoryIdentityCharsMax));

/**
 * What an attempt may ask its credential for: nothing, which is its own
 * repository minted what its task kind needs, or a repository it names, minted
 * a read where it is its own or one its project binds.
 */
export const workerCredentialSchema = z.strictObject({
  repository: workerCredentialRepositorySchema.exactOptional(),
});

/** One git credential, presented to git as a username and a password until it expires. */
export const workerCredentialAnswerSchema = z.object({
  username: identitySchema,
  password: z.string().min(1).max(repositoryCredentialCharsMax),
  expiresAtMs: countSchema,
});

/**
 * Why the plane minted nothing. A pod asking for the repository it works in
 * then uses the credential its launcher mounted, and one that named any other
 * repository holds no credential for it.
 */
export const workerCredentialAbsences = [
  "ForgeNotConfigured",
  "NotMinted",
] as const;

/** Which refusal a mint for `repository` met, the `app` it was asked of, and where the operator goes to change it. */
export const workerCredentialUnreachedSchema = z.discriminatedUnion("reach", [
  /** The installation on the repository's owner does not select it: the operator adds it to that installation's repository selection. */
  z.object({
    reach: z.literal("Unselected"),
    repository: workerCredentialRepositorySchema,
    app: z.enum(forgeApps),
    installation: identitySchema,
  }),
  /** The forge refused that installation or the app itself, for its key, a suspension or a permission not accepted: the operator goes to the app's installation page. */
  z.object({
    reach: z.literal("Refused"),
    repository: workerCredentialRepositorySchema,
    app: z.enum(forgeApps),
    installation: identitySchema,
  }),
  /** No installation of the app is claimed on the owner: the operator installs the app there. */
  z.object({
    reach: z.literal("Unclaimed"),
    repository: workerCredentialRepositorySchema,
    app: z.enum(forgeApps),
  }),
]);

/** `unreached` is present only on a `NotMinted` whose mint got past the repository's address. */
export const workerCredentialAbsentSchema = z.object({
  reason: z.enum(workerCredentialAbsences),
  unreached: workerCredentialUnreachedSchema.optional(),
});
export type WorkerCredentialAbsent = z.infer<
  typeof workerCredentialAbsentSchema
>;

/** The most credentials one attempt asks the plane's held ones for, and so the most one answer serves or names absent. */
export const workerHeldCredentialsMax = 32;

/** The longest held secret the plane serves. */
export const heldCredentialSecretCharsMax = 4_096;

/** The most files one served credential's bundle holds. */
export const heldCredentialBundleFilesMax = 16;

/** The most variables one served credential's bundle sets. */
export const heldCredentialBundleVariablesMax = 16;

/** The most bytes one file of a bundle holds, its text as `textUtf8Bytes` weighs it. */
export const heldCredentialBundleFileBytesMax = 16_384;

/** The credentials an attempt asks for by the names its grant gives them. */
export const workerHeldCredentialsSchema = z.strictObject({
  credentials: z.array(identitySchema).max(workerHeldCredentialsMax),
});

/**
 * One credential the plane holds for the attempt's project, the variable its
 * file is named by in the job's environment, and when it stops working where
 * it is one that does. It remains only so that a plane can answer a worker
 * from before `workerContractCredentialBundles`.
 */
export const workerHeldCredentialSchema = z.object({
  credential: identitySchema,
  variable: identitySchema.refine(isHeldCredentialVariable),
  secret: z.string().min(1).max(heldCredentialSecretCharsMax),
  expiresAtMs: countSchema.optional(),
});

/**
 * The name a bundle's file is written under, inside a directory the worker
 * chooses for the bundle: lower case, and ending in a letter or digit, so that
 * no two names are one file where a filesystem ignores case or a trailing dot.
 */
export const heldCredentialFileNamePattern =
  /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;

/** What a text or a variable's value holds where the worker is to write the path it wrote the bundle's file `file` at. */
export function heldCredentialFilePlaceholder(file: string): string {
  return `{{file:${file}}}`;
}

/** The files `text` names by a placeholder, in the order it names them. */
export function heldCredentialFilesPlaced(text: string): readonly string[] {
  return Array.from(text.matchAll(/\{\{file:([^{}]*)\}\}/gu), (placed) =>
    String(placed[1]),
  );
}

/** Whether `text` is within a bundle file's bound, which also bounds a variable's value. */
function isHeldCredentialBundleText(text: string): boolean {
  return textUtf8Bytes(text) <= heldCredentialBundleFileBytesMax;
}

/** A bundle's file: secret content written as it is, or generated text whose placeholders the worker fills first. */
export const heldCredentialBundleFileSchema = z.object({
  file: z.string().regex(heldCredentialFileNamePattern),
  content: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("Secret"),
      secret: z.string().min(1).refine(isHeldCredentialBundleText),
    }),
    z.object({
      kind: z.literal("Text"),
      text: z.string().refine(isHeldCredentialBundleText),
    }),
  ]),
});

/** A variable a bundle sets: the path of one of its files, or a plain value that is no secret, whose placeholders the worker fills. */
export const heldCredentialBundleVariableSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("Path"),
    variable: identitySchema.refine(isHeldCredentialVariable),
    file: z.string().regex(heldCredentialFileNamePattern),
  }),
  z.object({
    kind: z.literal("Value"),
    variable: identitySchema.refine(isHeldCredentialValueVariable),
    value: z.string().refine(isHeldCredentialBundleText),
  }),
]);
export type HeldCredentialBundleVariable = z.infer<
  typeof heldCredentialBundleVariableSchema
>;

/** The bundle files a variable names, by its path or by its value's placeholders. */
function heldCredentialBundleVariableFiles(
  variable: HeldCredentialBundleVariable,
): readonly string[] {
  return variable.kind === "Path"
    ? [variable.file]
    : heldCredentialFilesPlaced(variable.value);
}

/**
 * One credential served as a bundle: the files the worker writes and the
 * variables it sets, each file and each variable named once, every file a
 * variable or a text names being one of the bundle's own, and when the bundle
 * stops working where it is one the worker refreshes.
 */
export const workerHeldCredentialBundleSchema = z
  .object({
    credential: identitySchema,
    files: z
      .array(heldCredentialBundleFileSchema)
      .max(heldCredentialBundleFilesMax),
    variables: z
      .array(heldCredentialBundleVariableSchema)
      .min(1)
      .max(heldCredentialBundleVariablesMax),
    expiresAtMs: countSchema.optional(),
  })
  .refine((bundle) => {
    const files = new Set(bundle.files.map((each) => each.file));
    const variables = new Set(bundle.variables.map((each) => each.variable));
    const named = [
      ...bundle.files.flatMap((each) =>
        each.content.kind === "Text"
          ? heldCredentialFilesPlaced(each.content.text)
          : [],
      ),
      ...bundle.variables.flatMap(heldCredentialBundleVariableFiles),
    ];
    return (
      files.size === bundle.files.length &&
      variables.size === bundle.variables.length &&
      named.every((file) => files.has(file))
    );
  });
export type WorkerHeldCredentialBundle = z.infer<
  typeof workerHeldCredentialBundleSchema
>;

/**
 * Why a credential asked for was not served: the attempt's grant does not
 * allow its name, nothing here holds or issues it, it is not enabled for the
 * attempt's project or repository, the outside system that issues it refused,
 * or the worker's release is too old to read the shape it is served in.
 */
export const workerHeldCredentialAbsences = [
  "NotGranted",
  "NotHeld",
  "NotEnabled",
  "IssuerRefused",
  "WorkerTooOld",
] as const;

/** One credential asked for and not served, and why. */
export const workerHeldCredentialAbsentSchema = z.object({
  credential: identitySchema,
  reason: z.enum(workerHeldCredentialAbsences),
});
export type WorkerHeldCredentialAbsent = z.infer<
  typeof workerHeldCredentialAbsentSchema
>;

/** Each credential asked for that the plane serves, and those it names absent; a plane before `workerContractCredentialBundles` names none absent. */
export const workerHeldCredentialsAnswerSchema = z.object({
  credentials: z
    .array(
      z.union([workerHeldCredentialBundleSchema, workerHeldCredentialSchema]),
    )
    .max(workerHeldCredentialsMax),
  absent: z
    .array(workerHeldCredentialAbsentSchema)
    .max(workerHeldCredentialsMax)
    .optional(),
});

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
export const workerPlaneAnswers = workerPlaneAnswersRefusingVersions({
  input: { 200: workerInputAnswerSchema, 401: workerPlaneStopSchema },
  inputArtifact: {
    200: "bytes",
    401: workerPlaneStopSchema,
    404: workerPlaneStopSchema,
    413: workerPlaneRefusalSchema(["QuotaExceeded"]),
    503: workerPlaneRetrySchema,
  },
  task: {
    200: workerTaskAnswerSchema,
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["TaskNotRecorded"]),
  },
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
  runContext: {
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["OutOfOrder", "Conflict", "Fenced"]),
  },
  runEnded: {
    204: "empty",
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: workerPlaneStopSchema,
  },
  credential: {
    200: workerCredentialAnswerSchema,
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    404: workerCredentialAbsentSchema,
    503: workerPlaneRetrySchema,
  },
  heldCredentials: {
    200: workerHeldCredentialsAnswerSchema,
    400: workerPlaneStopSchema,
    401: workerPlaneStopSchema,
    409: workerPlaneRefusalSchema(["TaskNotRecorded"]),
    503: workerPlaneRetrySchema,
  },
} as const satisfies WorkerPlaneAnswers<WorkerPlaneRouteName>);
