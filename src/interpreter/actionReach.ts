/**
 * Where one declared action stands for a ticket that has landed, read from
 * what was reported of the action and from which commits hold the ticket's.
 * It is derived each time it is asked and stored nowhere.
 *
 * THE MARK IS THE FIRST OF THESE THAT HOLDS, the newest report being the one
 * with the greatest ordinal:
 *
 *   - the action's newest success is at a commit holding the ticket's:
 *     `Reached`, showing that success;
 *   - its newest report is a failure at a commit holding the ticket's:
 *     `Failed`, showing that failure;
 *   - a success beneath its newest, reported since the ticket landed, is at a
 *     commit holding the ticket's: `RolledBack`, showing the newest such;
 *   - otherwise `NotYet`, which is where an action nothing was reported of
 *     ends.
 *
 * WHAT COULD NOT BE FOUND OUT IS `Unknown` AND NEVER `NotYet`. A commit whose
 * ancestry came back unknown ends the reading there, and so does a walk that
 * weighed as many successes as it may with more beneath them: a ticket once
 * shown reached is not shown waiting because the reading gave up.
 *
 * A COMMIT IS WEIGHED ONCE. The successes are walked row by row, and one at a
 * commit already found not to hold the ticket's is passed over, so each
 * distinct commit among them is asked about once.
 *
 * WHAT THE MARKS CANNOT SAY, each because a mark reads reports and no cause:
 *
 *   - an older commit built again by hand is the action's newest success, so
 *     a ticket landed after it reads `RolledBack` on that action until its
 *     head is built again;
 *   - before an action's first success, a failure marks every landed ticket
 *     its commit holds `Failed`;
 *   - a failure at one commit followed by a success at an older one leaves a
 *     ticket only the failed commit held `NotYet`;
 *   - a release reported healthy that later is not shows on no ticket, since
 *     nothing reports it;
 *   - a delivery sent again while its signature is still admitted is a new
 *     row, so an older success delivered again reads as the action's newest;
 *   - a report that never arrived is a row that is missing, and the mark is
 *     what the rows either side of it say.
 *
 * "SINCE THE TICKET LANDED" IS DECIDED BY STAMP AND THE WALK IS ORDERED BY
 * ORDINAL, and the two can disagree: a report's stamp is when its transaction
 * began, and the reports of one action are weighed one at a time. A success is
 * left out only where its own report began before the ticket's time, when no
 * commit holding the ticket's had reached its branch, so the disagreement
 * leaves out nothing that could have marked. Two readings are accepted with
 * it. An action that reports of a commit before any branch holds it has that
 * success left out, and its ticket is `NotYet` where it might have been
 * `RolledBack`. And whether more successes lie beneath the walk is read from
 * the one row past it, so a ticket whose time fell inside a report's wait for
 * its turn, at that very row, is `NotYet` where it should be `Unknown`.
 */

import { assertNever } from "../domain/assertNever.ts";
import type { allActionReaches } from "../contract/actionReach.ts";
import type { ActionReportOutcome } from "./actionReport.ts";
import type { CommitAncestry } from "./commitAncestry.ts";
import type { GitObjectId } from "./finalizer.ts";
import type { PublicInstant } from "./publicResource.ts";

/** Where an action stands for one landed ticket. */
export type ActionReach = (typeof allActionReaches)[number];

/** How many successes beneath an action's newest one reading weighs. */
export const actionReachEarlierSuccessesMax = 16;

/** How many it reads: those it weighs and the one past them, which says whether more lie beneath. */
export const actionReachEarlierReadMax = actionReachEarlierSuccessesMax + 1;

/** One report of an action as its log holds it, the ordinal being its place there. */
export interface ActionReachObservation {
  readonly ordinal: number;
  readonly outcome: ActionReportOutcome;
  readonly commit: GitObjectId;
  readonly observedAt?: PublicInstant;
  readonly receivedAt: PublicInstant;
  readonly detail?: string;
  readonly link?: string;
}

/** An action's newest success and its newest report, which are one row where its newest report succeeded. */
export interface ActionReachNewest {
  readonly success?: ActionReachObservation;
  readonly report?: ActionReachObservation;
}

