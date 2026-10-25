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
 * NOTHING HERE IDENTIFIES THE WORK, BUT TO ITS OWNER'S MACHINE. `assignment` is
 * opaque because a pool that could read an execution identity would learn the
 * tenant's ticket structure, and capability tokens are opaque because a pool
 * may translate one into a node selector, a scheduler constraint, or nothing.
 * A member's personal runner is told one thing more, each job's project, in
 * the tenant its registration names: it is its owner's machine, where that
 * job's own shells are told the project already, by the core's
 * `workerJobVariables`. A project's pool is told none, since its registration
 * names its project.
 */

import { z } from "zod";

import { workerImageFaults } from "./workerEnvironment.ts";

export const workerPoolTokenCharsMax = 63;
export const workerPoolIdentityCharsMax = 256;
export const workerPoolCapabilitiesMax = 64;
export const workerPoolEvidenceCharsMax = 4_096;
/** The longest image reference an assignment names. */
export const workerImageCharsMax = 512;

/**
 * A capability token, free-form and per-project: what a pool declares and
 * what a requirement names, in one grammar, so a token a task can require is a
 * token a pool can declare. A declaration is a claim rather than a proof,
 * accepted knowingly because a project's owner knows the pools it registered
 * and decides how each meets the tokens it declares.
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

/** The image an assignment names, by the host a pool pulls it from. */
const workerPoolImageSchema = z.string().min(1).max(workerImageCharsMax);

/** The project an assignment names, held to the bound of every other name on the wire. */
const workerPoolProjectSchema = z
  .string()
  .min(1)
  .max(workerPoolIdentityCharsMax);

export const workerPoolAssignmentSchema = z.strictObject({
  /** The idempotency key and the cancel handle in one. */
  assignment: workerPoolAssignmentIdentitySchema,
  capabilities: workerPoolCapabilitiesSchema,
  /**
   * The image the execution's requirement pinned, which is the image the
   * workload runs, and the pool obtains it. It is absent where the
   * requirement names capabilities rather than an image, and the pool meets
   * them however its owner arranged: in an image of its own, or on its host.
   */
  image: workerPoolImageSchema.optional(),
  /**
   * The site's runtime image, by the host a pool pulls it from, which a job's
   * container mounts read-only at `workerRuntimeDirectory` and starts through
   * `workerJobCommand`. It is absent where the plane hands out no runtime, and
   * the workload runs its image's own entrypoint.
   */
  runtime: workerPoolImageSchema.optional(),
  /**
   * The project of a job a member's personal runner is assigned, in the
   * tenant its registration names, by which the job mounts its owner's
   * volumes scoped per project. It is absent for a project's pool, whose
   * registration names its own.
   */
  project: workerPoolProjectSchema.optional(),
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
 * An assignment that runs one of a project's agent sessions: the same shape,
 * its image always named, because a session runs its site's session image and
 * never one a pool chooses, no runtime, because that image carries its own,
 * and no project, because a session mounts none of its owner's volumes. Its
 * bearer is the session's own, which the same bound admits.
 */
export const workerPoolSessionAssignmentSchema = workerPoolAssignmentSchema
  .omit({ runtime: true, project: true })
  .extend({ image: workerPoolImageSchema });

/**
 * Both kinds of no are final for the assignment: a refusal becomes the attempt's
 * evidence and blocks its execution, and an unavailable concludes it as a failed
 * process. A pool asks for only the work it has room for, through the poll.
 */
export const assignmentOutcomeSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("Accepted") }),
  z.strictObject({
    outcome: z.literal("Refused"),
    evidence: z.string().min(1).max(workerPoolEvidenceCharsMax),
    /** Which of `workerImageFaults` stopped a job's image running it, where one did, beside the evidence a person reads. */
    fault: z.enum(workerImageFaults).optional(),
  }),
  z.strictObject({ outcome: z.literal("Unavailable") }),
]);

/**
 * The poll, which is the one call a pool makes for work: a GET at this path
 * whose query is `workerPoolPollQuerySchema`, answered with
 * `workerPoolReconciliationSchema`. Every lease the query names is renewed by
 * the call, so a pool that stops making it is a pool whose work is lost.
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

/** The poll's query parameters by name, `held` repeated once per assignment and each room named at most once. */
export const workerPoolPollQuery = {
  held: "held",
  wanted: "wanted",
  wantedSessions: "wantedSessions",
} as const;

/** A count as a query string carries one: decimal, canonical, and within what a number can hold. */
const workerPoolQueryCountSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)$/u)
  .transform(Number)
  .pipe(z.number().int().nonnegative().safe());

