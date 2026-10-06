/**
 * The document a reporter sends of what one declared action did at one commit,
 * and what it is answered.
 *
 * THE ACTION IS IN THE ADDRESS AND NOT IN THE DOCUMENT. A reporter that cannot
 * shape its body names its action by the address it posts to, so every report
 * says which action it is about the same way.
 *
 * A FIELD THE DOCUMENT HAS NO PLACE FOR IS REFUSED RATHER THAN DROPPED, as an
 * action document refuses one.
 *
 * A LINK IS WHAT A PERSON OPENS FROM A TICKET, so it is held to one rule
 * whoever reports it: https, bounded, and carrying no credentials.
 */

import { z } from "zod";

import { isBoundedText, textCodePointsCount } from "./http.ts";

/** The one document version this tree reads. */
export const actionReportVersion = 1;

/** What a reporter may say an action came to. */
export const allActionReportOutcomes = ["Succeeded", "Failed"] as const;

/** The longest instant a document states, which is longer than any clock writes one. */
export const actionReportInstantCharsMax = 64;

/** The longest detail one report carries. */
export const actionReportDetailCharsMax = 1_024;

/** The longest link one report carries. */
export const actionReportLinkCharsMax = 2_048;

/** A commit, at either width git addresses an object at. */
const actionReportCommit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** An https URL written in visible ASCII, as one is on the wire. */
const actionReportLinkWritten = /^https:\/\/[!-~]+$/u;

/** An https URL whose authority carries a credential. */
const actionReportLinkCredential = /^https:\/\/[^/?#]*@/u;

/** Whether a link is one a report may carry. */
export function isActionReportLink(text: string): boolean {
  return (
    textCodePointsCount(text) <= actionReportLinkCharsMax &&
    actionReportLinkWritten.test(text) &&
    !actionReportLinkCredential.test(text) &&
    URL.canParse(text)
  );
}

/**
 * One report. `observedAt` is the reporter's own clock, kept beside this
 * server's and never in place of it; `detail` is whatever names the run to a
 * person, and `link` is where they read more of it.
 */
export const actionReportDocumentSchema = z.strictObject({
  version: z.literal(actionReportVersion),
  commit: z.string().regex(actionReportCommit),
  outcome: z.enum(allActionReportOutcomes),
  observedAt: z.iso
    .datetime({ offset: true })
    .max(actionReportInstantCharsMax)
    .optional(),
  detail: z
    .string()
    .refine((value) => isBoundedText(value, actionReportDetailCharsMax))
    .optional(),
  link: z.string().refine(isActionReportLink).optional(),
});
export type ActionReportDocument = z.infer<typeof actionReportDocumentSchema>;

/** What a report came to: a row, or nothing because the action's newest row already says it. */
export const allActionReportResults = ["Recorded", "Repeated"] as const;

export const actionReportResponseSchema = z.object({
  report: z.enum(allActionReportResults),
});
export type ActionReportResponse = z.infer<typeof actionReportResponseSchema>;
