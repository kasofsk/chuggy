/**
 * A prefix a string must start with is published as its pattern alone, so a
 * strict validator compiles the schema and still holds a value to the prefix.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";

import { contractJsonSchemaInput } from "../../src/contract/jsonSchema.ts";

const prefixed = contractJsonSchemaInput(z.string().startsWith("https://"));

test("a prefix names no format", () => {
  assert.equal(prefixed.format, undefined);
});

test("a strict validator holds a value to the prefix", () => {
  const validate = new Ajv2020({ strict: true }).compile(prefixed);
  assert.equal(validate("https://example.invalid"), true);
  assert.equal(validate("http://example.invalid"), false);
});
