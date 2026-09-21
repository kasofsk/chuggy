/**
 * The decision semantics a stored journal row may have been decided under.
 *
 * ONE MACHINE DECIDES AND NOTHING ELSE REPLAYS. `src/domain/` is the machine
 * the model proves, and a row carries the semantics it was decided under so a
 * history spanning a semantics change could be replayed row by row under its
 * own. This image knows ONE: the walls collapsed into a sum whose spellings no
 * older row uses, and the deployment that took the change wiped its journal
 * first, so there is no row older than this semantics anywhere for a
 * correction to correct. A correction with no row is a second machine the
 * model does not check, drifting beside the one it does.
 *
 * THE MECHANISM STAYS, and that is not the same as keeping it empty out of
 * sentiment: the number is on every row this image writes, `storedJournalLegalOn`
 * refuses a row that declares any other, and the next semantics change has
 * somewhere to say so. What a correction would have to be written against is a
 * durable row, and the next one will be written against rows this image wrote.
 */

/** Which deciders produced a row, as the row's own durable envelope declares it. */
export type DecisionSemanticsVersion = 6;

/** The semantics every new decision is taken under, and the one `model/` describes. */
export const decisionSemanticsVersionCurrent: DecisionSemanticsVersion = 6;

/** Whether a stored number names decision semantics this image knows how to replay. */
export function isDecisionSemanticsVersion(
  value: number,
): value is DecisionSemanticsVersion {
  return value === decisionSemanticsVersionCurrent;
}
