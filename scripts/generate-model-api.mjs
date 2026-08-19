#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const root = fileURLToPath(new globalThis.URL("../", import.meta.url));
const argument = (name) => {
  const prefix = `--${name}=`;
  return globalThis.process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
};
// TWO ARTIFACTS, AND THE BOUNDARY IS WHY. `domain-is-pure` forbids src/domain/
// reaching any module outside itself, so the types the domain reads may import
// nothing at all — including zod. They are emitted inside src/domain/, and the
// schemas and codecs that need a runtime stay at the edge.
const outputTypes =
  argument("out-types") ?? join(root, "src/domain/generated/modelTypes.ts");
const outputSchemas =
  argument("out-schemas") ?? join(root, "src/generated/model-api.ts");
const suppliedIr = argument("ir");
const irPath = join(
  tmpdir(),
  `chuggy-model-api-${globalThis.process.pid}.json`,
);
const quint = join(root, "node_modules/.bin/quint");

function fail(message) {
  globalThis.process.stderr.write(`generate-model-api: ${message}\n`);
  globalThis.process.exit(2);
}

rmSync(irPath, { force: true });
let compiled = { stderr: "", stdout: "" };
if (!suppliedIr) {
  compiled = spawnSync(
    quint,
    [
      "compile",
      "model/api.qnt",
      "--target=json",
      "--flatten=false",
      "--init=apiInit",
      "--step=apiStep",
      `--out=${irPath}`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (compiled.error) fail(compiled.error.message);
}

let ir;
try {
  ir = JSON.parse(readFileSync(suppliedIr ?? irPath, "utf8"));
} catch (error) {
  fail((compiled.stderr || compiled.stdout || error.message).trim());
} finally {
  if (!suppliedIr) rmSync(irPath, { force: true });
}

if (ir.stage !== "compiling" || ir.errors?.length) {
  fail("Quint did not produce a clean compiling-stage IR");
}

const declarations = new Map();
for (const module of ir.modules ?? []) {
  for (const declaration of module.declarations ?? []) {
    if (declaration.kind === "typedef") {
      if (declarations.has(declaration.name))
        fail(`duplicate type ${declaration.name}`);
      declarations.set(declaration.name, declaration.type);
    }
  }
}

const apiModule = ir.modules?.find((module) => module.name === "chuggy_api");
if (!apiModule) fail("compiled IR has no chuggy_api module");
const exports = (apiModule.declarations ?? [])
  .filter(
    (declaration) =>
      declaration.kind === "typedef" && declaration.name.startsWith("Api"),
  )
  .map((declaration) => ({
    source: declaration.name,
    name: declaration.name.slice(3),
    type: declaration.type,
  }));
if (exports.length === 0) fail("chuggy_api exports no Api* types");

const publicName = new Map(exports.map(({ source, name }) => [source, name]));
for (const { name } of exports) publicName.set(name, name);
for (const entry of exports) {
  if (
    entry.type.kind === "const" &&
    (publicName.get(entry.type.name) ?? entry.type.name) === entry.name
  ) {
    const target = declarations.get(entry.type.name);
    if (!target)
      fail(`${entry.name}: unresolved Quint alias ${entry.type.name}`);
    entry.type = target;
  }
}

function rowFields(row, owner) {
  if (row?.kind !== "row" || row.other?.kind !== "empty") {
    fail(`${owner}: open or malformed rows are unsupported`);
  }
  return row.fields ?? [];
}

function deps(type, owner, found = new Set()) {
  switch (type.kind) {
    case "bool":
    case "int":
    case "str":
      return found;
    case "const":
      found.add(publicName.get(type.name) ?? type.name);
      return found;
    case "list":
    case "set":
      return deps(type.elem, owner, found);
    case "fun":
      deps(type.arg, owner, found);
      return deps(type.res, owner, found);
    case "rec":
    case "tup":
    case "sum":
      for (const field of rowFields(type.fields, owner))
        deps(field.fieldType, owner, found);
      return found;
    default:
      fail(
        `${owner}: unsupported Quint type kind ${JSON.stringify(type.kind)}`,
      );
  }
}

const byName = new Map(exports.map((entry) => [entry.name, entry]));
const ordered = [];
const visiting = new Set();
const visited = new Set();
function visit(name) {
  if (visited.has(name)) return;
  if (visiting.has(name))
    fail(`${name}: recursive public types are unsupported`);
  const entry = byName.get(name);
  if (!entry) fail(`${name}: referenced type is not exported by model/api.qnt`);
  visiting.add(name);
  for (const dependency of deps(entry.type, name))
    if (dependency !== name) visit(dependency);
  visiting.delete(name);
  visited.add(name);
  ordered.push(entry);
}
for (const { name } of exports) visit(name);

function resolve(type, owner) {
  if (type.kind !== "const") return type;
  const target = declarations.get(type.name);
  if (!target) fail(`${owner}: unresolved Quint type ${type.name}`);
  return target;
}

function ts(type, owner) {
  switch (type.kind) {
    case "bool":
      return "boolean";
    case "int":
      return "number";
    case "str":
      return "string";
    case "const": {
      const name = publicName.get(type.name) ?? type.name;
      if (!byName.has(name))
        fail(`${owner}: ${type.name} is not in the API boundary`);
      return name;
    }
    case "list":
      return `readonly ${ts(type.elem, owner)}[]`;
    case "set":
      return `ReadonlySet<${ts(type.elem, owner)}>`;
    case "fun":
      return `ReadonlyMap<${ts(type.arg, owner)}, ${ts(type.res, owner)}>`;
    case "rec":
      return `{ ${rowFields(type.fields, owner)
        .map((f) => `readonly ${f.fieldName}: ${ts(f.fieldType, owner)}`)
        .join("; ")} }`;
    case "tup":
      return `readonly [${rowFields(type.fields, owner)
        .map((f) => ts(f.fieldType, owner))
        .join(", ")}]`;
    case "sum":
      return rowFields(type.fields, owner)
        .map((field) => {
          const payload = field.fieldType;
          const unit =
            payload.kind === "tup" &&
            rowFields(payload.fields, owner).length === 0;
          return unit
            ? JSON.stringify(field.fieldName)
            : `{ readonly type: ${JSON.stringify(field.fieldName)}; readonly value: ${ts(payload, owner)} }`;
        })
        .join(" | ");
    default:
      fail(
        `${owner}: unsupported Quint type kind ${JSON.stringify(type.kind)}`,
      );
  }
}

/**
 * A sum's schema, whichever representation is being emitted. The two differ
 * only in how they render an arm's payload, so that is the argument: a nullary
 * arm is its own tag either way, and a single-arm sum is not a union.
 */
function sumSchema(type, owner, payloadSchema) {
  const members = rowFields(type.fields, owner).map((field) => {
    const payload = field.fieldType;
    const unit =
      payload.kind === "tup" && rowFields(payload.fields, owner).length === 0;
    return unit
      ? `z.literal(${JSON.stringify(field.fieldName)})`
      : `z.object({ type: z.literal(${JSON.stringify(field.fieldName)}), value: ${payloadSchema(payload, owner)} }).readonly()`;
  });
  return members.length === 1 ? members[0] : `z.union([${members.join(", ")}])`;
}

function schemaName(name) {
  return `${name[0].toLowerCase()}${name.slice(1)}Schema`;
}
function schema(type, owner) {
  switch (type.kind) {
    case "bool":
      return "z.boolean()";
    case "int":
      return "z.number().int().safe()";
    case "str":
      return "z.string()";
    case "const": {
      const name = publicName.get(type.name) ?? type.name;
      if (!byName.has(name))
        fail(`${owner}: ${type.name} is not in the API boundary`);
      return schemaName(name);
    }
    case "list":
      return `z.array(${schema(type.elem, owner)}).readonly()`;
    case "set":
      return `z.set(${schema(type.elem, owner)}).readonly()`;
    case "fun":
      return `z.map(${schema(type.arg, owner)}, ${schema(type.res, owner)}).readonly()`;
    case "rec":
      return `z.object({ ${rowFields(type.fields, owner)
        .map(
          (f) =>
            `${JSON.stringify(f.fieldName)}: ${schema(f.fieldType, owner)}`,
        )
        .join(", ")} }).readonly()`;
    case "tup":
      return `z.tuple([${rowFields(type.fields, owner)
        .map((f) => schema(f.fieldType, owner))
        .join(", ")}]).readonly()`;
    case "sum":
      return sumSchema(type, owner, schema);
    default:
      fail(
        `${owner}: unsupported Quint type kind ${JSON.stringify(type.kind)}`,
      );
  }
}

function wireSchema(type, owner) {
  switch (type.kind) {
    case "bool":
      return "z.boolean()";
    case "int":
      return "z.number().int().safe()";
    case "str":
      return "z.string()";
    case "const": {
      const name = publicName.get(type.name) ?? type.name;
      if (!byName.has(name))
        fail(`${owner}: ${type.name} is not in the API boundary`);
      return `${schemaName(name)}Wire`;
    }
    case "list":
      return `z.array(${wireSchema(type.elem, owner)}).readonly()`;
    case "set":
      return `z.array(${wireSchema(type.elem, owner)}).refine(distinctJson, { message: "set contains a duplicate" }).transform((items) => new Set(items))`;
    case "fun":
      return `z.array(z.tuple([${wireSchema(type.arg, owner)}, ${wireSchema(type.res, owner)}])).refine((entries) => distinctJson(entries.map(([key]) => key)), { message: "map contains a duplicate key" }).transform((entries) => new Map(entries))`;
    case "rec":
      return `z.object({ ${rowFields(type.fields, owner)
        .map(
          (f) =>
            `${JSON.stringify(f.fieldName)}: ${wireSchema(f.fieldType, owner)}`,
        )
        .join(", ")} }).readonly()`;
    case "tup":
      return `z.tuple([${rowFields(type.fields, owner)
        .map((f) => wireSchema(f.fieldType, owner))
        .join(", ")}]).readonly()`;
    case "sum":
      return sumSchema(type, owner, wireSchema);
    default:
      fail(
        `${owner}: unsupported Quint type kind ${JSON.stringify(type.kind)}`,
      );
  }
}

const banner = [
  "/** Generated by scripts/generate-model-api.mjs from model/api.qnt.",
  " * Do not edit by hand; run `node scripts/generate-model-api.mjs`. */",
  "",
];

// Written as a specifier rather than a constant so the two artifacts may be
// emitted anywhere, which is what lets a suite put both in one temp directory.
const typesSpecifier = (() => {
  const path = relative(dirname(outputSchemas), outputTypes).replace(
    /\\/g,
    "/",
  );
  return path.startsWith(".") ? path : `./${path}`;
})();

const typeLines = [...banner];
const lines = [
  ...banner,
  'import * as z from "zod";',
  "",
  `import type { ${ordered.map((entry) => entry.name).join(", ")} } from ${JSON.stringify(typesSpecifier)};`,
  "",
  "export type ModelJson = null | boolean | number | string | readonly ModelJson[] | { readonly [key: string]: ModelJson };",
  "",
  "function encodeJson(value: unknown): ModelJson {",
  '  if (value === null || typeof value === "boolean" || typeof value === "string") return value;',
  '  if (typeof value === "number") { if (!Number.isSafeInteger(value)) throw new TypeError("model integer is not a safe JavaScript integer"); return value; }',
  "  if (value instanceof Set) return [...value].map(encodeJson);",
  "  if (value instanceof Map) return [...value].map(([key, item]) => [encodeJson(key), encodeJson(item)]);",
  "  if (Array.isArray(value)) return value.map(encodeJson);",
  '  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeJson(item)]));',
  '  throw new TypeError("value is not a model JSON value");',
  "}",
  "",
  "function distinctJson(values: readonly unknown[]): boolean {",
  "  const seen = new Set<string>();",
  "  for (const value of values) { const key = JSON.stringify(value); if (seen.has(key)) return false; seen.add(key); }",
  "  return true;",
  "}",
  "",
];
for (const entry of ordered) {
  typeLines.push(`export type ${entry.name} = ${ts(entry.type, entry.name)};`);
  lines.push(
    `export const ${schemaName(entry.name)}: z.ZodType<${entry.name}> = ${schema(entry.type, entry.name)};`,
  );
  lines.push(
    `const ${schemaName(entry.name)}Wire: z.ZodType<${entry.name}> = ${wireSchema(entry.type, entry.name)};`,
  );
  lines.push(
    `export function encode${entry.name}(value: ${entry.name}): ModelJson { return encodeJson(value); }`,
  );
  lines.push(
    `export function decode${entry.name}(value: unknown): ${entry.name} { return ${schemaName(entry.name)}Wire.parse(value); }`,
  );
  const concrete = resolve(entry.type, entry.name);
  if (concrete.kind === "sum") {
    const tags = rowFields(concrete.fields, entry.name).map((field) =>
      JSON.stringify(field.fieldName),
    );
    typeLines.push(
      `export const ${entry.name[0].toLowerCase()}${entry.name.slice(1)}Tags = [${tags.join(", ")}] as const;`,
    );
  }
  typeLines.push("");
  lines.push("");
}
// BOTH ARTIFACTS, OR THE GATE HALF-CHECKS. A --check that reads one of them
// reports current while the other is stale, which is the same verdict a reader
// believes and does not check again.
const artifacts = [
  {
    path: outputTypes,
    text: await format(`${typeLines.join("\n")}\n`, { filepath: outputTypes }),
  },
  {
    path: outputSchemas,
    text: await format(`${lines.join("\n")}\n`, { filepath: outputSchemas }),
  },
];

if (globalThis.process.argv.includes("--check")) {
  const stale = artifacts.filter((artifact) => {
    let current;
    try {
      current = readFileSync(artifact.path, "utf8");
    } catch {
      current = undefined;
    }
    return current !== artifact.text;
  });
  if (stale.length > 0) {
    for (const artifact of stale)
      globalThis.process.stderr.write(
        `generate-model-api: ${relative(root, artifact.path)} is stale; regenerate it\n`,
      );
    globalThis.process.exit(1);
  }
} else {
  for (const artifact of artifacts) writeFileSync(artifact.path, artifact.text);
}
