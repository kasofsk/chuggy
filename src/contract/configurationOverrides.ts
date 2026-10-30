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

/** A catalog's workloads with each one an override names replaced; a name the catalog lacks is its reader's to refuse. */
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
      Object.entries(overrides)
        .filter(([name]) => Object.hasOwn(workloads, name))
        .map(([name, override]) => [
          name,
          configurationOverridesWorkload(
            workloads[name],
            override,
            promptTexts,
          ),
        ]),
    ),
  };
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
  return effective;
}
