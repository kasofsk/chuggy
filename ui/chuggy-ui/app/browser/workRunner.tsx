/**
 * Whether the project's work has a runner to go to, as every screen that
 * leads to one reads it, and the link that leads there.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  executionPlacementQuery,
  ownerFallbackQuery,
} from "../core/projectQueries.ts";
import { navRoutes } from "../core/shellNav.ts";
import { workRunner } from "../core/workRunner.ts";
import type { WorkRunner, WorkRunnerOwner } from "../core/workRunner.ts";
import { usePanelState } from "./api.ts";
import { useSessionPlacementSettled } from "./sessionPlacement.tsx";

export function useWorkRunner(
  partition: PartitionIdentity,
  owner: WorkRunnerOwner,
): WorkRunner {
  const placement = usePanelState(
    executionPlacementQuery(partition),
    (state, answer) => ({ state, settled: answer.isFetched }),
  );
  const fallback = usePanelState(
    ownerFallbackQuery(partition),
    (state, answer) => ({ state, settled: answer.isFetched }),
  );
  return workRunner(
    placement,
    useSessionPlacementSettled(partition),
    fallback,
    owner,
  );
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
