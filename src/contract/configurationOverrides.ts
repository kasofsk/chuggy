/**
 * The parts of a configuration one ticket may replace, and the one function
 * that replaces them.
 *
 * A FIELD AN OVERRIDE NAMES REPLACES THE CONFIGURATION'S WHOLE, and a field it
 * does not name is the configuration's. Nothing is merged, so an author who
 * names a list reads what the ticket runs from the override alone.
 *
 * ONLY HOW THE WORK IS DONE IS OVERRIDABLE. The image and every authority are
 * what the repository's reviewed configuration asked of the operator, and a
 * replaced block that left its authority out would widen the ticket past that
 * review, which is why `work.instructions` is here and the `work` block is
 * not. A plan names its stages by position in `evaluations`, so replacing that
 * list would change what a key in an existing plan means. Every other field is
 * refused by the schema rather than dropped.
 *
 * THE EFFECTIVE CONFIGURATION IS STILL A CONFIGURATION, and it is judged by
 * whatever judges a pinned one: this module checks shape, never readiness.
 */

import { z } from "zod";

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
});

export type ConfigurationOverrides = z.infer<
  typeof configurationOverridesSchema
>;

/**
 * The overrides a parked ticket may change, by path: the fields its definition
 * does not fold, so not `work.instructions`, which the work stage's block does.
 * A change is still judged by resolving the definition both ways, because the
 * agent `worker.mode` names is folded where the requirement is a container
 * capability.
 */
export const parkedOverrideFields = [
  "worker.mode",
  "worker.setup",
  "worker.files",
  "practices",
  "brief.motivation",
  "brief.acceptanceCriteria",
  "brief.constraints",
] as const;
export type ParkedOverrideField = (typeof parkedOverrideFields)[number];

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
  return effective;
}