/**
 * The poll's query as the plane reads it: `held`, the assignments of either
 * kind the pool is still running, repeated or single or absent as a query
 * carries a list, `wanted`, how many more executions it has room for now, and
 * `wantedSessions`, how many more sessions, which is none where it is absent.
 * The held list's length is the plane's own setting rather than a figure
 * written here, and a list longer than that is refused whole rather than cut,
 * because a cut list reads as a pool that let go of work it is still running;
 * the plane bounds each room by its own settings and never exceeds it, and a
 * pool sending zero is still answered with what it must stop.
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
    [workerPoolPollQuery.wantedSessions]: workerPoolQueryCountSchema.default(0),
  });
}

/**
 * The header a runner names itself in on its poll, as `<package>/<version>`:
 * the package it is installed as and the version it runs. A poll without it,
 * or with one `workerRunnerOf` does not read, names no runner and is served
 * as one that names none, never refused.
 */
export const workerRunnerHeader = "chuggy-runner";

/** A runner's package, named as npm names a package without a scope. */
export const workerRunnerPackageSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,62}$/u);

/** A runner's version: a plain release, its major, minor and patch each written without a leading zero, with no prerelease and no build. */
export const workerRunnerVersionSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/u);

/** The runner a poll names. */
export const workerRunnerSchema = z.strictObject({
  package: workerRunnerPackageSchema,
  version: workerRunnerVersionSchema,
});

/** The runner `header` names, or nothing where it is absent or is not `<package>/<version>`. */
export function workerRunnerOf(
  header: string | undefined,
): WorkerRunner | undefined {
  const at = header === undefined ? -1 : header.indexOf("/");
  if (header === undefined || at < 0) return undefined;
  const read = workerRunnerSchema.safeParse({
    package: header.slice(0, at),
    version: header.slice(at + 1),
  });
  return read.success ? read.data : undefined;
}

/** The longest address a runner's release is fetched from. */
export const workerRunnerReleaseUrlCharsMax = 2_048;

/**
 * A release of a runner's package: its version, the address its tarball is
 * fetched from, and the integrity of that tarball's bytes as npm writes a
 * sha512 one.
 */
export const workerRunnerReleaseSchema = workerRunnerSchema.extend({
  url: z.url().startsWith("https://").max(workerRunnerReleaseUrlCharsMax),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/u),
});

/**
 * What a poll is answered with: the executions and the sessions the pool may
 * now place, and the assignments of either kind it must stop. Each list is as
 * long as the plane's own bounds allow and no longer, so a reader bounds the
 * body it takes in.
 */
export const workerPoolReconciliationSchema = z.strictObject({
  assignments: z.array(workerPoolAssignmentSchema),
  sessions: z.array(workerPoolSessionAssignmentSchema),
  stop: z.array(workerPoolAssignmentIdentitySchema),
  /**
   * The release chuggy pins for the package the poll's runner named, whatever
   * version that runner runs, and the runner decides whether to install it.
   * It is absent where the poll named no runner or none is pinned for its package.
   */
  release: workerRunnerReleaseSchema.optional(),
});

export const workerPoolRegistrationSchema = z.strictObject({
  pool: z.string().min(1).max(workerPoolIdentityCharsMax),
  capabilities: workerPoolCapabilitiesSchema,
});

/**
 * @deprecated No endpoint reads this. A mint takes
 * `registrationTokenRequestSchema` from `src/contract/requests.ts`, and a
 * token carries no capabilities.
 */
export const workerPoolRegistrationTokenRequestSchema = z.strictObject({
  capabilities: workerPoolCapabilitiesSchema,
  lifetimeSecs: z.number().int().positive().safe(),
});

/**
 * What an operator redeems with: the token, the name the pool takes, and the
 * capabilities it declares.
 */
export const workerPoolRedemptionSchema = z.strictObject({
  token: z.string().min(1).max(workerPoolIdentityCharsMax),
  pool: z.string().min(1).max(workerPoolIdentityCharsMax),
  capabilities: workerPoolCapabilitiesSchema,
});

export type WorkerPoolAssignment = z.infer<typeof workerPoolAssignmentSchema>;
export type WorkerPoolSessionAssignment = z.infer<
  typeof workerPoolSessionAssignmentSchema
>;
export type AssignmentOutcome = z.infer<typeof assignmentOutcomeSchema>;
export type WorkerPoolReconciliation = z.infer<
  typeof workerPoolReconciliationSchema
>;
export type WorkerRunner = z.infer<typeof workerRunnerSchema>;
export type WorkerRunnerRelease = z.infer<typeof workerRunnerReleaseSchema>;
export type WorkerPoolRegistration = z.infer<
  typeof workerPoolRegistrationSchema
>;
/** @deprecated As `workerPoolRegistrationTokenRequestSchema`. */
export type WorkerPoolRegistrationTokenRequest = z.infer<
  typeof workerPoolRegistrationTokenRequestSchema
>;
export type WorkerPoolRedemptionRequest = z.infer<
  typeof workerPoolRedemptionSchema
>;
