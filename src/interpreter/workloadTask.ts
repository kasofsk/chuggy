/**
 * The one workload a version 2 task runs, read out of the pinned catalog with
 * its ticket's workload overrides applied, by the selection its ticket was
 * released with.
 *
 * A TASK OF A CATALOG IS BRIEFED FROM ITS OWN WORKLOAD AND NOTHING ELSE. The
 * work runs the selected work workload, and an evaluator the workload at its
 * own position in its stage of the selected plan, so no part of one workload
 * reaches another task's briefing.
 *
 * THE TICKET'S OWN CHECK LINES JOIN ONE TASK. They are appended to the first
 * evaluator the selected plan runs as commands, as they join the first
 * commanded stage of a version 1 configuration, so a ticket widens what its
 * change is held to and never changes what any workload is.
 */

import {
  configurationWithOverrides,
  type ConfigurationOverrides,
} from "../contract/configurationOverrides.ts";
import type { ConfigurationSelection } from "../contract/configurationSelection.ts";
import type { ConfigurationPin } from "./projectDecision.ts";
import {
  selectedCatalogEntries,
  selectedEvaluatorWorkload,
  selectedFirstCommandsEvaluator,
  workloadConfigurationReadiness,
  type Workload,
} from "./workloadConfiguration.ts";

/** One task of a catalog: the workload it runs, and whether the ticket's own check lines join it. */
export interface WorkloadTask {
  readonly workload: Workload;
  readonly ticketChecks: boolean;
}

/** One task of a catalog, as the revision it was read from was pinned. */
export interface PinnedWorkloadTask extends ConfigurationPin, WorkloadTask {
  readonly version: 2;
}

/** Which task of a ticket is read: the work, or one evaluator of a stage by its index and its key. */
export type WorkloadTaskPosition =
  | { readonly taskKind: "Work" }
  | {
      readonly taskKind: "Evaluation";
      readonly stage: number;
      readonly evaluator: number;
    };

/**
 * The workload one task of a catalog runs, or none where the catalog, the
 * selection or the task's position does not name one. The stage is the
 * zero-based index a scheduler carries and the evaluator the key a program
 * draws, which counts from one.
 */
export function catalogWorkloadTask(
  value: unknown,
  overrides: ConfigurationOverrides | undefined,
  selection: ConfigurationSelection | undefined,
  position: WorkloadTaskPosition,
): WorkloadTask | undefined {
  const ready = workloadConfigurationReadiness(
    configurationWithOverrides(value, { workloads: overrides?.workloads }),
  );
  if (ready.readiness !== "Ready") return undefined;
  const selected = selectedCatalogEntries(ready.configuration, selection);
  if (selected.selected !== "Selected") return undefined;
  if (position.taskKind === "Work")
    return { workload: selected.value.work.workload, ticketChecks: false };
  const stage = position.stage + 1;
  const evaluator = selectedEvaluatorWorkload(
    selected.value,
    stage,
    position.evaluator,
  );
  if (evaluator === undefined) return undefined;
  const commanded = selectedFirstCommandsEvaluator(selected.value);
  return {
    workload: evaluator.workload,
    ticketChecks:
      commanded?.stage === stage && commanded.evaluator === position.evaluator,
  };
}

/** The workload one task of a catalog runs, under the pin it was read at. */
export function pinnedWorkloadTask(
  value: unknown,
  pin: ConfigurationPin,
  overrides: ConfigurationOverrides | undefined,
  selection: ConfigurationSelection | undefined,
  position: WorkloadTaskPosition,
): PinnedWorkloadTask | undefined {
  const task = catalogWorkloadTask(value, overrides, selection, position);
  return task === undefined ? undefined : { ...pin, version: 2, ...task };
}

/** Where a stored task row puts a task of a catalog, or nowhere where an evaluation row is half named. */
export function workloadTaskPositionOf(
  taskKind: "Work" | "Evaluation",
  stage: number | undefined,
  evaluator: number | undefined,
): WorkloadTaskPosition | undefined {
  if (taskKind === "Work") return { taskKind };
  return stage === undefined || evaluator === undefined
    ? undefined
    : { taskKind, stage, evaluator };
}
