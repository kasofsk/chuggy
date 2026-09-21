import { z } from "zod";

import type { Config } from "../domain/config.ts";

const positiveInteger = z.number().int().positive();

export const domainConfigurationSchema = z
  .object({
    nTickets: positiveInteger,
    nTasks: positiveInteger,
    maxStages: positiveInteger,
  })
  .strict();

export function domainConfigurationOf(value: unknown): Config {
  return domainConfigurationSchema.parse(value);
}
