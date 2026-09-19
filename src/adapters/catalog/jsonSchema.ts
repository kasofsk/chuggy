import { Ajv, type Options } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Ajv2019 } from "ajv/dist/2019.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export function schema_validator(
  schema: Readonly<Record<string, unknown>>,
): Ajv | Ajv2020 | Ajv2019 {
  const options: Options = {
    strict: false,
    allErrors: true,
    validateFormats: false,
  };
  const dialect =
    typeof schema["$schema"] === "string" ? schema["$schema"] : "";
  if (dialect.includes("draft-04")) {
    const Draft4 = require("ajv-draft-04") as typeof Ajv;
    return new Draft4(options);
  }
  if (dialect.includes("2019-09")) return new Ajv2019(options);
  if (dialect.includes("draft-07")) return new Ajv(options);
  if (dialect.includes("draft-06")) {
    const engine = new Ajv(options);
    const draft6 = require("ajv/dist/refs/json-schema-draft-06.json") as Record<
      string,
      unknown
    >;
    engine.addMetaSchema(draft6);
    return engine;
  }
  return new Ajv2020(options);
}
