/**
 * `WorkerPoolSessionPlane` over the session plane's one call a pool makes:
 * telling it that a session's container ended, under that session's own
 * bearer, so the attempt ends when its container did rather than when its
 * lease runs out. The call is made once, because an attempt the plane did not
 * hear about is still ended by its lease, and a refusal is final.
 */

import {
  workerContractHeader,
  workerContractRelease,
} from "../../contract/workerContract.ts";
import {
  sessionEndedSchema,
  sessionPlaneRoutes,
} from "../../contract/sessionPlane.ts";
import type {
  WorkerPoolEndAnswer,
  WorkerPoolSessionEnd,
  WorkerPoolSessionPlane,
} from "../../interpreter/workerPoolClient.ts";

export interface PoolSessionPlaneClientSettings {
  readonly timeoutMs: number;
}

export function checkedPoolSessionPlaneClientSettings(
  input: PoolSessionPlaneClientSettings,
): PoolSessionPlaneClientSettings {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1)
    throw new RangeError(
      "pool session plane timeout must be a positive integer",
    );
  return input;
}

function poolSessionEndAnswer(status: number): WorkerPoolEndAnswer {
  if (status === 204) return "Ended";
  if (status >= 400 && status < 500) return "Refused";
  return "Unavailable";
}

async function poolSessionPlaneEnded(
  settings: PoolSessionPlaneClientSettings,
  fetcher: typeof fetch,
  ended: WorkerPoolSessionEnd,
): Promise<WorkerPoolEndAnswer> {
  const body = JSON.stringify(sessionEndedSchema.parse({ phase: ended.phase }));
  try {
    const answered = await fetcher(
      new URL(sessionPlaneRoutes.ended.path, ended.session.callbackUrl),
      {
        method: sessionPlaneRoutes.ended.method,
        signal: AbortSignal.timeout(settings.timeoutMs),
        headers: {
          authorization: `Bearer ${ended.session.bearer}`,
          "content-type": "application/json",
          [workerContractHeader]: workerContractRelease,
        },
        body,
      },
    );
    await answered.body?.cancel();
    return poolSessionEndAnswer(answered.status);
  } catch {
    return "Unavailable";
  }
}

export function poolSessionPlaneClient(
  input: PoolSessionPlaneClientSettings,
  fetcher: typeof fetch = fetch,
): WorkerPoolSessionPlane {
  const settings = checkedPoolSessionPlaneClientSettings(input);
  return {
    end: (ended) => poolSessionPlaneEnded(settings, fetcher, ended),
  };
}
