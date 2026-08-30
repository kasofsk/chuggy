/**
 * What the ticket page reads, as one API's answers.
 *
 * Two cases drive this screen — one clicks the dispatch button, one waits for a
 * frame to change whether there is one — and they differ in the dispatch answer
 * alone, so everything the screen reads beside it is stated once here.
 */

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { answer } from "./screenHarness.tsx";

export const ticketPageTicket = { ticket: 11, phase: "Pending", sequence: 7 };

/** The ticket the one above waits on, as the frame reporting it Done carries
 * it: the transition that makes the page's ticket a candidate. */
export const ticketPageDependency = {
  ticket: 10,
  phase: "Done",
  sequence: 8,
};

export const ticketPageCandidate = {
  ticket: 11,
  ticketVersion: 4,
  dependencies: [],
  workFanout: 1,
  program: [],
  reworkPolicy: { type: "BudgetedRework", value: 1 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryFree",
  finalizer: "NoFinalizer",
  configurationRevision: "r1",
  configurationDigest: "b".repeat(64),
  configurationCanonical: "{}",
};

/** A strict view over whichever candidates the case wants in it. */
export function ticketDispatchViewOf(
  partition: PartitionIdentity,
  candidates: readonly unknown[],
): unknown {
  return {
    result: "Page",
    token: {
      tenant: partition.tenant,
      project: partition.project,
      recoveryEpoch: "epoch",
      schemaVersion: 1,
      watermark: 7,
      digest: "a".repeat(64),
    },
    candidates,
    notificationCursor: 2,
  };
}

/** Every route the page reads, the dispatch one being the case's own. */
export function ticketPageRoutes(
  partition: PartitionIdentity,
  dispatch: () => unknown,
): (url: string) => Response {
  return (url) => {
    if (url.includes("/dispatch-view")) return answer(dispatch());
    if (url.includes("/native-actions")) return answer({ actions: [] });
    if (url.includes("/executions")) return answer({ executions: [] });
    if (url.includes("/drafts/")) return answer({}, 404);
    if (url.includes("/tickets/")) return answer(ticketPageTicket);
    return answer({
      partition,
      sequence: 8,
      tickets: [ticketPageTicket],
    });
  };
}
