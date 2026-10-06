/**
 * What the read of one ticket's action reach answers: the commit the ticket
 * landed at, and where each action its repository declares stands for it.
 *
 * A TICKET THAT HAS LANDED NOWHERE ANSWERS NO REPOSITORY, NO COMMIT AND NO
 * ACTIONS, whatever its repository declares. That is a ticket with nothing to
 * land, one not yet landed, and one whose proposal a person is left to merge.
 *
 * A MARK READ FROM A REPORT SHOWS THAT REPORT, AND ONE READ FROM NONE SHOWS
 * `null`. `Reached`, `Failed` and `RolledBack` each name the report that says
 * so; `NotYet` and `Unknown` are what no report says.
 *
 * A REPORT IS SHOWN AS IT WAS TAKEN. `observedAt`, `detail` and `link` are the
 * reporter's and are absent where it gave none; `receivedAt` is this server's.
 */

import { z } from "zod";

import { actionDocumentSchema } from "./actionDocument.ts";
import {
  actionReportDocumentSchema,
  allActionReportOutcomes,
} from "./actionReport.ts";
import { instantSchema } from "./http.ts";

/** The marks read from one report, which each shows. */
export const allActionReachesShown = [
  "Reached",
  "Failed",
  "RolledBack",
] as const;

/** The marks read from no report. */
export const allActionReachesUnshown = ["NotYet", "Unknown"] as const;

/** Every mark an action stands at for one landed ticket. */
export const allActionReaches = [
  ...allActionReachesShown,
  ...allActionReachesUnshown,
] as const;

const actionReachCommit = actionReportDocumentSchema.shape.commit;

/** One report as a reader is shown it. */
export const actionReachObservationSchema = z.strictObject({
  outcome: z.enum(allActionReportOutcomes),
  commit: actionReachCommit,
  observedAt: instantSchema.optional(),
  receivedAt: instantSchema,
  detail: actionReportDocumentSchema.shape.detail,
  link: actionReportDocumentSchema.shape.link,
});

const actionReachDeclared = {
  action: actionDocumentSchema.shape.action,
  name: actionDocumentSchema.shape.name,
};

/** One declared action and where it stands. */
export const actionReachSchema = z.discriminatedUnion("reach", [
  z.strictObject({
    ...actionReachDeclared,
    reach: z.enum(allActionReachesShown),
    observation: actionReachObservationSchema,
  }),
  z.strictObject({
    ...actionReachDeclared,
    reach: z.enum(allActionReachesUnshown),
    observation: z.null(),
  }),
]);

export const ticketActionReachResponseSchema = z.union([
  z.strictObject({
    repository: z.null(),
    commit: z.null(),
    actions: z.tuple([]),
  }),
  z.strictObject({
    repository: z.string().min(1),
    commit: actionReachCommit,
    actions: z.array(actionReachSchema),
  }),
]);
export type TicketActionReachResponse = z.infer<
  typeof ticketActionReachResponseSchema
>;
