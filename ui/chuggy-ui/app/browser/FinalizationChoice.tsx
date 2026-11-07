/* eslint-disable copy/no-literal-text */
/**
 * The controls a finalization is chosen with: its kind, and under a git merge
 * alone its mode and its policy, so no kind is drawn a choice it has no field
 * for. Each control is laid out by the screen it is drawn on.
 */

import type { ReactNode } from "react";

import {
  briefFinalizationKinds,
  briefGitMergeModes,
  briefGitMergePolicies,
} from "../../../../src/contract/rosters.ts";
import {
  finalizationKindEffect,
  finalizationKindLabel,
  gitMergeModeEffect,
  gitMergeModeLabel,
  gitMergePolicyEffect,
  gitMergePolicyLabel,
} from "../core/codeLabels.ts";
import {
  finalizationKindChosen,
  finalizationModeChosen,
  finalizationPolicyChosen,
  type FinalizationChoice,
} from "../core/finalizationChoice.ts";
import { RadioGroup } from "./ui/RadioGroup.tsx";

const finalizationKindOptions = briefFinalizationKinds.map((kind) => ({
  value: kind,
  text: finalizationKindLabel(kind),
  description: finalizationKindEffect(kind),
}));

const gitMergeModeOptions = briefGitMergeModes.map((mode) => ({
  value: mode,
  text: gitMergeModeLabel(mode),
  description: gitMergeModeEffect(mode),
}));

const gitMergePolicyOptions = briefGitMergePolicies.map((policy) => ({
  value: policy,
  text: gitMergePolicyLabel(policy),
  description: gitMergePolicyEffect(policy),
}));

/** The member of a roster a radio's value names, none where it names no member. */
function finalizationChoiceMember<Member extends string>(
  roster: readonly Member[],
  value: string,
): Member | undefined {
  return roster.find((member) => member === value);
}

export function FinalizationChoiceFields(props: {
  readonly choice: FinalizationChoice;
  readonly onChoose: (choice: FinalizationChoice) => void;
  readonly disabled?: boolean;
  /** One control as the screen lays it out, under the label it is named by. */
  readonly row: (label: string, control: ReactNode) => ReactNode;
}): ReactNode {
  const { choice, onChoose, row } = props;
  const disabled = props.disabled ?? false;
  return (
    <>
      {row(
        "Finalization",
        <RadioGroup
          label="Finalization"
          value={choice.kind}
          disabled={disabled}
          options={finalizationKindOptions}
          onChoose={(value) => {
            const kind = finalizationChoiceMember(
              briefFinalizationKinds,
              value,
            );
            if (kind !== undefined)
              onChoose(finalizationKindChosen(choice, kind));
          }}
        />,
      )}
      {choice.kind !== "GitMerge" ? null : (
        <>
          {row(
            "Merge",
            <RadioGroup
              label="Merge"
              value={choice.mode}
              disabled={disabled}
              options={gitMergeModeOptions}
              onChoose={(value) => {
                const mode = finalizationChoiceMember(
                  briefGitMergeModes,
                  value,
                );
                if (mode !== undefined)
                  onChoose(finalizationModeChosen(choice, mode));
              }}
            />,
          )}
          {row(
            "Policy",
            <RadioGroup
              label="Policy"
              value={choice.policy}
              disabled={disabled}
              options={gitMergePolicyOptions}
              onChoose={(value) => {
                const policy = finalizationChoiceMember(
                  briefGitMergePolicies,
                  value,
                );
                if (policy !== undefined)
                  onChoose(finalizationPolicyChosen(choice, policy));
              }}
            />,
          )}
        </>
      )}
    </>
  );
}
