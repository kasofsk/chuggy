/**
 * The far side of the wire: what a registered pool does, with no backend and no
 * transport of its own.
 *
 * IT IS STATELESS BETWEEN PASSES. What the pool holds is asked of the backend
 * at the top of every pass rather than remembered here, so a restarted client
 * recovers the workloads its predecessor placed instead of orphaning them and
 * claiming more beside them. That is the whole reason `held` is a backend
 * operation and not a field: an in-process list is a second account of what is
 * running, and the process that owns it is the one that just died. Nor is the
 * token held here: the issuer port holds its grant, every pass asks it, and a
 * token the plane rejects is told back to it through `invalidate`.
 *
 * EVERY FAILURE PARTS THE SAME WAY, AND NONE OF THE REMEDIES IS A
 * RETRY-EVERYTHING LOOP. A token the issuer refuses and a token it could not
 * mint are different answers; so are a plane that rejected this pool and a
 * plane that was unreachable, and so are a fabric that refused a stop and a
 * fabric that was not there to take one. A denial stops the client, because a
 * pool told it is not a pool learns nothing by asking again; an outage backs
 * off and comes back.
 *
 * A PLACEMENT NOBODY ACKNOWLEDGED IS NOT LOST. An accepted assignment is
 * already claimed and already leased by the poll that offered it, so the accept
 * post confirms and writes nothing; a post that fails leaves a workload the
 * next pass reads back out of the backend and carries in its `held` list, which
 * is what renews its lease. Nothing here retries a settlement, because the
 * lease is the retry.
 *
 * A JOB AND A SESSION ARE COUNTED APART. Each kind has its own ceiling, its own
 * room on the poll and its own offers, and a pool that names no session ceiling
 * asks for none. This is chuggy-common's `poolLoop.mjs` in TypeScript, and a
 * change to one is a change to both, except that only a session's unreported
 * end is reported here: a job's is left to its lease.
 */
import type { SessionContainerEnd } from "../contract/rosters.ts";
import type {
  AssignmentOutcome,
  WorkerPoolAssignment,
  WorkerPoolSessionAssignment,
} from "../contract/workerPool.ts";

export type WorkerPoolWorkloadKind = "Job" | "Session";

/** One workload a backend runs, with the kind it was placed as. */
export interface WorkerPoolHeld {
  readonly assignment: string;
  readonly kind: WorkerPoolWorkloadKind;
}

/** One offer, with the kind it was offered as. */
export type WorkerPoolOffer =
  | { readonly kind: "Job"; readonly assignment: WorkerPoolAssignment }
  | {
      readonly kind: "Session";
      readonly assignment: WorkerPoolSessionAssignment;
    };

/** A session whose container ended, which only the pool holding it sees: `Succeeded` for a clean exit, `Failed` for any other. */
export interface WorkerPoolSessionEnd {
  readonly kind: "Session";
  readonly session: Pick<
    WorkerPoolSessionAssignment,
    "assignment" | "callbackUrl" | "bearer"
  >;
  readonly phase: SessionContainerEnd;
}

/** What placing one assignment came to, which is the contract's outcome before it is posted. */
export type WorkerPoolPlacement =
  | { readonly placed: "Placed" }
  | { readonly placed: "Refused"; readonly evidence: string }
  | { readonly placed: "Unavailable" };

/**
 * What stopping one assignment came to, which parts the same two inabilities a
 * placement does. A fabric that refused the stop will refuse it again, and a
 * fabric that could not be reached is this moment rather than an answer.
 */
export type WorkerPoolStopped =
  | { readonly stopped: "Stopped" }
  | { readonly stopped: "Refused"; readonly evidence: string }
  | { readonly stopped: "Unavailable"; readonly evidence: string };

/**
 * The operations a backend answers, `held` and `ended` being the ones the
 * contract has no member for. Both are derived from the backend rather than
 * from this process, so what is running is read from where it is running.
 */
export interface WorkerPoolBackend {
  place(offer: WorkerPoolOffer): Promise<WorkerPoolPlacement>;
  /** Idempotent, whichever kind it is. */
  stop(assignment: string): Promise<WorkerPoolStopped>;
  held(): Promise<readonly WorkerPoolHeld[]>;
  /** Each session once, after `held` stopped naming it, and never one this pool stopped. */
  ended(): Promise<readonly WorkerPoolSessionEnd[]>;
}

