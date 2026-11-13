/**
 * A release refused because a stage of its program is keyed other than by its
 * place in the program is settled under the fault's own code.
 *
 * `decision_input_outcome_is_known` IS REPLACED, admitting
 * `ProgramStageOutOfPosition` beside every code 148 admitted, so no stored row
 * is refused by the new constraint.
 */

import type { Migration } from "../shared.ts";
import { textArray } from "./085-dependencies-change.ts";
import {
  boundaryRefusals as boundaryRefusalsAt146,
  domainRefusals,
} from "./146-approval-refusals.ts";

/** The boundary's own refusals: 148's, and the one this adds. */
const boundaryRefusals = [
  ...boundaryRefusalsAt146,
  "ApprovalNotAnswerable",
  "ProgramStageOutOfPosition",
];

export const migration171: Migration = {
  version: 171,
  name: "a release whose program keys a stage other than by its place is refused under the fault's own code",
  statements: [
    `ALTER TABLE public.decision_input
       DROP CONSTRAINT decision_input_outcome_is_known,
       ADD CONSTRAINT decision_input_outcome_is_known CHECK ((outcome_code IS NULL OR (outcome_code = ANY (${textArray([...domainRefusals, ...boundaryRefusals])}))))`,
  ],
};
