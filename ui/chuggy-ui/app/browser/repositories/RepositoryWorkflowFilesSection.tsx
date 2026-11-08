/**
 * Whether the jobs this project runs may change this repository's GitHub
 * workflow files, written through the finalization's own route and fenced the
 * same way: the finalization goes with it as this page read it.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ProjectRepositoryResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { repositoryFinalizationPipelinesChosen } from "../../core/repositoryFinalization.ts";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { RepositorySettingSection } from "./RepositoryFinalizationSection.tsx";

const workflowFilesOff = "Off";
const workflowFilesOn = "On";

export function RepositoryWorkflowFilesSection(props: {
  readonly partition: PartitionIdentity;
  readonly binding: ProjectRepositoryResponse;
}): ReactNode {
  const text = useCopyText();
  const workflowFilesOptions = [
    { value: workflowFilesOff, text: text({ id: "repositories-off" }) },
    { value: workflowFilesOn, text: text({ id: "repositories-on" }) },
  ];
  return (
    <RepositorySettingSection
      partition={props.partition}
      binding={props.binding}
      title={{ id: "repositories-workflow-files" }}
      about={{ id: "repositories-workflow-files-about" }}
      body={(held, editing) => (
        <RadioGroup
          label={text({ id: "repositories-workflow-files" })}
          value={
            held.draft.pipelinesWritable ? workflowFilesOn : workflowFilesOff
          }
          disabled={!editing}
          options={workflowFilesOptions}
          onChoose={(value) => {
            held.setDraft(
              repositoryFinalizationPipelinesChosen(
                held.draft,
                value === workflowFilesOn,
              ),
            );
          }}
        />
      )}
    />
  );
}
