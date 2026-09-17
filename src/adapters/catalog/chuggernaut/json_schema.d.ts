import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Ajv2019 } from "ajv/dist/2019.js";
export declare function schema_validator(
  schema: Readonly<Record<string, unknown>>,
): Ajv | Ajv2020 | Ajv2019;