/**
 * What one poll came to. `Stale` is a token this side should replace and
 * `Denied` is a pool the plane will not serve, which is the distinction the
 * plane itself draws between its 401 and its 404.
 */
export type WorkerPoolPolled =
  | {
      readonly polled: "Reconciled";
      readonly assignments: readonly WorkerPoolAssignment[];
      readonly sessions: readonly WorkerPoolSessionAssignment[];
      readonly stop: readonly string[];
    }
  | { readonly polled: "Stale" }
  | { readonly polled: "Denied"; readonly evidence: string }
  | { readonly polled: "Unavailable"; readonly evidence: string };

/**
 * What posting one settlement came to. `Lost` is the plane saying this pool no
 * longer holds the assignment, which is the same news a stop flag carries.
 */
export type WorkerPoolSettled =
  "Settled" | "Lost" | "Stale" | "Denied" | "Unavailable";

/** The plane's two calls as a pool makes them, each one carrying the token it currently holds. */
export interface WorkerPoolPlane {
  poll(
    token: string,
    held: readonly string[],
    wanted: number,
    wantedSessions: number,
  ): Promise<WorkerPoolPolled>;
  settle(
    token: string,
    assignment: string,
    outcome: AssignmentOutcome,
  ): Promise<WorkerPoolSettled>;
}

/** What reporting an end came to; `Refused` is an attempt no longer live, or one the plane refused to end. */
export type WorkerPoolEndAnswer = "Ended" | "Refused" | "Unavailable";

/** The session plane as a pool reaches it, under each session's own bearer. */
export interface WorkerPoolSessionPlane {
  end(ended: WorkerPoolSessionEnd): Promise<WorkerPoolEndAnswer>;
}

/**
 * What asking the issuer for a token came to. A refused client and an issuer
 * that could not be reached are kept apart for the reason the plane keeps its
 * own two apart: only the second is worth asking again.
 */
export type WorkerPoolTokenAcquired =
  | { readonly acquired: "Token"; readonly token: string }
  | { readonly acquired: "Denied"; readonly evidence: string }
  | { readonly acquired: "Unavailable"; readonly evidence: string };

/**
 * Where a pool's own credential becomes a token, which is the issuer and never
 * the plane. The port holds the grant, so `acquire` is asked every pass and
 * `invalidate` is how a token the plane rejected is discarded before its
 * stated expiry.
 */
export interface WorkerPoolTokens {
  acquire(): Promise<WorkerPoolTokenAcquired>;
  invalidate(token: string): void;
}

export interface WorkerPoolClientSettings {
  /** How many assignments this pool holds at once, which every poll's `wanted` is measured from. */
  readonly concurrencyMax: number;
  /** How many sessions it holds at once, which every poll's `wantedSessions` is measured from; none where absent. */
  readonly sessionsMax?: number;
  /** How long a pass waits after an outage before the next one. */
  readonly outageBackoffMs: number;
  /** How many passes one run makes, so the loop is bounded like every other. */
  readonly passesMax: number;
}

/** What one pass came to, which is what the run loop decides the next one by. */
export type WorkerPoolPass =
  | {
      readonly passed: "Reconciled";
      readonly placed: number;
      readonly stopped: number;
      readonly refused: number;
      readonly ended: number;
    }
  | { readonly passed: "Denied"; readonly evidence: string }
  | { readonly passed: "Unavailable"; readonly evidence: string };

/** Everything one running client is, which is its ports and its bounds. */
export interface WorkerPoolClient {
  readonly tokens: WorkerPoolTokens;
  readonly plane: WorkerPoolPlane;
  /** Where a session's end is reported, which a pool with a session ceiling must have. */
  readonly sessions?: WorkerPoolSessionPlane;
  readonly backend: WorkerPoolBackend;
  readonly settings: WorkerPoolClientSettings;
}

export function checkedWorkerPoolClientSettings(
  settings: WorkerPoolClientSettings,
): WorkerPoolClientSettings {
  for (const [name, bound] of [
    ["concurrencyMax", settings.concurrencyMax],
    ["outageBackoffMs", settings.outageBackoffMs],
    ["passesMax", settings.passesMax],
  ] as const)
    if (!Number.isSafeInteger(bound) || bound <= 0)
      throw new RangeError(
        `worker pool client ${name} must be a positive safe integer`,
      );
  const { sessionsMax } = settings;
  if (
    sessionsMax !== undefined &&
    (!Number.isSafeInteger(sessionsMax) || sessionsMax < 0)
  )
    throw new RangeError(
      "worker pool client sessionsMax must be a safe integer of zero or more, or absent",
    );
  return settings;
}

