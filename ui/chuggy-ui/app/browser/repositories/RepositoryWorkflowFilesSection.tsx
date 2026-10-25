/**
 * Whether the jobs this project runs may change this repository's GitHub
 * workflow files, written through the landing's own route and fenced the same
 * way: the landing goes with it as this page read it.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ProjectRepositoryResponse } from "../../../../../src/contract/responses.ts";
import { repositoryLandingPipelinesChosen } from "../../core/repositoryLanding.ts";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { RepositorySettingSection } from "./RepositoryLandingSection.tsx";

const workflowFilesOff = "Off";
const workflowFilesOn = "On";

const workflowFilesOptions = [
  { value: workflowFilesOff, text: workflowFilesOff },
  { value: workflowFilesOn, text: workflowFilesOn },
];

export function RepositoryWorkflowFilesSection(props: {
  readonly partition: PartitionIdentity;
  readonly binding: ProjectRepositoryResponse;
}): ReactNode {
  return (
    <RepositorySettingSection
      partition={props.partition}
      binding={props.binding}
      title="Workflow files"
      about="Lets jobs change GitHub workflow files. The App needs Workflows too."
      body={(held, editing) => (
        <RadioGroup
          label="Workflow files"
          value={
            held.draft.pipelinesWritable ? workflowFilesOn : workflowFilesOff
          }
          disabled={!editing}
          options={workflowFilesOptions}
          onChoose={(value) => {
            held.setDraft(
              repositoryLandingPipelinesChosen(
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
