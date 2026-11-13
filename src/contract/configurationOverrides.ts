/**
 * The parts of a configuration one ticket may replace, and the one function
 * that replaces them.
 *
 * A FIELD AN OVERRIDE NAMES REPLACES THE CONFIGURATION'S WHOLE, and a field it
 * does not name is the configuration's. Nothing is merged, so an author who
 * names a list reads what the ticket runs from the override alone.
 *
 * A VERSION 1 TICKET OVERRIDES ONLY HOW THE WORK IS DONE. The image and every
 * authority are what the repository's reviewed configuration asked of the
 * operator, and a replaced block that left its authority out would widen the
 * ticket past that review, which is why `work.instructions` is here and the
 * `work` block is not. A plan names its stages by position in `evaluations`,
 * so replacing that list would change what a key in an existing plan means.
 * Every other field is refused by the schema rather than dropped.
 *
 * A CATALOG TICKET OVERRIDES ANY FIELD OF A WORKLOAD, under `workloads` by the
 * name the catalog holds it under. Where a task runs is still bounded by the
 * runners whose pools declare what it requires, which no override reaches, so
 * an image or a requirement is overridable like the prompt. The two are one
 * placement, and naming either drops the other. A prompt named by path is the
 * text the catalog's import stored beside that path, so nothing reads a
 * repository after import.
 *
 * A CATALOG TICKET MAY ADD EVALUATORS AND PLANS. A name under `workloads` the
 * catalog lacks adds that workload, written whole, and a name under `plans`
 * replaces the catalog's plan whole or adds one. A catalog names its plans, so
 * replacing one changes what a key means in that plan alone, and a program's
 * keys stay positions in the plan selected. An added workload is only ever an
 * evaluator, since the work is selected from the catalog's own workloads.
 *
 * AN OVERRIDE RUNS NO LESS THAN THE CATALOG PLANS without the
 * `skip_planned_evaluations` permit. The plan a ticket would run without its
 * overrides is the one its selection names in the catalog, or the catalog's
 * default where the catalog names no such plan; `overridesPlanShort` holds
 * that for each workload name, the program runs it at no fewer positions of
 * the selected plan than the plan without the overrides holds it at. A
 * workload is the same evaluator under its name however a ticket overrides
 * its fields, so moving evaluators between stages is no less, and dropping
 * one, or one of several runs of it, is.
 *
 * THE EFFECTIVE CONFIGURATION IS STILL A CONFIGURATION, and it is judged by
 * whatever judges a pinned one: this module checks shape, never readiness.
 *
 * A PARKED TICKET'S OVERRIDES CHANGE ONLY WHERE ITS DEFINITION DOES NOT. The
 * deciding transaction compares the definition resolved under the overrides
 * a ticket holds with the one resolved under those offered, and that
 * comparison is the authority; `parkedTicketOverrideFields` is what a console
 * that cannot run it may offer.
 */

import { z } from "zod";

import {
  configurationCatalogEntriesMax,
  configurationCatalogNameSchema,
  evaluationPlanSchema,
  workloadOverrideSchema,
} from "./configurationDocument.ts";
import { codexReasoningEfforts } from "./workerTask.ts";

const overrideLinesSchema = z.array(z.string());

