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
 */
import {
  workerPoolRetryAfterSecsMax,
  type AssignmentOutcome,
  type WorkerPoolAssignment,
} from "../contract/workerPool.ts";

/** What placing one assignment came to, which is the contract's outcome before it is posted. */
export type WorkerPoolPlacement =
  | { readonly placed: "Placed" }
  | { readonly placed: "Refused"; readonly evidence: string }
  | { readonly placed: "Unavailable"; readonly retryAfterSecs: number };

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
 * The three operations a backend answers, `held` being the one the contract has
 * no member for. It is derived from the backend rather than from this process,
 * so what is running is read from where it is running.
 */
export interface WorkerPoolBackend {
  place(assignment: WorkerPoolAssignment): Promise<WorkerPoolPlacement>;
  stop(assignment: string): Promise<WorkerPoolStopped>;
  held(): Promise<readonly string[]>;
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
  ): Promise<WorkerPoolPolled>;
  settle(
    token: string,
    assignment: string,
    outcome: AssignmentOutcome,
  ): Promise<WorkerPoolSettled>;
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
  /** What a pool offered more than it asked for tells the orchestrator to wait before offering again. */
  readonly retryAfterSecs: number;
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
    }
  | { readonly passed: "Denied"; readonly evidence: string }
  | { readonly passed: "Unavailable"; readonly evidence: string };

/** Everything one running client is, which is its ports and its bounds. */
export interface WorkerPoolClient {
  readonly tokens: WorkerPoolTokens;
  readonly plane: WorkerPoolPlane;
  readonly backend: WorkerPoolBackend;
  readonly settings: WorkerPoolClientSettings;
}

export function checkedWorkerPoolClientSettings(
  settings: WorkerPoolClientSettings,
): WorkerPoolClientSettings {
  for (const [name, bound] of [
    ["concurrencyMax", settings.concurrencyMax],
    ["retryAfterSecs", settings.retryAfterSecs],
    ["outageBackoffMs", settings.outageBackoffMs],
    ["passesMax", settings.passesMax],
  ] as const)
    if (!Number.isSafeInteger(bound) || bound <= 0)
      throw new RangeError(
        `worker pool client ${name} must be a positive safe integer`,
      );
  if (settings.retryAfterSecs > workerPoolRetryAfterSecsMax)
    throw new RangeError(
      "worker pool client retryAfterSecs is past what the wire accepts",
    );
  return settings;
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
      return {
        outcome: "Unavailable",
        retryAfterSecs: placement.retryAfterSecs,
      };
  }
}

/** What one pass counted, accumulated across the assignments it was offered. */
interface WorkerPoolTally {
  placed: number;
  refused: number;
}

/**
 * Places what there is room for and answers backpressure for the rest. The poll
 * asked for no more than the room there was, so the rest is a plane that offered
 * past what it was asked, and room is measured against what the backend held at
 * the top of the pass plus what this pass has placed since.
 */
async function workerPoolClientPlaced(
  client: WorkerPoolClient,
  token: string,
  offered: readonly WorkerPoolAssignment[],
  running: number,
): Promise<WorkerPoolTally> {
  const tally: WorkerPoolTally = { placed: 0, refused: 0 };
  for (const assignment of offered) {
    const placement: WorkerPoolPlacement =
      running + tally.placed < client.settings.concurrencyMax
        ? await client.backend.place(assignment)
        : {
            placed: "Unavailable",
            retryAfterSecs: client.settings.retryAfterSecs,
          };
    if (placement.placed === "Placed") tally.placed += 1;
    if (placement.placed === "Refused") tally.refused += 1;
    const settled = await client.plane.settle(
      token,
      assignment.assignment,
      workerPoolClientOutcome(placement),
    );
    if (settled === "Stale") client.tokens.invalidate(token);
  }
  return tally;
}

/**
 * One reconciliation pass: read what is running, poll for the room that
 * leaves, stop what must stop, place what was offered. The room is asked
 * before the stops are known, so it is what the backend holds against the
 * ceiling and a stop this pass delivers frees room the next pass asks for.
 */
export async function workerPoolClientPass(
  client: WorkerPoolClient,
): Promise<WorkerPoolPass> {
  const minted = await workerPoolClientToken(client);
  if (!("token" in minted)) return minted;
  const held = await client.backend.held();
  const polled = await client.plane.poll(
    minted.token,
    held,
    Math.max(client.settings.concurrencyMax - held.length, 0),
  );
  if (polled.polled === "Stale") {
    client.tokens.invalidate(minted.token);
    return { passed: "Unavailable", evidence: "the pool token was rejected" };
  }
  if (polled.polled !== "Reconciled")
    return { passed: polled.polled, evidence: polled.evidence };
  const stopped = await workerPoolClientStopped(client, polled.stop);
  if ("passed" in stopped) return stopped;
  const tally = await workerPoolClientPlaced(
    client,
    minted.token,
    polled.assignments,
    held.length - stopped.stopped,
  );
  return {
    passed: "Reconciled",
    placed: tally.placed,
    stopped: stopped.stopped,
    refused: tally.refused,
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
  };
  for (let pass = 0; pass < client.settings.passesMax; pass += 1) {
    last = await workerPoolClientPass(client);
    if (last.passed === "Denied") return last;
    if (last.passed === "Unavailable")
      await sleep(client.settings.outageBackoffMs);
  }
  return last;
}
