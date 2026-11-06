/**
 * What one run's worker said about how it ended: the reason it left, read
 * under the one key every part of the page reads it by, and that reason whole
 * where a row draws only its first line.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { runErrorQuery } from "../core/executionQueries.ts";
import { runReasonOf } from "../core/runReason.ts";
import type { RunReason } from "../core/runReason.ts";
import { usePanelState } from "./api.ts";

/** A worker's reason for one attempt, read under the key its row reads it by. */
export function useRunReason(
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
): RunReason | undefined {
  const state = usePanelState(runErrorQuery(partition, execution, attempt));
  return state.state === "Ready" ? runReasonOf(state.value.content) : undefined;
}

/** The worker's reason whole, where a row draws its first line cut short. */
export function RunReasonText(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: string;
}): ReactNode {
  const reason = useRunReason(props.partition, props.execution, props.attempt);
  return reason === undefined ? null : (
    <p className="text-ink-2 text-sm whitespace-pre-wrap wrap-anywhere">
      {reason.full}
    </p>
  );
}
