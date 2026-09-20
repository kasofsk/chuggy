/**
 * `WorkerPoolPlane` over the plane's own two calls, which is the whole of what
 * a third party would have to implement.
 *
 * THE STATUS LINE IS THE TAXONOMY AND THIS MODULE ONLY READS IT. The plane
 * already separates a token it rejected, a caller it does not serve and an
 * authority it could not ask, and its status is the whole of each answer;
 * nothing here re-decides that, and nothing here retries — a pass is what
 * comes back.
 *
 * A MALFORMED ANSWER IS AN OUTAGE AND NOT A DENIAL. An assignment this side
 * cannot parse is a plane this client cannot work with, which is a condition an
 * operator resolves; reading it as a refusal would have the pool delete itself
 * over a version skew.
 *
 * THE POLL'S DEADLINE IS THE OPERATOR'S TO SIZE. It is a long poll, so a
 * timeout shorter than the plane's own wait turns every idle window into an
 * outage; it is configured rather than derived because the plane's wait is the
 * plane's configuration and this process cannot read it.
 */

import {
  workerPoolPollQuery,
  workerPoolPollRoute,
  workerPoolReconciliationSchema,
  workerPoolSettlementPath,
  type AssignmentOutcome,
} from "../../contract/workerPool.ts";
import type {
  WorkerPoolPlane,
  WorkerPoolPolled,
  WorkerPoolSettled,
} from "../../interpreter/workerPoolClient.ts";
import { boundedResponseBytes } from "./boundedResponse.ts";

/** The most one reconciliation may weigh, which is orders above a bounded batch of assignments. */
export const poolPlaneAnswerBytesMax = 1024 * 1024;

/** How many chunks that much may arrive in, which is what ends a body yielding empty ones. */
const poolPlaneAnswerReadsMax = 1_024;

/**
 * The plane's answer as text, or nothing where it was larger than a
 * reconciliation is or could not be read at all. A bound passed is this
 * client's own refusal rather than a message from the plane, so it travels back
 * as the absence the caller reads as an outage.
 */
async function poolPlaneAnswerText(
  answered: Response,
): Promise<string | undefined> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await boundedResponseBytes(
        answered,
        poolPlaneAnswerBytesMax,
        poolPlaneAnswerReadsMax,
      ),
    );
  } catch {
    return undefined;
  }
}

export interface PoolPlaneClientSettings {
  readonly baseUrl: string;
  readonly pollTimeoutMs: number;
  readonly settleTimeoutMs: number;
}

export function checkedPoolPlaneClientSettings(
  input: PoolPlaneClientSettings,
): PoolPlaneClientSettings {
  const url = new URL(
    input.baseUrl.endsWith("/") ? input.baseUrl : `${input.baseUrl}/`,
  );
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new RangeError("pool plane URL must be HTTP or HTTPS");
  if (url.username !== "" || url.password !== "")
    throw new RangeError("pool plane URL must carry no credentials");
  for (const [name, bound] of [
    ["poll", input.pollTimeoutMs],
    ["settle", input.settleTimeoutMs],
  ] as const)
    if (!Number.isSafeInteger(bound) || bound < 1)
      throw new RangeError(
        `pool plane ${name} timeout must be a positive integer`,
      );
  return { ...input, baseUrl: url.toString() };
}

/**
 * One of the plane's routes under this pool's base address. The contract spells
 * a route from the plane's root, and the base may carry a prefix of its own, so
 * the route is joined beneath it rather than replacing its path.
 */
function poolPlaneUrl(settings: PoolPlaneClientSettings, route: string): URL {
  return new URL(route.replace(/^\//u, ""), settings.baseUrl);
}

/** The poll's address, the held list repeated as the plane reads it. */
function poolPlaneAssignmentsUrl(
  settings: PoolPlaneClientSettings,
  held: readonly string[],
): URL {
  const url = poolPlaneUrl(settings, workerPoolPollRoute);
  for (const assignment of held)
    url.searchParams.append(workerPoolPollQuery.held, assignment);
  return url;
}

/** What each refusing status means to a pool, read from the status alone. */
function poolPlaneRefusal(
  status: number,
): Exclude<WorkerPoolPolled, { polled: "Reconciled" }> {
  if (status === 401) return { polled: "Stale" };
  if (status === 404)
    return { polled: "Denied", evidence: "the plane serves no such pool" };
  if (status === 400)
    return {
      polled: "Denied",
      evidence: "the plane refused this pool's own request",
    };
  return {
    polled: "Unavailable",
    evidence: `the plane answered ${String(status)}`,
  };
}

async function poolPlaneReconciled(
  answered: Response,
): Promise<WorkerPoolPolled> {
  const text = await poolPlaneAnswerText(answered);
  if (text === undefined)
    return {
      polled: "Unavailable",
      evidence: "the plane answered more than a reconciliation",
    };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { polled: "Unavailable", evidence: "the plane answered no JSON" };
  }
  const read = workerPoolReconciliationSchema.safeParse(parsed);
  return read.success
    ? {
        polled: "Reconciled",
        assignments: read.data.assignments,
        stop: read.data.stop,
      }
    : {
        polled: "Unavailable",
        evidence: "the plane answered no reconciliation this pool can read",
      };
}

async function poolPlanePolled(
  settings: PoolPlaneClientSettings,
  fetcher: typeof fetch,
  token: string,
  held: readonly string[],
): Promise<WorkerPoolPolled> {
  let answered: Response;
  try {
    answered = await fetcher(poolPlaneAssignmentsUrl(settings, held), {
      method: "GET",
      signal: AbortSignal.timeout(settings.pollTimeoutMs),
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
  } catch {
    return {
      polled: "Unavailable",
      evidence: "the plane could not be reached",
    };
  }
  return answered.status === 200
    ? poolPlaneReconciled(answered)
    : poolPlaneRefusal(answered.status);
}

/** What a settlement carries beyond its path, which is nothing at all for an acceptance. */
function poolPlaneOutcomeBody(outcome: AssignmentOutcome): string {
  switch (outcome.outcome) {
    case "Accepted":
      return "{}";
    case "Refused":
      return JSON.stringify({ evidence: outcome.evidence });
    case "Unavailable":
      return JSON.stringify({ retryAfterSecs: outcome.retryAfterSecs });
  }
}

function poolPlaneSettlement(status: number): WorkerPoolSettled {
  if (status === 204) return "Settled";
  if (status === 409) return "Lost";
  if (status === 401) return "Stale";
  if (status === 404 || status === 400) return "Denied";
  return "Unavailable";
}

async function poolPlaneSettled(
  settings: PoolPlaneClientSettings,
  fetcher: typeof fetch,
  token: string,
  assignment: string,
  outcome: AssignmentOutcome,
): Promise<WorkerPoolSettled> {
  const url = poolPlaneUrl(
    settings,
    workerPoolSettlementPath(outcome.outcome, assignment),
  );
  try {
    const answered = await fetcher(url, {
      method: "POST",
      signal: AbortSignal.timeout(settings.settleTimeoutMs),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: poolPlaneOutcomeBody(outcome),
    });
    return poolPlaneSettlement(answered.status);
  } catch {
    return "Unavailable";
  }
}

export function poolPlaneClient(
  input: PoolPlaneClientSettings,
  fetcher: typeof fetch = fetch,
): WorkerPoolPlane {
  const settings = checkedPoolPlaneClientSettings(input);
  return {
    poll: (token, held) => poolPlanePolled(settings, fetcher, token, held),
    settle: (token, assignment, outcome) =>
      poolPlaneSettled(settings, fetcher, token, assignment, outcome),
  };
}
