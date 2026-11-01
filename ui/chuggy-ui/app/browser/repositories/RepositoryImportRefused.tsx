/**
 * One line naming the first live binding whose newest import was refused, and
 * how many more were, linking to its page: drawn over a project's tickets and
 * its Inbox, and nothing while no import was refused or while the listing is
 * unread.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { projectRepositoriesReachUnaskedQuery } from "../../core/projectQueries.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import {
  repositoryImportRefusedLabel,
  repositoryImportsRefused,
} from "../../core/repositoryImport.ts";
import { usePanelState } from "../api.ts";
import { Notice } from "../ui/Notice.tsx";
import { repositoryRoutePath } from "./RepositoryPage.tsx";

export function RepositoryImportRefusedNotice(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const partition = props.partition;
  const bindings = usePanelState(
    projectRepositoriesReachUnaskedQuery(partition),
  );
  if (bindings.state !== "Ready") return null;
  const [first, ...more] = repositoryImportsRefused(
    bindings.value.repositories,
  );
  if (first === undefined) return null;
  return (
    <Notice
      tone="danger"
      inline
      role="status"
      detail={`${repositoryImportRefusedLabel} · `}
    >
      <Link
        to={repositoryRoutePath}
        params={{ ...partition, repository: first }}
      >
        {repositoryLabel(first)}
      </Link>
      {more.length === 0 ? null : ` · ${String(more.length)} more`}
    </Notice>
  );
}
