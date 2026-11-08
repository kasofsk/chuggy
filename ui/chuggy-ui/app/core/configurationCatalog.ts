/**
 * A version 2 or 3 configuration's canonical JSON, read into the catalog a
 * ticket selects from: its workloads, the plans that run them, its finalizers,
 * and the defaults a selection leaves standing.
 *
 * IT IS READ AS LOOSELY AS A DOCUMENT IS, every leaf on its own, so bytes that
 * are no catalog are none rather than a failed screen. A catalog is told from
 * a version 1 document by its own `version`, which is the one thing nothing
 * else on a ticket or a draft says.
 *
 * WHAT A SELECTION INITIALIZES IS DERIVED HERE, not read again: one stage per
 * stage of the selected plan, each with its evaluators, and the check lines on
 * the first stage a commands workload runs in — what the API's initialization
 * answers under that selection.
 */

import { z } from "zod";

import {
  briefFinalizationForward,
  briefFinalizationResponseSchema,
  type BriefFinalizationOf,
} from "../../../../src/contract/brief.ts";
import {
  configurationFollowings,
  finalizationConfigurationVersion,
  type ConfigurationFollowing,
  workloadConfigurationVersion,
} from "../../../../src/contract/configurationDocument.ts";
import type { ConfigurationSelection } from "../../../../src/contract/configurationSelection.ts";
import { briefFinalizationModes } from "../../../../src/contract/rosters.ts";
import type { DraftInitializationResponse } from "../../../../src/contract/responses.ts";
import type { Copy, CopyOrData, CopyText } from "./copy.ts";
import { configurationModelLabelOf } from "./configurationView.ts";

const optionalString = () => z.string().optional().catch(undefined);

const catalogWorkloadSchema = z.looseObject({
  runner: optionalString(),
  purpose: optionalString(),
  prompt: z
    .looseObject({ path: optionalString(), text: optionalString() })
    .optional()
    .catch(undefined),
  worker: z.looseObject({ mode: z.unknown() }).optional().catch(undefined),
  commands: z.array(z.string()).optional().catch(undefined),
  access: optionalString(),
});

const catalogModeSchema = z.looseObject({
  agent: optionalString(),
  effort: optionalString(),
  arguments: z.array(z.string()).optional().catch(undefined),
});

const catalogStageSchema = z.looseObject({
  name: z.string(),
  evaluators: z.array(z.string()),
});

