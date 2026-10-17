/**
 * A version 2 configuration's canonical JSON, read into the catalog a ticket
 * selects from: its workloads, the plans that run them, its finalizers, and
 * the defaults a selection leaves standing.
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

import { workloadConfigurationVersion } from "../../../../src/contract/configurationDocument.ts";
import type { ConfigurationSelection } from "../../../../src/contract/configurationSelection.ts";
import {
  briefFinalizationModes,
  type BriefFinalizationMode,
} from "../../../../src/contract/rosters.ts";
import type { DraftInitializationResponse } from "../../../../src/contract/responses.ts";
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
});

const catalogStageSchema = z.looseObject({
  name: z.string(),
  evaluators: z.array(z.string()),
});

const catalogSchema = z.looseObject({
  version: z.literal(workloadConfigurationVersion),
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
      }),
    )
    .optional()
    .catch(undefined),
  defaults: z.looseObject({
    work: z.string(),
    evaluation: z.string(),
    finalization: z.string().optional().catch(undefined),
  }),
});

/** One workload, as much of it as a reader choosing among them is shown. */
export interface CatalogWorkload {
  readonly name: string;
  /** Agent or Commands, as written; absent where the catalog names it by a file no import has read. */
  readonly runner: string | undefined;
  /** What it is as an evaluator, Review where it says nothing. */
  readonly purpose: string;
  /** Its agent's model, labelled; absent for a commands workload. */
  readonly model: string | undefined;
  readonly prompt: string | undefined;
  readonly promptPath: string | undefined;
  readonly commands: readonly string[];
}

export interface CatalogPlanStage {
  readonly name: string;
  readonly evaluators: readonly string[];
}

export interface CatalogFinalizer {
  readonly name: string;
  readonly approvalRequired: boolean;
  /** The landing a ticket it lands takes where its brief names none, and its target where it names one. */
  readonly landing?: {
    readonly mode: BriefFinalizationMode;
    readonly target?: string;
  };
}

export interface ConfigurationCatalog {
  readonly workloads: readonly CatalogWorkload[];
  readonly plans: ReadonlyMap<string, readonly CatalogPlanStage[]>;
  readonly finalizers: readonly CatalogFinalizer[];
  readonly defaults: {
    readonly work: string;
    readonly evaluation: string;
    readonly finalization?: string;
  };
}

function configurationCatalogEntry(
  name: string,
  value: unknown,
): CatalogWorkload {
  const workload = catalogWorkloadSchema.safeParse(value).data;
  const agent = workload?.runner === "Agent";
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
  };
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
      ([name, finalizer]) => ({
        name,
        approvalRequired: finalizer.approvalRequired ?? false,
        ...(finalizer.landing === undefined
          ? {}
          : {
              landing: {
                mode: finalizer.landing.mode,
                ...(finalizer.landing.target === undefined
                  ? {}
                  : { target: finalizer.landing.target }),
              },
            }),
      }),
    ),
    defaults: {
      work: catalog.defaults.work,
      evaluation: catalog.defaults.evaluation,
      ...(catalog.defaults.finalization === undefined
        ? {}
        : { finalization: catalog.defaults.finalization }),
    },
  };
}

/** The entries a ticket runs on: what it selects, and the catalog's default for what it does not. */
export interface CatalogSelected {
  readonly work: string;
  readonly evaluation: string;
  readonly finalization: string | undefined;
}

export function configurationCatalogSelected(
  catalog: ConfigurationCatalog,
  selection: ConfigurationSelection | undefined,
): CatalogSelected {
  return {
    work: selection?.work ?? catalog.defaults.work,
    evaluation: selection?.evaluation ?? catalog.defaults.evaluation,
    finalization: selection?.finalization ?? catalog.defaults.finalization,
  };
}

/** One workload by name, none where the catalog holds no such workload. */
export function configurationCatalogWorkload(
  catalog: ConfigurationCatalog,
  name: string,
): CatalogWorkload | undefined {
  return catalog.workloads.find((workload) => workload.name === name);
}

/** The selection with every field naming its default left out, which is the selection a ticket taking it holds. */
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
  };
}

/**
 * An initialization read under the catalog's defaults, as it reads under this
 * selection instead: the selected plan's program, its stage count as the most
 * a program holds, and the first stage a commands workload runs in. A plan
 * the catalog does not hold leaves it as read.
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
    ...(commanded === -1 ? {} : { commandedCheckStage: commanded }),
  };
}

/** One entry a reader may select, as a picker offers it. */
export interface CatalogChoice {
  readonly value: string;
  readonly text: string;
}

/** What each field of a selection chooses among, the catalog's default marked as one. */
export interface CatalogChoices {
  readonly work: readonly CatalogChoice[];
  readonly evaluation: readonly CatalogChoice[];
  readonly finalization: readonly CatalogChoice[];
}

function configurationCatalogChoice(
  name: string,
  detail: string,
  defaulted: string | undefined,
): CatalogChoice {
  const marked = name === defaulted ? " (default)" : "";
  return { value: name, text: `${name}${marked} · ${detail}` };
}

export function configurationCatalogChoices(
  catalog: ConfigurationCatalog,
): CatalogChoices {
  const { defaults } = catalog;
  return {
    work: catalog.workloads.map((workload) =>
      configurationCatalogChoice(
        workload.name,
        workload.model ?? workload.runner ?? "Unread",
        defaults.work,
      ),
    ),
    evaluation: [...catalog.plans].map(([name, stages]) =>
      configurationCatalogChoice(
        name,
        stages.map((stage) => stage.name).join(" → "),
        defaults.evaluation,
      ),
    ),
    finalization: catalog.finalizers.map((finalizer) =>
      configurationCatalogChoice(
        finalizer.name,
        finalizer.approvalRequired ? "approved first" : "lands unapproved",
        defaults.finalization,
      ),
    ),
  };
}