/** One success beneath an action's newest, and whether it was reported since the ticket landed. */
export interface ActionReachEarlierSuccess {
  readonly observation: ActionReachObservation;
  readonly sinceLanded: boolean;
}

/** What one reading has gathered: the newest reports, the successes beneath the newest once they are read, newest first, and each commit's answer so far. */
export interface ActionReachView {
  readonly newest: ActionReachNewest;
  readonly earlier: readonly ActionReachEarlierSuccess[] | undefined;
  readonly answers: ReadonlyMap<GitObjectId, CommitAncestry>;
}

/** Where an action stands and, for a mark read from a report, the report. */
export type ActionReachMark =
  | {
      readonly reach: "Reached" | "Failed" | "RolledBack";
      readonly observation: ActionReachObservation;
    }
  | { readonly reach: "NotYet" | "Unknown" };

/** What a reading needs next: one commit's ancestry, the newest so many successes beneath an ordinal, or nothing because the mark is read. */
export type ActionReachNext =
  | { readonly next: "Ask"; readonly tip: GitObjectId }
  | {
      readonly next: "ReadEarlier";
      readonly beneath: number;
      readonly count: number;
    }
  | { readonly next: "Marked"; readonly mark: ActionReachMark };

/** Refuses a view no log could have produced, so a mark is never read from one. */
function actionReachViewAsserted(view: ActionReachView): void {
  const { success, report } = view.newest;
  const newestSucceeded = report?.outcome === "Succeeded";
  if (
    (report === undefined && success !== undefined) ||
    (success !== undefined && success.outcome !== "Succeeded") ||
    (newestSucceeded && success?.ordinal !== report.ordinal) ||
    (!newestSucceeded &&
      success !== undefined &&
      report !== undefined &&
      success.ordinal >= report.ordinal)
  )
    throw new RangeError("action reach: the newest reports are not one log's");
  const earlier = view.earlier ?? [];
  if (earlier.length > actionReachEarlierReadMax)
    throw new RangeError("action reach: more successes than a reading reads");
  let beneath = success?.ordinal ?? 0;
  for (const { observation } of earlier) {
    if (observation.outcome !== "Succeeded" || observation.ordinal >= beneath)
      throw new RangeError("action reach: the earlier successes are not so");
    beneath = observation.ordinal;
  }
}

/** What one report's commit decides: the mark where it holds the ticket's, `Unknown` where that could not be found out, and nothing where it does not. */
function actionReachWeighed(
  view: ActionReachView,
  observation: ActionReachObservation,
  reach: "Reached" | "Failed" | "RolledBack",
): ActionReachNext | undefined {
  const answer = view.answers.get(observation.commit);
  switch (answer) {
    case undefined:
      return { next: "Ask", tip: observation.commit };
    case "Ancestor":
      return { next: "Marked", mark: { reach, observation } };
    case "Unknown":
      return { next: "Marked", mark: { reach: "Unknown" } };
    case "NotAncestor":
      return undefined;
    default:
      return assertNever(answer);
  }
}

/** The one thing a reading does next, a pure function of what it has gathered. */
export function actionReachNext(view: ActionReachView): ActionReachNext {
  actionReachViewAsserted(view);
  const { success, report } = view.newest;
  const reached =
    success === undefined
      ? undefined
      : actionReachWeighed(view, success, "Reached");
  if (reached !== undefined) return reached;
  const failed =
    report?.outcome === "Failed"
      ? actionReachWeighed(view, report, "Failed")
      : undefined;
  if (failed !== undefined) return failed;
  if (success === undefined)
    return { next: "Marked", mark: { reach: "NotYet" } };
  if (view.earlier === undefined)
    return {
      next: "ReadEarlier",
      beneath: success.ordinal,
      count: actionReachEarlierReadMax,
    };
  for (const earlier of view.earlier.slice(0, actionReachEarlierSuccessesMax)) {
    const rolledBack = earlier.sinceLanded
      ? actionReachWeighed(view, earlier.observation, "RolledBack")
      : undefined;
    if (rolledBack !== undefined) return rolledBack;
  }
  const past = view.earlier[actionReachEarlierSuccessesMax];
  return {
    next: "Marked",
    mark: { reach: past?.sinceLanded === true ? "Unknown" : "NotYet" },
  };
}
