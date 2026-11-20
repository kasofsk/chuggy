/**
 * The reads a project's runner for work is decided from, as a screen's case
 * scripts them: a `fetch` that answers each as the case says and hands every
 * other request to the screen's own. The reader holds no personal runner
 * unless a case gives them one.
 */

import type { PersonalRunnerResponse } from "../../../src/contract/responses.ts";
import type {
  PlacementRoute,
  SessionRunnerStanding,
} from "../../../src/contract/rosters.ts";
import { answer } from "./screenHarness.tsx";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { executionPlacementBody } from "./workRunnerFixture.ts";

/** What a case has one of the reads answer instead of a body. */
type WorkRunnerAnswer = () => Promise<Response>;

export interface WorkRunnerReads {
  /** The reader's chat host, live where a case names none, which takes no work. */
  readonly mine?: SessionRunnerStanding;
  /** The reader's own personal runner and the project it serves, none where a
   * case names none, or what that read answers instead. */
  readonly personal?:
    { readonly live: boolean; readonly project: string } | WorkRunnerAnswer;
  /** Where the project's work runs, which is to runners where a case names
   * nowhere, or what that read answers instead. */
  readonly work?: PlacementRoute | WorkRunnerAnswer;
}

/** A read that fails, answered afresh for each request. */
export function workRunnerUnreadable(): Promise<Response> {
  return Promise.resolve(answer({ error: { code: "InternalError" } }, 500));
}

function personalRunnerBody(personal: {
  readonly live: boolean;
  readonly project: string;
}): PersonalRunnerResponse {
  return {
    runners: [
      {
        id: "runner-1",
        capabilities: ["Platform:Linux:Amd64"],
        registeredAt: "2026-10-09T00:00:00Z",
        live: personal.live,
        executionsLive: personal.live,
        held: [],
        heldTruncated: false,
      },
    ],
    projects: [
      {
        project: personal.project,
        priority: "Normal",
        waiting: 0,
        waitingTruncated: false,
      },
    ],
  };
}

/** What lays the reads over a case's own `fetch`. */
export function workRunnerOver(
  reads: WorkRunnerReads,
): (served: typeof fetch) => typeof fetch {
  const personal = reads.personal;
  const work = reads.work ?? "Pool";
  return (served) =>
    ((url: string, init?: RequestInit) => {
      if (url.endsWith("/session-placement"))
        return Promise.resolve(
          answer(
            sessionPlacementBody({
              project: "Unregistered",
              ...(reads.mine === undefined ? {} : { mine: reads.mine }),
            }),
          ),
        );
      if (url.endsWith("/execution-placement"))
        return typeof work === "function"
          ? work()
          : Promise.resolve(answer(executionPlacementBody(work)));
      if (url.endsWith("/personal-runner"))
        return typeof personal === "function"
          ? personal()
          : Promise.resolve(
              personal === undefined
                ? answer({ error: { code: "NotFound" } }, 404)
                : answer(personalRunnerBody(personal)),
            );
      return served(url, init);
    }) as typeof fetch;
}
