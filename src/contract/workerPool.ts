/**
 * What a worker pool is handed per assignment, what it answers with, and what
 * it registers as.
 *
 * A POOL IS A PLACEMENT BACKEND AND NOTHING ELSE. It is handed what it needs to
 * size and start a workload and to kill one that stopped answering; everything
 * else — the execution, the ticket, the task, the briefing, the input bundle,
 * every credential and every content reference — the harness fetches from
 * `callbackUrl` under `bearer`, or never leaves the orchestrator at all. That
 * is why this is thin, and why it is here: a third party implements the wire,
 * so it is written where the wire is.
 *
 * NOTHING HERE IDENTIFIES THE WORK. `assignment` is opaque because a pool that
 * could read an execution identity would learn the tenant's ticket structure,
 * and capability tokens are opaque because a pool may translate one into a node
 * selector, a scheduler constraint, or nothing.
 */

import { z } from "zod";

export const workerPoolTokenCharsMax = 63;
export const workerPoolIdentityCharsMax = 256;
export const workerPoolCapabilitiesMax = 64;
export const workerPoolEvidenceCharsMax = 4_096;

/**
 * A capability token, free-form and per-project: a claim rather than a proof,
 * which is accepted knowingly because a project's owner knows the pools it
 * registered. The colon is admitted because this installation's own execution
 * capabilities are written `Agent:Claude`, and a token a pool cannot spell is a
 * token no pool can be registered for.
 */
export const workerPoolCapabilitySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_:-]*$/u)
  .max(workerPoolTokenCharsMax);

const workerPoolCapabilitiesSchema = z
  .array(workerPoolCapabilitySchema)
  .max(workerPoolCapabilitiesMax);

export const workerPoolAssignmentSchema = z.strictObject({
  /** The idempotency key and the cancel handle in one, opaque to the pool. */
  assignment: z.string().min(1).max(workerPoolIdentityCharsMax),
  capabilities: workerPoolCapabilitiesSchema,
  /**
   * The size of the box, which no capability token expresses. Omit them and
   * large work lands on a small machine and dies as a process failure rather
   * than as work nobody could place.
   */
  cpuMillis: z.number().int().positive().safe(),
  memoryMib: z.number().int().positive().safe(),
  /** The pool is the only party that can kill a process that stopped answering. */
  deadlineSecs: z.number().int().positive().safe(),
  /** Where the harness fetches everything this payload does not carry. */
  callbackUrl: z.url(),
  /**
   * A one-shot capability scoped to this attempt, stored as a digest. It cannot
   * be the pool's registration credential: that would let a pool report
   * terminals for attempts it was never given.
   */
  bearer: z.string().min(1).max(workerPoolIdentityCharsMax),
});

/**
 * A settled no becomes the attempt's evidence; a temporary no is the pool's own
 * backpressure, which is also why registration declares no concurrency — a
 * declared limit and a returned `retryAfterSecs` would be two sources of one
 * truth and only the second is current.
 */
export const assignmentOutcomeSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("Accepted") }),
  z.strictObject({
    outcome: z.literal("Refused"),
    evidence: z.string().min(1).max(workerPoolEvidenceCharsMax),
  }),
  z.strictObject({
    outcome: z.literal("Unavailable"),
    retryAfterSecs: z.number().int().positive().safe(),
  }),
]);

export const workerPoolRegistrationSchema = z.strictObject({
  pool: z.string().min(1).max(workerPoolIdentityCharsMax),
  capabilities: workerPoolCapabilitiesSchema,
});

/**
 * What an owner asks a registration token for: the capabilities the machine it
 * is about to configure may claim, and how long the token stands.
 */
export const workerPoolRegistrationTokenRequestSchema = z.strictObject({
  capabilities: workerPoolCapabilitiesSchema,
  lifetimeSecs: z.number().int().positive().safe(),
});

/**
 * What an operator redeems with: the token, the name the pool takes, and the
 * capabilities it declares — which the token bounds rather than confirms.
 */
export const workerPoolRedemptionSchema = z.strictObject({
  token: z.string().min(1).max(workerPoolIdentityCharsMax),
  pool: z.string().min(1).max(workerPoolIdentityCharsMax),
  capabilities: workerPoolCapabilitiesSchema,
});

export type WorkerPoolAssignment = z.infer<typeof workerPoolAssignmentSchema>;
export type AssignmentOutcome = z.infer<typeof assignmentOutcomeSchema>;
export type WorkerPoolRegistration = z.infer<
  typeof workerPoolRegistrationSchema
>;
export type WorkerPoolRegistrationTokenRequest = z.infer<
  typeof workerPoolRegistrationTokenRequestSchema
>;
export type WorkerPoolRedemptionRequest = z.infer<
  typeof workerPoolRedemptionSchema
>;
