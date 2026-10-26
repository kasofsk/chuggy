/**
 * `WorkerPoolJobPlane` over the worker plane's two calls a pool makes for a
 * job its backend killed: leaving the error text its harness never wrote, then
 * ending its run, each under the job's own bearer, so the attempt ends when its
 * workload did rather than when its lease runs out. The text goes first because
 * only a live attempt takes it, and the end is asked for either way.
 *
 * Each call is made once and never retried here, because a job's backend
 * names an end the plane did not answer again on the next pass. An attempt
 * that already reported is no longer live, so the plane refuses a repeat and
 * that report stands.
 *
 * A REFUSAL IS THE PLANE'S ONLY WHERE IT NAMES THE PLANE'S RELEASE. A proxy in
 * front of a plane with no process ready answers a 404 of its own, and an end
 * read as refused is cleared from its backend, so a 4xx naming no release is
 * an outage, as it is to the pool plane's client.
 */

import { workerErrorPath } from "../../contract/http.ts";
import type { RunEndedEvidence } from "../../contract/rosters.ts";
import {
  workerContractHeader,
  workerContractRelease,
} from "../../contract/workerContract.ts";
import {
  workerPlaneBytesMediaType,
  workerPlaneRoutes,
  workerRunEndedSchema,
} from "../../contract/workerPlane.ts";
import type {
  WorkerPoolEndAnswer,
  WorkerPoolJobEnd,
  WorkerPoolJobPlane,
} from "../../interpreter/workerPoolClient.ts";
import { poolPlaneAnswered } from "./poolPlaneClient.ts";

export interface PoolJobPlaneClientSettings {
  readonly timeoutMs: number;
}

/** The label a killed job's run ends under, for each way its backend kills one. */
const poolJobKilledEvidence = {
  Deadline: "RunTimedOut",
} as const satisfies Readonly<
  Record<WorkerPoolJobEnd["killed"], RunEndedEvidence>
>;

export function checkedPoolJobPlaneClientSettings(
  input: PoolJobPlaneClientSettings,
): PoolJobPlaneClientSettings {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1)
    throw new RangeError("pool job plane timeout must be a positive integer");
  return input;
}

/** What the plane's answer to one end means, which a session's end shares. */
export function poolEndAnswer(answered: Response): WorkerPoolEndAnswer {
  const { status } = answered;
  if (status === 204) return "Ended";
  if (status >= 400 && status < 500 && poolPlaneAnswered(answered))
    return "Refused";
  return "Unavailable";
}

/** One call to a job's plane under its bearer, answered with its body unread. */
async function poolJobPlaneCalled(
  settings: PoolJobPlaneClientSettings,
  fetcher: typeof fetch,
  ended: WorkerPoolJobEnd,
  route: { readonly method: string; readonly path: string },
  sent: { readonly contentType: string; readonly body: string | Uint8Array },
): Promise<Response> {
  const answered = await fetcher(new URL(route.path, ended.job.callbackUrl), {
    method: route.method,
    signal: AbortSignal.timeout(settings.timeoutMs),
    headers: {
      authorization: `Bearer ${ended.job.bearer}`,
      "content-type": sent.contentType,
      [workerContractHeader]: workerContractRelease,
    },
    body: sent.body,
  });
  await answered.body?.cancel();
  return answered;
}

/** Leaves a killed job's error text on its attempt, answering nothing, since its end is asked for either way. */
async function poolJobPlaneErrorLeft(
  settings: PoolJobPlaneClientSettings,
  fetcher: typeof fetch,
  ended: WorkerPoolJobEnd,
): Promise<void> {
  try {
    await poolJobPlaneCalled(
      settings,
      fetcher,
      ended,
      {
        method: workerPlaneRoutes.artifact.method,
        path: workerPlaneRoutes.artifact.path.replace("*", workerErrorPath),
      },
      {
        contentType: workerPlaneBytesMediaType,
        body: new TextEncoder().encode(ended.text),
      },
    );
  } catch {
    return;
  }
}

async function poolJobPlaneEnded(
  settings: PoolJobPlaneClientSettings,
  fetcher: typeof fetch,
  ended: WorkerPoolJobEnd,
): Promise<WorkerPoolEndAnswer> {
  await poolJobPlaneErrorLeft(settings, fetcher, ended);
  const body = JSON.stringify(
    workerRunEndedSchema.parse({
      evidence: poolJobKilledEvidence[ended.killed],
    }),
  );
  try {
    return poolEndAnswer(
      await poolJobPlaneCalled(
        settings,
        fetcher,
        ended,
        workerPlaneRoutes.runEnded,
        { contentType: "application/json", body },
      ),
    );
  } catch {
    return "Unavailable";
  }
}

export function poolJobPlaneClient(
  input: PoolJobPlaneClientSettings,
  fetcher: typeof fetch = fetch,
): WorkerPoolJobPlane {
  const settings = checkedPoolJobPlaneClientSettings(input);
  return {
    end: (ended) => poolJobPlaneEnded(settings, fetcher, ended),
  };
}
