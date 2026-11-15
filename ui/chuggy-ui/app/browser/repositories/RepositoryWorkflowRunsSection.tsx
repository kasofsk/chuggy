/**
 * Whether the jobs this project runs may start and read this repository's
 * GitHub workflow runs, written through the finalization's own route and fenced
 * the same way: the other settings go with it as this page read them.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ProjectRepositoryResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { repositoryFinalizationRunsChosen } from "../../core/repositoryFinalization.ts";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { RepositorySettingSection } from "./RepositoryFinalizationSection.tsx";

const workflowRunsOff = "Off";
const workflowRunsOn = "On";

export function RepositoryWorkflowRunsSection(props: {
  readonly partition: PartitionIdentity;
  readonly binding: ProjectRepositoryResponse;
}): ReactNode {
  const text = useCopyText();
  const workflowRunsOptions = [
    { value: workflowRunsOff, text: text({ id: "repositories-off" }) },
    { value: workflowRunsOn, text: text({ id: "repositories-on" }) },
  ];
  return (
    <RepositorySettingSection
      partition={props.partition}
      binding={props.binding}
      title={{ id: "repositories-workflow-runs" }}
      about={{ id: "repositories-workflow-runs-about" }}
      body={(held, editing) => (
        <RadioGroup
          label={text({ id: "repositories-workflow-runs" })}
          value={
            held.draft.pipelinesRunnable ? workflowRunsOn : workflowRunsOff
          }
          disabled={!editing}
          options={workflowRunsOptions}
          onChoose={(value) => {
            held.setDraft(
              repositoryFinalizationRunsChosen(
                held.draft,
                value === workflowRunsOn,
              ),
            );
          }}
        />
      )}
    />
  );
}
