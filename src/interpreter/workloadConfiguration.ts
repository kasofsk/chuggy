/**
 * A version 2 configuration: a catalog of workloads, the evaluation plans that
 * run them, the finalizers that land their work, and the defaults a ticket
 * selecting nothing takes.
 *
 * A WORKLOAD IS WHOLE. Its prompt, its worker, its authority and where it runs
 * are its own, so nothing one workload says reaches another, and nothing the
 * catalog says reaches a workload except the image a workload naming none runs
 * in. Every framing a version 1 briefing imposes is opt-in here.
 *
 * READY MEANS RESOLVED. A repository's catalog names workload files and prompt
 * files by path, and the import stores what it read inline beside each path;
 * only a document holding every workload inline and every prompt's text is
 * ready, so nothing past readiness reads a repository.
 *
 * A TICKET SELECTS, AND THE SELECTION IS JUDGED HERE. `selectedCatalogEntries`
 * resolves a selection against one catalog into the work, the plan's stages and
 * the finalizer a ticket runs on, and refuses a name the catalog lacks. The
 * evaluator key a program draws in a stage is that stage's evaluator at the
 * same position, counting from one.
 */

import type { z } from "zod";

import {
  type agentWorkloadSchema,
  type commandsWorkloadSchema,
  type evaluationPlanStageSchema,
  type finalizerSchema,
  workloadConfigurationSchema,
  type workloadConfigurationVersion,
} from "../contract/configurationDocument.ts";
import type { ConfigurationSelection } from "../contract/configurationSelection.ts";

type WorkloadReadonly<Value> = Value extends object
  ? { readonly [Key in keyof Value]: WorkloadReadonly<Value[Key]> }
  : Value;

/** An agent workload whose prompt text is held, which is the only kind a ready catalog holds. */
export type AgentWorkload = WorkloadReadonly<
  Omit<z.output<typeof agentWorkloadSchema>, "prompt"> & {
    readonly prompt: { readonly path?: string; readonly text: string };
  }
>;

/** A workload the worker runs itself. */
export type CommandsWorkload = WorkloadReadonly<
  z.output<typeof commandsWorkloadSchema>
>;

/** One resolved workload. */
export type Workload = AgentWorkload | CommandsWorkload;

/** One finalizer of a catalog. */
export type Finalizer = WorkloadReadonly<z.output<typeof finalizerSchema>>;

/** A ready version 2 configuration: every workload inline and every prompt read. */
export type WorkloadConfiguration = Readonly<Record<string, unknown>> & {
  readonly version: typeof workloadConfigurationVersion;
  readonly image: string;
  readonly workloads: Readonly<Record<string, Workload>>;
  readonly plans: Readonly<
    Record<
      string,
      readonly WorkloadReadonly<z.output<typeof evaluationPlanStageSchema>>[]
    >
  >;
  readonly finalizers?: Readonly<Record<string, Finalizer>>;
  readonly defaults: {
    readonly work: string;
    readonly evaluation: string;
    readonly finalization?: string;
  };
  readonly outputs?: unknown;
};

/** Why a catalog is not ready: its shape, an entry still named by path, a name it lacks, or a workload's placement. */
export type WorkloadConfigurationFault =
  | "ReleaseShapeInvalid"
  | "WorkloadUnresolved"
  | "CatalogNameUnknown"
  | "WorkloadPlacementInvalid";

export type WorkloadConfigurationReadiness =
  | {
      readonly readiness: "Ready";
      readonly configuration: WorkloadConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: WorkloadConfigurationFault;
    };

/** One parsed catalog entry as a resolved workload, or undefined where it is a path still to read. */
function workloadConfigurationResolved(
  entry: z.output<typeof workloadConfigurationSchema>["workloads"][string],
): Workload | undefined {
  if (typeof entry === "string") return undefined;
  return entry.runner === "Commands" || entry.prompt.text !== undefined
    ? (entry as Workload)
    : undefined;
}

/** Whether every name the plans and the defaults use is one the catalog holds. */
function workloadConfigurationNamesKnown(
  configuration: z.output<typeof workloadConfigurationSchema>,
): boolean {
  const { workloads, plans, finalizers = {}, defaults } = configuration;
  return (
    Object.hasOwn(workloads, defaults.work) &&
    Object.hasOwn(plans, defaults.evaluation) &&
    (defaults.finalization === undefined ||
      Object.hasOwn(finalizers, defaults.finalization)) &&
    Object.values(plans).every((stages) =>
      stages.every((stage) =>
        stage.evaluators.every((name) => Object.hasOwn(workloads, name)),
      ),
    )
  );
}

/** Whether a workload names where it runs at most once: by image, or by a requirement carrying its own. */
function workloadPlacementSingular(workload: Workload): boolean {
  return (
    workload.image === undefined || workload.executionRequirement === undefined
  );
}

/** Whether a workload an agent carries out runs somewhere an agent can run. */
function workloadPlacementAgentRunnable(workload: Workload): boolean {
  return (
    workload.runner === "Commands" ||
    workload.executionRequirement?.mode !== "Native"
  );
}

