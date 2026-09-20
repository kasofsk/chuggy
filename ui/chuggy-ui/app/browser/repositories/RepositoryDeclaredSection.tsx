/**
 * What this repository declares, and the commit it was read at.
 *
 * The commit is drawn because nothing raises a frame when the tree moves, so
 * it is the reader's only way to tell a panel that is stale from a repository
 * that has not changed. A fragment's own fields are not here: they are the
 * fragment's, and are read where it is.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiProjectRepositoryDeclarations } from "../../core/apiRoutes.ts";
import {
  repositoryDeclaredCommit,
  repositoryDeclaredRosters,
} from "../../core/repositoryDeclarations.ts";
import type { RepositoryDeclaredRoster } from "../../core/repositoryDeclarations.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

/** This page's own read of the declarations, which no frame names. */
export const repositoryDeclarationsResource = "repository-declarations";

/** A roster's members, or the one line that says it holds none. */
function RepositoryDeclaredRosterField(props: {
  readonly roster: RepositoryDeclaredRoster;
}): ReactNode {
  const members = props.roster.members;
  return (
    <Field name={props.roster.name} absent={members.length === 0}>
      {members.length === 0 ? "None declared" : members.join(", ")}
    </Field>
  );
}

export function RepositoryDeclaredSection(props: {
  readonly partition: PartitionIdentity;
  readonly repository: string;
}): ReactNode {
  const declared = usePanelResource(
    props.partition,
    "Project",
    `${repositoryDeclarationsResource}:${props.repository}`,
    (ports) =>
      apiProjectRepositoryDeclarations(
        ports,
        props.partition,
        props.repository,
      ),
  );
  return (
    <Panel
      variant="section"
      title="Declares"
      about="What a ticket in this repository is run and finished under."
    >
      <PanelUnready state={declared} />
      {declared.state === "Ready" ? (
        <Fields variant="inline">
          <Field name="Rework limit">
            {String(declared.value.reworkLimit)}
          </Field>
          {repositoryDeclaredRosters(declared.value).map((roster) => (
            <RepositoryDeclaredRosterField key={roster.name} roster={roster} />
          ))}
          <Field name="Read at">
            <Tooltip text={repositoryDeclaredCommit(declared.value).title}>
              <span>{repositoryDeclaredCommit(declared.value).text}</span>
            </Tooltip>
          </Field>
        </Fields>
      ) : null}
    </Panel>
  );
}
