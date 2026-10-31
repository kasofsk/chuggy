/**
 * The index of each ticket's latest execution, as the one read two screens
 * share.
 *
 * The project table and the inbox draw the same columns from the same
 * resource, so they read it under one key rather than walking it twice. The
 * fold is registered here too, which is what keeps the columns live while
 * either screen is open.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { apiExecutions } from "../core/apiRoutes.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  projectExecutionIndexFold,
  projectExecutionIndexRead,
  projectExecutionPage,
} from "../core/projectExecutionIndex.ts";
import type { ProjectExecutionIndex } from "../core/projectExecutionIndex.ts";
import { projectListFolded } from "../core/projectQueryKeys.ts";
import { usePanelList } from "./api.ts";

const executionIndexListName = "latest";

export function useProjectExecutionIndex(
  partition: PartitionIdentity,
): PanelState<ProjectExecutionIndex> {
  return usePanelList(
    projectListFolded<ProjectExecutionIndex>(
      partition,
      "Execution",
      executionIndexListName,
      (previous, change) =>
        projectExecutionIndexFold(previous, change.representation),
    ),
    (at) =>
      projectExecutionIndexRead((selection, cursor) =>
        apiExecutions(at, partition, projectExecutionPage(selection, cursor)),
      ),
  );
}
