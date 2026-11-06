/**
 * A brief's finalization as the console's landing choices read it: the mode it
 * lands by, the reference it names, and the policy it is ordered under. The
 * console chooses a landing by its mode and its policy apart, so a finalization
 * named by its kind is read back into those two.
 */

import type { z } from "zod";

import type { briefFinalizationResponseSchema } from "../../../../src/contract/brief.ts";
import {
  briefFinalizationModeOf,
  type BriefFinalizationMode,
  type BriefGitMergePolicy,
} from "../../../../src/contract/rosters.ts";

/** One finalization by its mode, its target, and its policy, `Direct` where its kind names none. */
export interface BriefLanding {
  readonly mode: BriefFinalizationMode;
  readonly target?: string;
  readonly policy: BriefGitMergePolicy;
}

export function briefLandingOf(
  finalization: z.output<typeof briefFinalizationResponseSchema> | undefined,
): BriefLanding | undefined {
  if (finalization === undefined) return undefined;
  const target = finalization.kind === "None" ? undefined : finalization.target;
  return {
    mode: briefFinalizationModeOf(finalization),
    ...(target === undefined ? {} : { target }),
    policy: finalization.kind === "GitMerge" ? finalization.policy : "Direct",
  };
}
