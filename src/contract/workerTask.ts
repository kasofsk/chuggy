/**
 * The documents a pod is launched with, and the bounds on the task one carries.
 * The grant, the worker configuration and the execution profile are the
 * interpreter's, restated here and held against it by
 * `test/contract/workerTask.test.ts`.
 */

import { z } from "zod";

import { workerPoolAssignmentSchema } from "./workerPool.ts";

/** The longest single briefing line, which is one criterion, constraint or instruction. */
export const briefingLineCharsMax = 512;

/** The most command lines one stage may name, whichever stage it is. */
export const commandLinesMax = 8;

/** Every filesystem reach a grant may name, in the interpreter's order. */
export const filesystemAccesses = [
  "None",
  "ReadWorkspace",
  "WriteWorkspace",
] as const;

/** What task policy granted one attempt, restating the interpreter's `PolicyAuthorityGrant`. */
const policyAuthorityGrantSchema = z.object({
  tools: z.array(z.string()),
  credentials: z.array(z.string()),
  network: z.boolean(),
  filesystem: z.enum(filesystemAccesses),
  mayCompleteTask: z.boolean(),
});

/** How the worker runs a task: one agent, or the command lines a check stage resolved to. */
const workerModeSchema = z.union([
  z.object({
    type: z.literal("SingleAgent"),
    agent: z.literal("Claude"),
    arguments: z.array(z.string()),
  }),
  z.object({
    type: z.literal("SingleAgent"),
    agent: z.literal("Codex"),
    arguments: z.array(z.string()),
    model: z.string(),
  }),
  z.object({ type: z.literal("Commands"), commands: z.array(z.string()) }),
]);

const workerPreparationShape = {
  setup: z.array(z.string()),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
};

/** The worker configuration an invocation carries; one that predates modes carries bare agent arguments. */
const workerConfigurationSchema = z.union([
  z.object({ mode: workerModeSchema, ...workerPreparationShape }),
  z.object({ arguments: z.array(z.string()), ...workerPreparationShape }),
]);

/** What a worker is handed: its fenced identity, its pinned inputs, what it may do and where its plane is. */
export const workTaskDocumentSchema = z.object({
  tenant: z.string(),
  project: z.string(),
  execution: z.string(),
  attempt: z.string(),
  generation: z.number(),
  ticket: z.number(),
  task: z.number(),
  taskKind: z.string(),
  stage: z.number().exactOptional(),
  sourceRequest: z.string(),
  inputBundle: z.string(),
  inputBundleDigest: z.string(),
  configurationRevision: z.string(),
  configurationDigest: z.string(),
  profile: z.object({ profile: z.string(), runtimeVersion: z.string() }),
  requirementIdentity: z.string(),
  requirementDigest: z.string(),
  briefing: z.object({
    templateVersion: z.number(),
    purpose: z.string(),
    text: z.string(),
  }),
  authority: policyAuthorityGrantSchema,
  worker: workerConfigurationSchema.exactOptional(),
  workerPlane: z.object({
    url: z.string(),
    capabilityFile: z.string(),
    capability: z.string(),
    manifest: z.string(),
  }),
});

/** Every bound a session pod runs under, each one the deployment named. */
const sessionBoundsSchema = z.object({
  mailboxPollMs: z.number(),
  idleMs: z.number(),
  resultDrainMs: z.number(),
  loadTimeoutMs: z.number(),
  turnsMax: z.number(),
  budgetUsd: z.number(),
});

/** What a session is handed: its fenced identity, what it may do, and where its mailbox and its repository are. */
export const sessionTaskDocumentSchema = z.object({
  tenant: z.string(),
  project: z.string(),
  session: z.string(),
  kind: z.string(),
  attempt: z.string(),
  generation: z.number(),
  capabilities: z.array(z.string()),
  credentialSlot: z.string(),
  agentReference: z.string().exactOptional(),
  authority: policyAuthorityGrantSchema,
  workerPlane: z.object({ url: z.string(), capabilityFile: z.string() }),
  /** Where the pod's own tools reach the API, an origin the client appends the versioned path to. */
  api: z.object({ url: z.string() }),
  /** The repository reference the pod resolves against the site's own map, absent where the project binds none. */
  repository: z.object({ reference: z.string() }).exactOptional(),
  bounds: sessionBoundsSchema,
});

/** What a pool's pod is launched with in place of a task document. */
export const poolEnvelopeSchema = z.object({
  callbackUrl: workerPoolAssignmentSchema.shape.callbackUrl,
  bearer: workerPoolAssignmentSchema.shape.bearer,
  workspace: z.string(),
  timeoutSecsMax: z.number(),
  outputBytesMax: z.number(),
  providerCredentialFile: z.string().exactOptional(),
});

/** A document as its launcher builds it, which nothing after the launcher writes to. */
type LaunchedDocument<Value> = Value extends object
  ? { readonly [Key in keyof Value]: LaunchedDocument<Value[Key]> }
  : Value;

export type WorkTaskDocument = LaunchedDocument<
  z.infer<typeof workTaskDocumentSchema>
>;
export type SessionBounds = LaunchedDocument<
  z.infer<typeof sessionBoundsSchema>
>;
export type SessionTaskDocument = LaunchedDocument<
  z.infer<typeof sessionTaskDocumentSchema>
>;
export type PoolEnvelope = LaunchedDocument<z.infer<typeof poolEnvelopeSchema>>;
