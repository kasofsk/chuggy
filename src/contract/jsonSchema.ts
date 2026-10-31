/**
 * A schema as the JSON Schema of what its parser takes, which is what a
 * client sends.
 *
 * zod writes its own `startsWith` check as the string format `starts_with`,
 * which JSON Schema does not define and a strict validator refuses; the
 * pattern beside it states the same constraint, so the format is dropped.
 */

import { z } from "zod";

export function contractJsonSchemaInput(
  schema: z.ZodType,
): z.core.JSONSchema.BaseSchema {
  return z.toJSONSchema(schema, {
    io: "input",
    override: ({ jsonSchema }) => {
      if (jsonSchema.format === "starts_with") delete jsonSchema.format;
    },
  });
}
