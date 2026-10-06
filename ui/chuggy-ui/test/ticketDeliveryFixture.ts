/**
 * What the read of a ticket's action reach answers, as the bodies the delivery
 * suites draw from: a landed ticket with an action at every mark, and the
 * failures a reporter said most and least about.
 */

import type { TicketActionReachResponse } from "../../../src/contract/actionReach.ts";
import type { ActionReach } from "../app/core/tones.ts";

type DeliveryAction = TicketActionReachResponse["actions"][number];
type DeliveryReport = NonNullable<DeliveryAction["observation"]>;

export const deliveryRepository = "https://forge.example/acme/atlas.git";
export const deliveryLanded = `4a68a5aa${"0".repeat(32)}`;
export const deliveryReported = `43a251ac${"1".repeat(32)}`;
export const deliveryLink =
  "https://grafana.example.test/d/release?var-run=x7k2p";
export const deliveryDetail = "run chuggy-release-x7k2p";

/** A report that says no more than a report must. */
export const deliveryReportLeast: DeliveryReport = {
  outcome: "Succeeded",
  commit: deliveryReported,
  receivedAt: "2026-10-05T22:45:51.000000Z",
};

/** A report that says everything a reporter may. */
export const deliveryReportWhole: DeliveryReport = {
  ...deliveryReportLeast,
  observedAt: "2026-10-05T22:45:50.250000Z",
  detail: deliveryDetail,
  link: deliveryLink,
};

/** One declared action at a mark, showing `report` where the mark is read from one. */
export function deliveryAction(
  action: string,
  name: string,
  reach: ActionReach,
  report: DeliveryReport = deliveryReportLeast,
): DeliveryAction {
  return reach === "NotYet" || reach === "Unknown"
    ? { action, name, reach, observation: null }
    : { action, name, reach, observation: report };
}

/** A landed ticket whose repository declares `actions`. */
export function deliveryLandedWith(
  actions: readonly DeliveryAction[],
): TicketActionReachResponse {
  return {
    repository: deliveryRepository,
    commit: deliveryLanded,
    actions: [...actions],
  };
}

/** A failure whose reporter said why and where to read more. */
export const deliveryFailedWhole = deliveryAction(
  "publish",
  "Release published",
  "Failed",
  { ...deliveryReportWhole, outcome: "Failed" },
);

/** A failure whose reporter said neither. */
export const deliveryFailedBare = deliveryAction("rig", "Rig", "Failed", {
  ...deliveryReportLeast,
  outcome: "Failed",
});

/** One action at each of the five marks, in an order no sort would give. */
export const deliveryEveryMark = deliveryLandedWith([
  deliveryAction("build-api", "API image", "Reached", deliveryReportWhole),
  deliveryAction("build-console", "Console image", "NotYet"),
  deliveryFailedWhole,
  deliveryAction("rig", "Rig", "RolledBack"),
  deliveryAction("smoke", "Smoke", "Unknown"),
]);