function workerPoolClientCeiling(
  settings: WorkerPoolClientSettings,
  kind: WorkerPoolWorkloadKind,
): number {
  return kind === "Session"
    ? (settings.sessionsMax ?? 0)
    : settings.concurrencyMax;
}

/** How many of a kind are running, less those this pass has stopped. */
function workerPoolClientRunning(
  held: readonly WorkerPoolHeld[],
  kind: WorkerPoolWorkloadKind,
  stopped: readonly string[],
): number {
  return held.filter(
    (workload) =>
      workload.kind === kind && !stopped.includes(workload.assignment),
  ).length;
}

/** The room a poll asks for of a kind: its ceiling less what is running. */
function workerPoolClientRoom(
  settings: WorkerPoolClientSettings,
  held: readonly WorkerPoolHeld[],
  kind: WorkerPoolWorkloadKind,
): number {
  return Math.max(
    workerPoolClientCeiling(settings, kind) -
      workerPoolClientRunning(held, kind, []),
    0,
  );
}

/**
 * The plane a session's end is reported on, which a pool with a session
 * ceiling must have. It is checked by the pass rather than with the settings,
 * because settings are checked before the client they go into exists.
 */
function workerPoolClientSessionPlane(
  client: WorkerPoolClient,
): WorkerPoolSessionPlane | undefined {
  if (
    workerPoolClientCeiling(client.settings, "Session") > 0 &&
    client.sessions === undefined
  )
    throw new TypeError(
      "worker pool client sessionsMax is above zero with no session plane to end a session on",
    );
  return client.sessions;
}

/**
 * Ends each session whose container ended unreported, counting the ends the
 * plane took. One it did not take is left to its lease.
 */
async function workerPoolClientEnded(
  client: WorkerPoolClient,
  sessions: WorkerPoolSessionPlane | undefined,
): Promise<number> {
  const ended = await client.backend.ended();
  if (ended.length > 0 && sessions === undefined)
    throw new TypeError(
      "a backend ended a session with no session plane to end it on",
    );
  let taken = 0;
  for (const workload of ended)
    if ((await sessions?.end(workload)) === "Ended") taken += 1;
  return taken;
}

/**
 * The token this pass acts under, asked of the issuer port each time. A denial
 * and an outage travel back as themselves rather than as a missing token.
 */
async function workerPoolClientToken(
  client: WorkerPoolClient,
): Promise<
  { readonly token: string } | Exclude<WorkerPoolPass, { passed: "Reconciled" }>
> {
  const acquired = await client.tokens.acquire();
  if (acquired.acquired === "Denied")
    return { passed: "Denied", evidence: acquired.evidence };
  if (acquired.acquired === "Unavailable")
    return { passed: "Unavailable", evidence: acquired.evidence };
  return { token: acquired.token };
}

/**
 * Stops everything the plane flagged, one call each and each one idempotent. A
 * fabric that could not be reached ends the pass before it places anything, so
 * this pool takes on nothing new while work it was told to abandon is still
 * running; a fabric that refused the stop ends the run, because a pool that
 * kept polling would keep renewing the lease of work it cannot abandon and no
 * later pass would be answered differently.
 */
async function workerPoolClientStopped(
  client: WorkerPoolClient,
  stop: readonly string[],
): Promise<
  | { readonly stopped: number }
  | Exclude<WorkerPoolPass, { passed: "Reconciled" }>
> {
  let stopped = 0;
  for (const assignment of stop) {
    const outcome = await client.backend.stop(assignment);
    if (outcome.stopped === "Refused")
      return { passed: "Denied", evidence: outcome.evidence };
    if (outcome.stopped === "Unavailable")
      return { passed: "Unavailable", evidence: outcome.evidence };
    stopped += 1;
  }
  return { stopped };
}