/** What one draft replaces of the configuration it names, each field optional. */
export const configurationOverridesSchema = z.strictObject({
  worker: z
    .strictObject({
      mode: z
        .union([
          z.strictObject({
            type: z.literal("SingleAgent"),
            agent: z.literal("Claude"),
            arguments: overrideLinesSchema,
          }),
          z.strictObject({
            type: z.literal("SingleAgent"),
            agent: z.literal("Codex"),
            arguments: overrideLinesSchema,
            model: z.string(),
            effort: z.enum(codexReasoningEfforts).exactOptional(),
          }),
        ])
        .optional(),
      setup: overrideLinesSchema.optional(),
      files: z
        .array(z.strictObject({ path: z.string(), content: z.string() }))
        .optional(),
    })
    .optional(),
  practices: overrideLinesSchema.optional(),
  brief: z
    .strictObject({
      motivation: overrideLinesSchema.optional(),
      acceptanceCriteria: overrideLinesSchema.optional(),
      constraints: overrideLinesSchema.optional(),
    })
    .optional(),
  work: z
    .strictObject({ instructions: overrideLinesSchema.optional() })
    .optional(),
  workloads: z
    .record(configurationCatalogNameSchema, workloadOverrideSchema)
    .refine(
      (workloads) =>
        Object.keys(workloads).length <= configurationCatalogEntriesMax,
    )
    .describe(
      `A catalog's workloads this ticket overrides, by name: under a name the catalog holds, the fields of that workload it replaces, and under one it lacks, an evaluator this ticket adds, written whole in the catalog's workload shape and named by some plan. At most ${String(configurationCatalogEntriesMax)} entries.`,
    )
    .optional(),
  plans: z
    .record(configurationCatalogNameSchema, evaluationPlanSchema)
    .refine(
      (plans) => Object.keys(plans).length <= configurationCatalogEntriesMax,
    )
    .describe(
      `A catalog's evaluation plans this ticket replaces or adds, by name, each written whole in the catalog's plan shape and naming workloads the catalog or this ticket's workloads hold. A plan running fewer positions of some workload than the plan the ticket's selection names in the catalog, or its default where the catalog names none, needs the project's skip_planned_evaluations permit. At most ${String(configurationCatalogEntriesMax)} entries.`,
    )
    .optional(),
});

/** What one ticket replaces of one catalog workload. */
export type WorkloadOverride = z.infer<typeof workloadOverrideSchema>;

export type ConfigurationOverrides = z.infer<
  typeof configurationOverridesSchema
>;

/**
 * The overrides an escalated ticket may change, by path: the fields a ticket's
 * definition does not fold. `work.instructions` is not one, being part of the
 * work stage's block, and an agent named in `worker.mode` is folded where the
 * requirement is a container capability, which is why this is an offer and
 * not the rule.
 */
export const parkedTicketOverrideFields = [
  "worker.mode",
  "worker.setup",
  "worker.files",
  "practices",
  "brief.motivation",
  "brief.acceptanceCriteria",
  "brief.constraints",
] as const;

function configurationOverridesIsRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One block with the fields the override names replaced, or the block itself where it names none. */
function configurationOverridesBlock(
  block: unknown,
  replaced: Readonly<Record<string, unknown>> | undefined,
): unknown {
  const named = Object.entries(replaced ?? {}).filter(
    ([, value]) => value !== undefined,
  );
  if (named.length === 0) return block;
  return {
    ...(configurationOverridesIsRecord(block) ? block : {}),
    ...Object.fromEntries(named),
  };
}

