/**
 * The names of the checks a merge queue's group commit failed, kept as
 * evidence beside the commit itself.
 *
 * A NAME IS KEPT ONLY WHERE A BRIEFING CAN CARRY IT. A check run's name and a
 * status's context are any app's text, and the rework is briefed with them, so
 * one that is not a briefing line, or is longer than `queueFailedCheckCharsMax`,
 * is left out as a cut rather than blocking the briefing that would quote it.
 *
 * NAMES ARE PRESENT, AT LEAST ONE, OR ABSENT. A read that found no failed check
 * keeps nothing, exactly as a read that failed does, so nothing downstream
 * tells an empty list from a missing one.
 */

import {
  queueFailedCheckCharsMax,
  queueFailedChecksMax,
  textCodePointsCount,
} from "../contract/http.ts";
import { taskConfigurationLineFault } from "../contract/taskConfiguration.ts";

/** The failed checks one removal names, `truncated` where a bound or an unreadable name cut them. */
export interface QueueFailedChecks {
  readonly names: readonly string[];
  readonly truncated: boolean;
}

/** Whether one name may be kept: a briefing line no longer than its bound. */
function queueFailedCheckKept(name: string): boolean {
  return (
    taskConfigurationLineFault(name) === undefined &&
    textCodePointsCount(name) <= queueFailedCheckCharsMax
  );
}

/**
 * The names a read found, deduplicated in the order found and bounded, or
 * nothing where none can be kept. `cut` is the reader saying it stopped before
 * the forge's last answer.
 */
export function queueFailedChecksOf(
  found: readonly string[],
  cut: boolean,
): QueueFailedChecks | undefined {
  const names: string[] = [];
  let truncated = cut;
  for (const name of new Set(found)) {
    if (!queueFailedCheckKept(name) || names.length >= queueFailedChecksMax)
      truncated = true;
    else names.push(name);
  }
  if (names.length === 0) return undefined;
  if (names.length > queueFailedChecksMax)
    throw new Error("queue failed checks: more names were kept than the bound");
  return { names, truncated };
}
