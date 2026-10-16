/**
 * The CPUs and memory one task runs with, resolved at release from its
 * configuration's `resources` and pinned with the rest of its material.
 *
 * EACH FIELD IS RESOLVED ON ITS OWN: the task kind's size, then
 * `ticketDefault`'s, and a field neither names is absent here, which every
 * placement reads as its deployment's own. A task that names neither field has
 * no size at all, so it runs as it did before a configuration could name one.
 */

import { z } from "zod";

import { configurationResourcesSchema } from "../contract/configurationDocument.ts";
import {
  executionTaskKindKey,
  type ExecutionTaskKind,
} from "./executionRequirement.ts";

/** The size one task asks for, in the units a placement asks in. */
export interface TaskResources {
  readonly cpuMillis?: number;
  readonly memoryMib?: number;
}

/** The millis one whole CPU is asked as. */
const taskResourcesMillisPerCpu = 1_000;

/** A size as a release stores it: at least one field, each a positive whole number. */
const taskResourcesStoredSchema = z
  .strictObject({
    cpuMillis: z.number().int().positive().optional(),
    memoryMib: z.number().int().positive().optional(),
  })
  .refine(
    (stored) =>
      stored.cpuMillis !== undefined || stored.memoryMib !== undefined,
  );

/** The size built from the fields named, or none where neither is. */
function taskResourcesNamed(
  cpuMillis: number | undefined,
  memoryMib: number | undefined,
): TaskResources | undefined {
  if (cpuMillis === undefined && memoryMib === undefined) return undefined;
  return {
    ...(cpuMillis === undefined ? {} : { cpuMillis }),
    ...(memoryMib === undefined ? {} : { memoryMib }),
  };
}

/**
 * The size one task of a configuration runs with, or none where it names none.
 * The configuration is one a release already found ready, so a size it cannot
 * read is a fault of the caller and throws.
 */
export function materializeTaskResources(
  configuration: unknown,
  kind: ExecutionTaskKind,
  stage?: number,
): TaskResources | undefined {
  const key = executionTaskKindKey(configuration, kind, stage);
  const resources = configurationResourcesSchema
    .optional()
    .parse(
      (configuration as { readonly resources?: unknown } | null)?.resources,
    );
  const kindSize = resources?.taskKindDefaults?.[key];
  const cpus = kindSize?.cpus ?? resources?.ticketDefault?.cpus;
  return taskResourcesNamed(
    cpus === undefined ? undefined : cpus * taskResourcesMillisPerCpu,
    kindSize?.memoryMib ?? resources?.ticketDefault?.memoryMib,
  );
}

/** A stored size read back, refusing one no release writes. */
export function asTaskResources(value: unknown): TaskResources {
  const parsed = taskResourcesStoredSchema.safeParse(value);
  const named = parsed.success
    ? taskResourcesNamed(parsed.data.cpuMillis, parsed.data.memoryMib)
    : undefined;
  if (named === undefined) throw new TypeError("task resources are malformed");
  return named;
}