/** The prompt texts a catalog's import stored, by the path each was read from. */
function configurationOverridesPromptTexts(
  workloads: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, string> {
  return new Map(
    Object.values(workloads).flatMap((workload) => {
      const prompt = configurationOverridesIsRecord(workload)
        ? workload["prompt"]
        : undefined;
      return configurationOverridesIsRecord(prompt) &&
        typeof prompt["path"] === "string" &&
        typeof prompt["text"] === "string"
        ? [[prompt["path"], prompt["text"]] as const]
        : [];
    }),
  );
}

/**
 * The fields of a workload an override keeps: none where it names another
 * runner, since no field of one runner is a field of the other, and all but
 * the placement where it names an image or a requirement, the two being one
 * choice.
 */
function configurationOverridesWorkloadKept(
  workload: Readonly<Record<string, unknown>>,
  named: readonly (readonly [string, unknown])[],
): Readonly<Record<string, unknown>> {
  const fields = new Map(named);
  if (fields.has("runner") && fields.get("runner") !== workload["runner"])
    return {};
  const placed = fields.has("image") || fields.has("executionRequirement");
  return Object.fromEntries(
    Object.entries(workload).filter(
      ([field]) =>
        !placed || (field !== "image" && field !== "executionRequirement"),
    ),
  );
}

/** One workload with the fields an override names replaced, a prompt path read as the text stored beside it. */
function configurationOverridesWorkload(
  workload: unknown,
  override: WorkloadOverride,
  promptTexts: ReadonlyMap<string, string>,
): unknown {
  if (!configurationOverridesIsRecord(workload)) return workload;
  const named = Object.entries(override).filter(
    ([, value]) => value !== undefined,
  );
  const kept = configurationOverridesWorkloadKept(workload, named);
  const prompt = override.prompt;
  const text =
    prompt !== undefined && "path" in prompt
      ? promptTexts.get(prompt.path)
      : undefined;
  return {
    ...kept,
    ...Object.fromEntries(named),
    ...(text === undefined || prompt === undefined
      ? {}
      : { prompt: { ...prompt, text } }),
  };
}

/** A catalog's workloads with each one an override names replaced, and each it lacks added as the override writes it. */
function configurationOverridesWorkloads(
  workloads: unknown,
  overrides: Readonly<Record<string, WorkloadOverride>> | undefined,
): unknown {
  if (overrides === undefined || !configurationOverridesIsRecord(workloads))
    return workloads;
  const promptTexts = configurationOverridesPromptTexts(workloads);
  return {
    ...workloads,
    ...Object.fromEntries(
      Object.entries(overrides).map(([name, override]) => [
        name,
        configurationOverridesWorkload(
          Object.hasOwn(workloads, name) ? workloads[name] : {},
          override,
          promptTexts,
        ),
      ]),
    ),
  };
}

/** How many times each workload name stands in a list of names. */
function overridesPlanRuns(
  names: readonly string[],
): ReadonlyMap<string, number> {
  const runs = new Map<string, number>();
  for (const name of names) runs.set(name, (runs.get(name) ?? 0) + 1);
  return runs;
}

/**
 * Whether a program over the plan a ticket selected runs less than the plan
 * it would run without its overrides: some workload name `planned` lists at
 * more positions than the program runs it at. Each plan is its stages'
 * evaluator names in position order, and the program's keys count from one.
 */
export function overridesPlanShort(
  planned: readonly (readonly string[])[],
  selected: readonly (readonly string[])[],
  program: readonly {
    readonly key: number;
    readonly evaluators: readonly { readonly key: number }[];
  }[],
): boolean {
  const ran = overridesPlanRuns(
    program.flatMap((stage) =>
      stage.evaluators.flatMap((evaluator) => {
        const name = selected[stage.key - 1]?.[evaluator.key - 1];
        return name === undefined ? [] : [name];
      }),
    ),
  );
  return [...overridesPlanRuns(planned.flat())].some(
    ([name, runs]) => (ran.get(name) ?? 0) < runs,
  );
}

/**
 * The configuration one ticket runs: the pinned document with the overrides
 * applied. Without overrides it is the document itself, so a ticket naming
 * none is defined, admitted and briefed exactly as its configuration is, and a
 * document that is not an object is answered as it stands for its reader to
 * refuse.
 */
export function configurationWithOverrides(
  document: unknown,
  overrides: ConfigurationOverrides | undefined,
): unknown {
  if (overrides === undefined || !configurationOverridesIsRecord(document))
    return document;
  const effective: Record<string, unknown> = { ...document };
  const blocks = {
    worker: overrides.worker,
    brief: overrides.brief,
    work: overrides.work,
  };
  for (const [field, replaced] of Object.entries(blocks)) {
    const block = configurationOverridesBlock(document[field], replaced);
    if (block !== document[field]) effective[field] = block;
  }
  if (overrides.practices !== undefined)
    effective["practices"] = overrides.practices;
  if (overrides.workloads !== undefined)
    effective["workloads"] = configurationOverridesWorkloads(
      document["workloads"],
      overrides.workloads,
    );
  const plans = document["plans"];
  if (overrides.plans !== undefined && configurationOverridesIsRecord(plans))
    effective["plans"] = { ...plans, ...overrides.plans };
  return effective;
}
