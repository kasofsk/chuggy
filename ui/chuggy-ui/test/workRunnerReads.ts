/**
 * The reads a project's runner for work is decided from, as a screen's case
 * scripts them: a `fetch` that answers each as the case says and hands every
 * other request to the screen's own.
 */

import type {
  OwnerFallback,
  PlacementRoute,
  SessionRunnerStanding,
} from "../../../src/contract/rosters.ts";
import { answer } from "./screenHarness.tsx";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { executionPlacementBody } from "./workRunnerFixture.ts";

/** What a case has one of the reads answer instead of a body. */
type WorkRunnerAnswer = () => Promise<Response>;

export interface WorkRunnerReads {
  /** The runners registered to the project, or what that read answers instead. */
  readonly runners: SessionRunnerStanding | WorkRunnerAnswer;
  /** The reader's own runner, live where a case names none. */
  readonly mine?: SessionRunnerStanding;
  /** Where the project's work runs, which is to runners where a case names
   * nowhere, or what that read answers instead. */
  readonly work?: PlacementRoute | WorkRunnerAnswer;
  /** The project's owner fallback, absent where a case names none. */
  readonly fallback?: OwnerFallback;
}

/** A read that fails, answered afresh for each request. */
export function workRunnerUnreadable(): Promise<Response> {
  return Promise.resolve(answer({ error: { code: "InternalError" } }, 500));
}

/** What lays the reads over a case's own `fetch`. */
export function workRunnerOver(
  reads: WorkRunnerReads,
): (served: typeof fetch) => typeof fetch {
  const runners = reads.runners;
  const work = reads.work ?? "Pool";
  return (served) =>
    ((url: string, init?: RequestInit) => {
      if (url.endsWith("/session-placement"))
        return typeof runners === "function"
          ? runners()
          : Promise.resolve(
              answer(
                sessionPlacementBody({
                  project: runners,
                  ...(reads.mine === undefined ? {} : { mine: reads.mine }),
                }),
              ),
            );
      if (url.endsWith("/execution-placement"))
        return typeof work === "function"
          ? work()
          : Promise.resolve(answer(executionPlacementBody(work)));
      if (url.endsWith("/owner-fallback"))
        return Promise.resolve(
          answer({ fallback: reads.fallback, administers: false }),
        );
      return served(url, init);
    }) as typeof fetch;
}
