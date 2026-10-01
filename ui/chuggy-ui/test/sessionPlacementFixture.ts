/**
 * One project's session placement as the read answers it: where threads and
 * the lead run, and the runners each would wait on. Every part a case does not
 * name runs on runners that are live, so the case's own term is the one that
 * moves what is drawn.
 */

import type { SessionPlacementResponse } from "../../../src/contract/responses.ts";
import type {
  PlacementRoute,
  SessionRunnerStanding,
} from "../../../src/contract/rosters.ts";

export function sessionPlacementBody(
  input: {
    readonly thread?: PlacementRoute;
    readonly lead?: PlacementRoute;
    readonly mine?: SessionRunnerStanding;
    readonly project?: SessionRunnerStanding;
  } = {},
): SessionPlacementResponse {
  return {
    thread: { route: input.thread ?? "Pool", source: "Default" },
    lead: { route: input.lead ?? "Pool", source: "Default" },
    choices: ["Pool"],
    runners: { mine: input.mine ?? "Live", project: input.project ?? "Live" },
  };
}
