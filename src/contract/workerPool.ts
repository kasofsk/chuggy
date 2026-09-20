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

import { retryAfterSecondsMax } from "./outcomes.ts";

export const workerPoolTokenCharsMax = 63;
export const workerPoolIdentityCharsMax = 256;
export const workerPoolCapabilitiesMax = 64;
export const workerPoolEvidenceCharsMax = 4_096;
/**
 * The longest a pool may ask the orchestrator to wait before offering again,
 * which is the same ceiling a `retry-after` header is held to: a wait taken on
 * the other side's word is bounded by this side.
 */
export const workerPoolRetryAfterSecsMax = retryAfterSecondsMax;

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

/** What a pool declares, bounded the same wherever it is parsed: the wire, and the owner's command. */
export const workerPoolCapabilitiesSchema = z
  .array(workerPoolCapabilitySchema)
  .max(workerPoolCapabilitiesMax);

/** The name an assignment goes by on every leg of the wire, opaque to the pool. */
export const workerPoolAssignmentIdentitySchema = z
  .string()
  .min(1)
  .max(workerPoolIdentityCharsMax);

export const workerPoolAssignmentSchema = z.strictObject({
  /** The idempotency key and the cancel handle in one. */
  assignment: workerPoolAssignmentIdentitySchema,
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
    retryAfterSecs: z
      .number()
      .int()
      .positive()
      .safe()
      .max(workerPoolRetryAfterSecsMax),
  }),
]);

/**
 * The poll, which is the one call a pool makes for work: a GET at this path
 * whose query is `workerPoolPollQuerySchema`, answered with
 * `workerPoolReconciliationSchema`. Every lease the query names is renewed by
 * the call, so a pool that stops making it is a pool whose work comes back.
 */
export const workerPoolPollRoute = "/v1/assignments";

/**
 * Where a pool reports what it did with an assignment, keyed by the outcome:
 * a POST at the path, whose body is that arm of `assignmentOutcomeSchema`
 * without its `outcome`. A route pattern is what a server registers, and
 * `workerPoolSettlementPath` is the same route as a client fills it.
 */
export const workerPoolSettlementRoutes = {
  Accepted: `${workerPoolPollRoute}/:assignment/accepted`,
  Refused: `${workerPoolPollRoute}/:assignment/refused`,
  Unavailable: `${workerPoolPollRoute}/:assignment/unavailable`,
} as const;

export function workerPoolSettlementPath(
  outcome: keyof typeof workerPoolSettlementRoutes,
  assignment: string,
): string {
  return workerPoolSettlementRoutes[outcome].replace(
    ":assignment",
    encodeURIComponent(assignment),
  );
}

/** The poll's query parameters by name, `held` repeated once per assignment and `wanted` once. */
export const workerPoolPollQuery = { held: "held", wanted: "wanted" } as const;

/** A count as a query string carries one: decimal, canonical, and within what a number can hold. */
const workerPoolQueryCountSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)$/u)
  .transform(Number)
  .pipe(z.number().int().nonnegative().safe());

/**
 * The poll's query as the plane reads it: `held`, the assignments the pool is
 * still running, repeated or single or absent as a query carries a list, and
 * `wanted`, how many more it has room for now. The held list's length is the
 * plane's own setting rather than a figure written here, and a list longer
 * than that is refused whole rather than cut, because a cut list reads as a
 * pool that let go of work it is still running; the plane bounds `wanted` by
 * its own settings and never exceeds it, and a pool sending zero is still
 * answered with what it must stop.
 */
export function workerPoolPollQuerySchema(heldMax: number) {
  return z.strictObject({
    [workerPoolPollQuery.held]: z.preprocess(
      (value): unknown[] =>
        value === undefined
          ? []
          : Array.isArray(value)
            ? (value as unknown[])
            : [value],
      z.array(workerPoolAssignmentIdentitySchema).max(heldMax),
    ),
    [workerPoolPollQuery.wanted]: workerPoolQueryCountSchema,
  });
}

/**
 * What a poll is answered with: the assignments the pool may now place, and
 * the ones it must stop. Each list is as long as the plane's own bounds allow
 * and no longer, so a reader bounds the body it takes in.
 */
export const workerPoolReconciliationSchema = z.strictObject({
  assignments: z.array(workerPoolAssignmentSchema),
  stop: z.array(workerPoolAssignmentIdentitySchema),
});

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
export type WorkerPoolReconciliation = z.infer<
  typeof workerPoolReconciliationSchema
>;
export type WorkerPoolRegistration = z.infer<
  typeof workerPoolRegistrationSchema
>;
export type WorkerPoolRegistrationTokenRequest = z.infer<
  typeof workerPoolRegistrationTokenRequestSchema
>;
export type WorkerPoolRedemptionRequest = z.infer<
  typeof workerPoolRedemptionSchema
>;
