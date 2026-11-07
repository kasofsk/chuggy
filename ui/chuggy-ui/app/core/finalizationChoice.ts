/**
 * A finalization as a form chooses it: its kind, and a git merge's mode and
 * policy, apart from the reference it reaches, which a form holds in a box of
 * its own. It is the repository default's shape, so a policy is a field of a
 * git merge alone and no choice a form holds is one the server refuses.
 */

import type { BriefFinalizationOf } from "../../../../src/contract/brief.ts";
import type { RepositoryFinalizationBody } from "../../../../src/contract/requests.ts";
import type {
  BriefFinalizationKind,
  BriefGitMergeMode,
  BriefGitMergePolicy,
} from "../../../../src/contract/rosters.ts";

export type FinalizationChoice = RepositoryFinalizationBody;

/** The git merge a form moving onto that kind starts on. */
const finalizationChoiceGitMerge: FinalizationChoice = {
  kind: "GitMerge",
  mode: "Push",
  policy: "Direct",
};

/** The choice with another kind chosen, the one held standing where it is already that kind. */
export function finalizationKindChosen(
  choice: FinalizationChoice,
  kind: BriefFinalizationKind,
): FinalizationChoice {
  if (choice.kind === kind) return choice;
  return kind === "GitMerge" ? finalizationChoiceGitMerge : { kind };
}

/** The choice with another mode chosen, which only a git merge has. */
export function finalizationModeChosen(
  choice: FinalizationChoice,
  mode: BriefGitMergeMode,
): FinalizationChoice {
  return choice.kind === "GitMerge" ? { ...choice, mode } : choice;
}

/** The choice with another policy chosen, which only a git merge has. */
export function finalizationPolicyChosen(
  choice: FinalizationChoice,
  policy: BriefGitMergePolicy,
): FinalizationChoice {
  return choice.kind === "GitMerge" ? { ...choice, policy } : choice;
}

/** A finalization as a form chooses it, its target left to the box that holds it. */
export function finalizationChoiceOf(
  finalization: BriefFinalizationOf<string | undefined>,
): FinalizationChoice {
  switch (finalization.kind) {
    case "GitMerge":
      return {
        kind: "GitMerge",
        mode: finalization.mode,
        policy: finalization.policy,
      };
    case "PullRequest":
    case "None":
      return { kind: finalization.kind };
  }
}

/** The reference a finalization names, which `None` never does. */
export function finalizationTargetOf(
  finalization: BriefFinalizationOf<string | undefined>,
): string | undefined {
  return finalization.kind === "None" ? undefined : finalization.target;
}

/** One choice as one string, two choices being the same one where their keys are. */
export function finalizationChoiceKey(choice: FinalizationChoice): string {
  return choice.kind === "GitMerge"
    ? `${choice.kind}/${choice.mode}/${choice.policy}`
    : choice.kind;
}
