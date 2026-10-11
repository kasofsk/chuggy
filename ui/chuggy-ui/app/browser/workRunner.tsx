/**
 * Whether the project's work has a runner to go to, as every screen that
 * leads to one reads it, and the link that leads there.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { apiExecutionPlacement } from "../core/apiRoutes.ts";
import { navRoutes } from "../core/shellNav.ts";
import { workRunner } from "../core/workRunner.ts";
import type { WorkRunner } from "../core/workRunner.ts";
import { usePanelResourceSettled } from "./api.ts";
import { useSessionPlacementSettled } from "./sessionPlacement.tsx";

/** No frame names this read, so the partition's own refetch is what reaches it. */
export const executionPlacementResource = "execution-placement";

export function useWorkRunner(partition: PartitionIdentity): WorkRunner {
  const placement = usePanelResourceSettled(
    partition,
    "Project",
    executionPlacementResource,
    (ports) => apiExecutionPlacement(ports, partition),
  );
  return workRunner(placement, useSessionPlacementSettled(partition));
}

/** The way to the Runners page, said as what a project with no runner does there. */
export function AddRunnerLink(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <Link to={navRoutes.runners} params={props.partition}>
      Add runner
    </Link>
  );
}
