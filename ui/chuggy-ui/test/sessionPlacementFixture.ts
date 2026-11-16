/**
 * One project's session placement as the read answers it: where threads run,
 * the runners a thread would wait on, and the lead and offering it answers as
 * fixed values. Every part a case does not name runs on runners that are live,
 * so the case's own term is the one that moves what is drawn.
 */

import type { SessionPlacementResponse } from "../../../src/contract/responses.ts";
import type {
  PlacementRoute,
  SessionRunnerStanding,
} from "../../../src/contract/rosters.ts";

export function sessionPlacementBody(
  input: {
    readonly thread?: PlacementRoute;
    readonly mine?: SessionRunnerStanding;
    readonly inquiry?: SessionRunnerStanding;
    readonly project?: SessionRunnerStanding;
  } = {},
): SessionPlacementResponse {
  return {
    thread: { route: input.thread ?? "Pool", source: "Default" },
    lead: { route: "InCluster", source: "Default" },
    leadOffering: "Own",
    leadOfferings: ["Own"],
    choices: ["Pool"],
    runners: {
      mine: input.mine ?? "Live",
      inquiry: input.inquiry ?? "Live",
      project: input.project ?? "Live",
    },
  };
}