/**
 * Whether one parsed document is a ready catalog, and the first fault where it
 * is not. The order is the order a reader fixes them in: the shape, then what
 * an import still has to read, then the names, then each workload's placement.
 */
export function workloadConfigurationReadiness(
  value: unknown,
): WorkloadConfigurationReadiness {
  const parsed = workloadConfigurationSchema.safeParse(value);
  if (!parsed.success)
    return { readiness: "Incomplete", fault: "ReleaseShapeInvalid" };
  const entries = Object.values(parsed.data.workloads).map(
    workloadConfigurationResolved,
  );
  const resolved = entries.filter((entry) => entry !== undefined);
  if (resolved.length !== entries.length)
    return { readiness: "Incomplete", fault: "WorkloadUnresolved" };
  if (!workloadConfigurationNamesKnown(parsed.data))
    return { readiness: "Incomplete", fault: "CatalogNameUnknown" };
  if (
    !resolved.every(
      (workload) =>
        workloadPlacementSingular(workload) &&
        workloadPlacementAgentRunnable(workload),
    )
  )
    return { readiness: "Incomplete", fault: "WorkloadPlacementInvalid" };
  return {
    readiness: "Ready",
    configuration: value as WorkloadConfiguration,
  };
}

/** One workload a ticket runs, by the name the catalog holds it under. */
export interface SelectedWorkload {
  readonly name: string;
  readonly workload: Workload;
}

/** One stage of the plan a ticket runs: its name, and its evaluators' workloads in position order. */
export interface SelectedStage {
  readonly name: string;
  readonly evaluators: readonly SelectedWorkload[];
}

/** Everything a ticket runs on from one catalog. */
export interface CatalogSelection {
  readonly work: SelectedWorkload;
  readonly plan: {
    readonly name: string;
    readonly stages: readonly SelectedStage[];
  };
  readonly finalizer?: { readonly name: string; readonly finalizer: Finalizer };
}

export type CatalogSelectionRead =
  | { readonly selected: "Selected"; readonly value: CatalogSelection }
  | {
      readonly selected: "Unknown";
      readonly field: keyof ConfigurationSelection;
    };

/** The workload a catalog holds under a name, which readiness has already held to exist. */
function selectedCatalogWorkload(
  configuration: WorkloadConfiguration,
  name: string,
): SelectedWorkload {
  const workload = configuration.workloads[name];
  if (workload === undefined)
    throw new RangeError(`catalog: no workload is named ${name}`);
  return { name, workload };
}

/** Resolves one ticket's selection against a ready catalog, each absent field the default. */
export function selectedCatalogEntries(
  configuration: WorkloadConfiguration,
  selection: ConfigurationSelection | undefined,
): CatalogSelectionRead {
  const workName = selection?.work ?? configuration.defaults.work;
  if (!Object.hasOwn(configuration.workloads, workName))
    return { selected: "Unknown", field: "work" };
  const planName = selection?.evaluation ?? configuration.defaults.evaluation;
  const stages = Object.hasOwn(configuration.plans, planName)
    ? configuration.plans[planName]
    : undefined;
  if (stages === undefined) return { selected: "Unknown", field: "evaluation" };
  const finalizerName =
    selection?.finalization ?? configuration.defaults.finalization;
  const finalizer =
    finalizerName === undefined ||
    !Object.hasOwn(configuration.finalizers ?? {}, finalizerName)
      ? undefined
      : configuration.finalizers?.[finalizerName];
  if (finalizerName !== undefined && finalizer === undefined)
    return { selected: "Unknown", field: "finalization" };
  return {
    selected: "Selected",
    value: {
      work: selectedCatalogWorkload(configuration, workName),
      plan: {
        name: planName,
        stages: stages.map((stage) => ({
          name: stage.name,
          evaluators: stage.evaluators.map((name) =>
            selectedCatalogWorkload(configuration, name),
          ),
        })),
      },
      ...(finalizerName === undefined || finalizer === undefined
        ? {}
        : { finalizer: { name: finalizerName, finalizer } }),
    },
  };
}

/** The workload one evaluator of a selected plan runs, by its stage and evaluator keys, each counting from one. */
export function selectedEvaluatorWorkload(
  selection: CatalogSelection,
  stage: number,
  evaluator: number,
): SelectedWorkload | undefined {
  return selection.plan.stages[stage - 1]?.evaluators[evaluator - 1];
}

/**
 * The first evaluator of a selected plan the worker runs itself, which is where
 * a ticket's own check lines join, by its stage and evaluator keys. A plan
 * commanding none has nowhere for them to go.
 */
export function selectedFirstCommandsEvaluator(
  selection: CatalogSelection,
): { readonly stage: number; readonly evaluator: number } | undefined {
  for (const [stageIndex, stage] of selection.plan.stages.entries()) {
    const evaluatorIndex = stage.evaluators.findIndex(
      (entry) => entry.workload.runner === "Commands",
    );
    if (evaluatorIndex !== -1)
      return { stage: stageIndex + 1, evaluator: evaluatorIndex + 1 };
  }
  return undefined;
}
