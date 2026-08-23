/**
 * The configuration prelude every control-plane command shares: the database it
 * owns, the service runtime that drives it, and the decode that turns one
 * environment variable into parsed data.
 *
 * IT READS NO ENVIRONMENT OF ITS OWN. The record and the variable's name are
 * arguments, so each command names its own variable and this module stays a
 * total function from text to parsed data — the same argument
 * `src/roots/schedulerConfig.ts` makes for the scheduler's larger parser.
 *
 * THE PRELUDE IS SHARED BECAUSE THE TYPE ALREADY IS. Each command's
 * `*ProcessRootConfig` in `src/roots/controlPlane.ts` opens with the same
 * `ProcessDatabaseConfig` and `ServiceRuntimeConfig`; a command re-declaring
 * the schema that parses into them is restating a settled contract, and two
 * statements of one contract drift.
 *
 * A COUNT IS BOUNDED BY WHAT ARITHMETIC STAYS EXACT IN. `int()` refuses beyond
 * the safe integers, so a pool bound or a timeout cannot arrive at a magnitude
 * that compares and adds wrongly. The bound is the schema's, not this module's,
 * which is why a suite asserts it rather than a comment claiming it.
 *
 * WHAT A COMMAND STILL OWNS is every section past the prelude, and any check
 * spanning sections: this module refuses a value the schema rejects and
 * nothing else.
 */

import { z } from "zod";

import type { ProcessDatabaseConfig } from "./controlPlane.ts";

export const positiveInteger = z.number().int().positive();

/** The database a command owns, and the optional pool bounds it may override. */
export const commandDatabaseSchema = z
  .object({
    url: z.string().min(1),
    limits: z
      .object({
        connectionsMax: positiveInteger,
        connectionWaitMs: positiveInteger,
        statementTimeoutMs: positiveInteger,
      })
      .strict()
      .optional(),
  })
  .strict();

/** The service runtime's pacing, shared by every command that owns a process. */
export const commandRuntimeSchema = z
  .object({
    idleIntervalMilliseconds: positiveInteger,
    shutdownDrainMilliseconds: positiveInteger,
  })
  .strict();

/**
 * Narrows parsed database data to the process root's shape, omitting `limits`
 * rather than passing it undefined so the pool's own defaults still apply.
 */
export function commandDatabaseConfig(
  database: z.infer<typeof commandDatabaseSchema>,
): ProcessDatabaseConfig {
  return {
    url: database.url,
    ...(database.limits === undefined ? {} : { limits: database.limits }),
  };
}

/**
 * Reads one variable and parses it, naming the refused field rather than
 * echoing the value — a configuration carrying a credential must not reach a
 * diagnostic.
 */
export function decodedCommandConfiguration<Schema extends z.ZodType>(
  variable: string,
  schema: Schema,
  environment: NodeJS.ProcessEnv,
): z.infer<Schema> {
  const encoded = environment[variable];
  if (encoded === undefined || encoded.length === 0)
    throw new Error(`${variable} is required`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error(`${variable} must be valid JSON`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const path = result.error.issues[0]?.path.join(".") || "value";
    throw new Error(`${variable}.${path} is invalid`);
  }
  return result.data;
}