/** The outcome one placement is reported as, which is the placement itself in the contract's words. */
function workerPoolClientOutcome(
  placement: WorkerPoolPlacement,
): AssignmentOutcome {
  switch (placement.placed) {
    case "Placed":
      return { outcome: "Accepted" };
    case "Refused":
      return { outcome: "Refused", evidence: placement.evidence };
    case "Unavailable":
      return { outcome: "Unavailable" };
  }
}

/** What one pass counted, accumulated across the assignments it was offered. */
interface WorkerPoolTally {
  placed: number;
  refused: number;
}

/**
 * Places what there is room for of one kind and answers `Unavailable` for the
 * rest. The poll asked for no more than the room there was, so the rest is a
 * plane that offered past what it was asked, and room is the kind's ceiling
 * less what is running of it and what this pass has placed of it.
 */
async function workerPoolClientPlaced(
  client: WorkerPoolClient,
  token: string,
  offered: readonly WorkerPoolOffer[],
  running: number,
): Promise<WorkerPoolTally> {
  const tally: WorkerPoolTally = { placed: 0, refused: 0 };
  for (const offer of offered) {
    const placement: WorkerPoolPlacement =
      running + tally.placed <
      workerPoolClientCeiling(client.settings, offer.kind)
        ? await client.backend.place(offer)
        : { placed: "Unavailable" };
    if (placement.placed === "Placed") tally.placed += 1;
    if (placement.placed === "Refused") tally.refused += 1;
    const settled = await client.plane.settle(
      token,
      offer.assignment.assignment,
      workerPoolClientOutcome(placement),
    );
    if (settled === "Stale") client.tokens.invalidate(token);
  }
  return tally;
}

/**
 * One reconciliation pass: read what is running, report what ended before a
 * poll that may wait on the plane, poll for the room that leaves, stop what
 * must stop, place what was offered. The room is asked before the stops are
 * known, so it is what the backend holds against each ceiling and a stop this
 * pass delivers frees room the next pass asks for.
 */
export async function workerPoolClientPass(
  client: WorkerPoolClient,
): Promise<WorkerPoolPass> {
  const sessions = workerPoolClientSessionPlane(client);
  const minted = await workerPoolClientToken(client);
  if (!("token" in minted)) return minted;
  const held = await client.backend.held();
  const ended = await workerPoolClientEnded(client, sessions);
  const polled = await client.plane.poll(
    minted.token,
    held.map(({ assignment }) => assignment),
    workerPoolClientRoom(client.settings, held, "Job"),
    workerPoolClientRoom(client.settings, held, "Session"),
  );
  if (polled.polled === "Stale") {
    client.tokens.invalidate(minted.token);
    return { passed: "Unavailable", evidence: "the pool token was rejected" };
  }
  if (polled.polled !== "Reconciled")
    return { passed: polled.polled, evidence: polled.evidence };
  const stopped = await workerPoolClientStopped(client, polled.stop);
  if ("passed" in stopped) return stopped;
  const jobs = await workerPoolClientPlaced(
    client,
    minted.token,
    polled.assignments.map((assignment) => ({ kind: "Job", assignment })),
    workerPoolClientRunning(held, "Job", polled.stop),
  );
  const placedSessions = await workerPoolClientPlaced(
    client,
    minted.token,
    polled.sessions.map((assignment) => ({ kind: "Session", assignment })),
    workerPoolClientRunning(held, "Session", polled.stop),
  );
  return {
    passed: "Reconciled",
    placed: jobs.placed + placedSessions.placed,
    stopped: stopped.stopped,
    refused: jobs.refused + placedSessions.refused,
    ended,
  };
}

/**
 * The client's whole loop, bounded by `passesMax` so a run has an end a test
 * can reach. A denial ends it early, because nothing the next pass could do
 * would be different.
 */
export async function workerPoolClientRun(
  client: WorkerPoolClient,
  sleep: (ms: number) => Promise<void>,
): Promise<WorkerPoolPass> {
  checkedWorkerPoolClientSettings(client.settings);
  let last: WorkerPoolPass = {
    passed: "Reconciled",
    placed: 0,
    stopped: 0,
    refused: 0,
    ended: 0,
  };
  for (let pass = 0; pass < client.settings.passesMax; pass += 1) {
    last = await workerPoolClientPass(client);
    if (last.passed === "Denied") return last;
    if (last.passed === "Unavailable")
      await sleep(client.settings.outageBackoffMs);
  }
  return last;
}