const catalogSchema = z.looseObject({
  version: z.union([
    z.literal(workloadConfigurationVersion),
    z.literal(finalizationConfigurationVersion),
  ]),
  workloads: z.record(z.string(), z.unknown()),
  plans: z.record(z.string(), z.array(catalogStageSchema)),
  finalizers: z
    .record(
      z.string(),
      z.looseObject({
        approvalRequired: z.boolean().optional().catch(undefined),
        landing: z
          .looseObject({
            mode: z.enum(briefFinalizationModes),
            target: z.string().optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        finalization: briefFinalizationResponseSchema
          .optional()
          .catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
  defaults: z.looseObject({
    work: z.string(),
    evaluation: z.string(),
    finalization: z.string().optional().catch(undefined),
    configuration: z.enum(configurationFollowings).optional().catch(undefined),
  }),
});

/** One workload, as much of it as a reader choosing among them is shown. */
export interface CatalogWorkload {
  readonly name: string;
  /** Agent or Commands, as written; absent where the catalog names it by a file no import has read. */
  readonly runner: string | undefined;
  /** What it is as an evaluator, Review where it says nothing. */
  readonly purpose: string;
  /** Its agent's model, labelled; absent for a commands workload and for an
   * agent whose mode names none, which runs its agent's default. */
  readonly model: string | undefined;
  readonly prompt: string | undefined;
  readonly promptPath: string | undefined;
  readonly commands: readonly string[];
  /** The agent that runs it, as the mode names it. */
  readonly agent: string | undefined;
  /** Its reasoning effort, where the mode names one. */
  readonly effort: string | undefined;
  /** The arguments its agent is started with. */
  readonly agentArguments: readonly string[];
  /** The access it declares, where the catalog writes one. */
  readonly access: string | undefined;
  /** The workload exactly as the catalog writes it, for a view of it as a document. */
  readonly definition: unknown;
}

/** The model a workload's agent runs as a reader is shown it: the one it
 * names, or its agent's default, and none for a workload that runs no agent. */
export function catalogWorkloadModel(
  workload: CatalogWorkload,
): CopyOrData | undefined {
  if (workload.runner !== "Agent") return undefined;
  return workload.model ?? { id: "configuration-catalog-model-default" };
}

export interface CatalogPlanStage {
  readonly name: string;
  readonly evaluators: readonly string[];
}

export interface CatalogFinalizer {
  readonly name: string;
  readonly approvalRequired: boolean;
  /** The finalization a ticket it lands takes where its brief names none. */
  readonly finalization?: BriefFinalizationOf<string | undefined>;
}

export interface ConfigurationCatalog {
  readonly workloads: readonly CatalogWorkload[];
  readonly plans: ReadonlyMap<string, readonly CatalogPlanStage[]>;
  readonly finalizers: readonly CatalogFinalizer[];
  readonly defaults: {
    readonly work: string;
    readonly evaluation: string;
    readonly finalization?: string;
    readonly configuration?: ConfigurationFollowing;
  };
}

function configurationCatalogEntry(
  name: string,
  value: unknown,
): CatalogWorkload {
  const workload = catalogWorkloadSchema.safeParse(value).data;
  const agent = workload?.runner === "Agent";
  const mode = catalogModeSchema.safeParse(workload?.worker?.mode).data;
  return {
    name,
    runner: workload?.runner,
    purpose: workload?.purpose ?? "Review",
    model: agent
      ? configurationModelLabelOf(workload.worker?.mode).label
      : undefined,
    prompt: workload?.prompt?.text,
    promptPath: workload?.prompt?.path,
    commands: workload?.commands ?? [],
    agent: mode?.agent,
    effort: mode?.effort,
    agentArguments: mode?.arguments ?? [],
    access: workload?.access,
    definition: value,
  };
}

/**
 * A finalizer's finalization: a version 3 one's as it writes it, and a version
 * 2 one's landing mapped forward to its kind as the importer maps it, ordered
 * `Direct`.
 */
function catalogFinalizerFinalization(
  version: number,
  finalizer: NonNullable<z.output<typeof catalogSchema>["finalizers"]>[string],
): BriefFinalizationOf<string | undefined> | undefined {
  if (version === finalizationConfigurationVersion)
    return finalizer.finalization;
  const forward = briefFinalizationForward(finalizer.landing, undefined);
  return forward.forward === "Mapped" ? forward.finalization : undefined;
}

/** The catalog these bytes are, or none where they are any other document or no JSON at all. */
export function configurationCatalogOf(
  canonical: string,
): ConfigurationCatalog | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    return undefined;
  }
  const catalog = catalogSchema.safeParse(parsed).data;
  if (catalog === undefined) return undefined;
  return {
    workloads: Object.entries(catalog.workloads).map(([name, value]) =>
      configurationCatalogEntry(name, value),
    ),
    plans: new Map(Object.entries(catalog.plans)),
    finalizers: Object.entries(catalog.finalizers ?? {}).map(
      ([name, finalizer]) => {
        const finalization = catalogFinalizerFinalization(
          catalog.version,
          finalizer,
        );
        return {
          name,
          approvalRequired: finalizer.approvalRequired ?? false,
          ...(finalization === undefined ? {} : { finalization }),
        };
      },
    ),
    defaults: {
      work: catalog.defaults.work,
      evaluation: catalog.defaults.evaluation,
      ...(catalog.defaults.finalization === undefined
        ? {}
        : { finalization: catalog.defaults.finalization }),
      ...(catalog.defaults.configuration === undefined
        ? {}
        : { configuration: catalog.defaults.configuration }),
    },
  };
}

/**
 * The entries a ticket runs on: what it selects, and the catalog's default for
 * what it does not. The revision it follows is what it chose and nothing else,
 * so a catalog changing its default moves no ticket that chose.
 */
export interface CatalogSelected {
  readonly work: string;
  readonly evaluation: string;
  readonly finalization: string | undefined;
  readonly configuration: ConfigurationFollowing | undefined;
}

export function configurationCatalogSelected(
  catalog: ConfigurationCatalog,
  selection: ConfigurationSelection | undefined,
): CatalogSelected {
  return {
    work: selection?.work ?? catalog.defaults.work,
    evaluation: selection?.evaluation ?? catalog.defaults.evaluation,
    finalization: selection?.finalization ?? catalog.defaults.finalization,
    configuration: selection?.configuration,
  };
}

/** One workload by name, none where the catalog holds no such workload. */
export function configurationCatalogWorkload(
  catalog: ConfigurationCatalog,
  name: string,
): CatalogWorkload | undefined {
  return catalog.workloads.find((workload) => workload.name === name);
}

/** The selection with every entry naming its default left out, which is the selection a ticket taking it holds, and the revision it follows where it chose one. */
export function configurationCatalogSelection(
  catalog: ConfigurationCatalog,
  selected: CatalogSelected,
): ConfigurationSelection {
  const { defaults } = catalog;
  return {
    ...(selected.work === defaults.work ? {} : { work: selected.work }),
    ...(selected.evaluation === defaults.evaluation
      ? {}
      : { evaluation: selected.evaluation }),
    ...(selected.finalization === undefined ||
    selected.finalization === defaults.finalization
      ? {}
      : { finalization: selected.finalization }),
    ...(selected.configuration === undefined
      ? {}
      : { configuration: selected.configuration }),
  };
}

/**
 * An initialization read under the catalog's defaults, as it reads under this
 * selection instead: the selected plan's program, its stage count as the most
 * a program holds, and the key of the first stage a commands workload runs in,
 * counted from one as the program's are, without the note the server wrote of
 * the plan it read. A plan the catalog does not hold
 * leaves it as read.
 */
export function configurationCatalogInitialization(
  initialization: DraftInitializationResponse,
  selection: ConfigurationSelection | undefined,
): DraftInitializationResponse {
  const catalog = configurationCatalogOf(
    initialization.configuration.canonical,
  );
  if (catalog === undefined) return initialization;
  const plan = catalog.plans.get(
    configurationCatalogSelected(catalog, selection).evaluation,
  );
  if (plan === undefined) return initialization;
  const commanded = plan.findIndex((stage) =>
    stage.evaluators.some(
      (name) =>
        configurationCatalogWorkload(catalog, name)?.runner === "Commands",
    ),
  );
  const rest: DraftInitializationResponse = { ...initialization };
  delete rest.commandedCheckStage;
  delete rest.commandedCheckStageNote;
  return {
    ...rest,
    defaults: {
      ...initialization.defaults,
      program: plan.map((stage, index) => ({
        key: index + 1,
        evaluators: stage.evaluators.map((_name, position) => ({
          key: position + 1,
        })),
      })),
    },
    choices: { ...initialization.choices, programStagesMax: plan.length },
    ...(commanded === -1 ? {} : { commandedCheckStage: commanded + 1 }),
  };
}

/** One entry a reader may select, as a picker offers it. */
export interface CatalogChoice {
  readonly value: string;
  readonly text: string;
}

/** What a landing asks before it proceeds, as the line beside its name. */
export function catalogFinalizerApproval(finalizer: CatalogFinalizer): Copy {
  return finalizer.approvalRequired
    ? { id: "configuration-catalog-approved-first" }
    : { id: "configuration-catalog-lands-unapproved" };
}

/** What each field of a selection chooses among, the catalog's default marked as one. */
export interface CatalogChoices {
  readonly work: readonly CatalogChoice[];
  readonly evaluation: readonly CatalogChoice[];
  readonly finalization: readonly CatalogChoice[];
}

function configurationCatalogChoice(
  text: CopyText,
  name: string,
  detail: CopyOrData,
  defaulted: string | undefined,
): CatalogChoice {
  return {
    value: name,
    text: text(
      name === defaulted
        ? { id: "configuration-catalog-choice-default", args: { name, detail } }
        : { id: "configuration-catalog-choice", args: { name, detail } },
    ),
  };
}

/** What a workload runs, as the one word beside its name. */
function configurationCatalogRuns(workload: CatalogWorkload): CopyOrData {
  return (
    catalogWorkloadModel(workload) ??
    workload.runner ?? { id: "configuration-catalog-unread" }
  );
}

export function configurationCatalogChoices(
  catalog: ConfigurationCatalog,
  text: CopyText,
): CatalogChoices {
  const { defaults } = catalog;
  return {
    work: catalog.workloads.map((workload) =>
      configurationCatalogChoice(
        text,
        workload.name,
        configurationCatalogRuns(workload),
        defaults.work,
      ),
    ),
    evaluation: [...catalog.plans].map(([name, stages]) =>
      configurationCatalogChoice(
        text,
        name,
        stages.map((stage) => stage.name).join(" → "),
        defaults.evaluation,
      ),
    ),
    finalization: catalog.finalizers.map((finalizer) =>
      configurationCatalogChoice(
        text,
        finalizer.name,
        {
          id: finalizer.approvalRequired
            ? "configuration-catalog-choice-approved-first"
            : "configuration-catalog-choice-unapproved",
        },
        defaults.finalization,
      ),
    ),
  };
}
