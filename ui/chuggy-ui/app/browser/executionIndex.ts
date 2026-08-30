/**
 * The index of what every ticket ran, as the one read two screens share.
 *
 * The project table and the inbox draw the same three columns from the same
 * resource, so they read it under one key and one page budget rather than
 * twice: two entries would double the walk, and the two screens could then
 * disagree about whether the index was cut short. The fold is registered here
 * too, which is what keeps the columns live while either screen is open.
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
      projectExecutionIndexRead((selection, after) =>
        apiExecutions(at, partition, projectExecutionPage(selection, after)),
      ),
  );
}
