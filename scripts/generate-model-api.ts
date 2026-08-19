#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

/**
 * The compiled Quint IR, at the depth this generator reads it. It is a partial
 * shape rather than a translation of Quint's own: what is not named here is
 * what this file does not look at, and a kind it cannot represent is refused
 * rather than approximated.
 */
interface QuintRowField {
  readonly fieldName: string;
  readonly fieldType: QuintType;
}

interface QuintRow {
  readonly kind: string;
  readonly fields?: readonly QuintRowField[];
  readonly other?: QuintRow;
}

interface QuintType {
  readonly kind: string;
  readonly name?: string;
  readonly fields?: QuintRow;
  readonly elem?: QuintType;
  readonly arg?: QuintType;
  readonly res?: QuintType;
}

interface QuintDeclaration {
  readonly kind: string;
  readonly name?: string;
  readonly type?: QuintType;
}

interface QuintModule {
  readonly name: string;
  readonly declarations?: readonly QuintDeclaration[];
}

interface QuintIr {
  readonly stage?: string;
  readonly errors?: readonly unknown[];
  readonly modules?: readonly QuintModule[];
}

/** A typedef the boundary can use: one that has both a name and a type. */
type Named = QuintDeclaration & {
  readonly name: string;
  readonly type: QuintType;
};

/** One type on the API boundary: the Quint name, the public one, and what it is. */
interface ApiExport {
  readonly source: string;
  readonly name: string;
  type: QuintType;
}

const root = fileURLToPath(new globalThis.URL("../", import.meta.url));
const argument = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return globalThis.process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
};
/**
 * `domain-is-pure` forbids src/domain/ reaching any module outside itself, so
 * the types the domain reads may import nothing at all — zod included. They are
 * emitted inside src/domain/, and the schemas and codecs that need a runtime
 * stay at the edge.
 */
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

/**
 * An argument this script does not know is a refusal. A caller naming an output
 * that moved would otherwise be answered about the default one, and a --check
 * reporting on a file nobody asked about reports clean for the wrong reason.
 */
const known = new Set(["out-types", "out-schemas", "ir"]);
for (const value of globalThis.process.argv.slice(2)) {
  if (value === "--check") continue;
  const name = value.startsWith("--")
    ? (value.slice(2).split("=")[0] ?? "")
    : value;
  if (!known.has(name)) {
    globalThis.process.stderr.write(
      `generate-model-api: ${value} is not an argument this script takes\n`,
    );
    globalThis.process.exit(2);
  }
}

function fail(message: string): never {
  globalThis.process.stderr.write(`generate-model-api: ${message}\n`);
  globalThis.process.exit(2);
}

rmSync(irPath, { force: true });
let compiled: { stderr: string; stdout: string; error?: Error } = {
  stderr: "",
  stdout: "",
};
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

let ir: QuintIr;
try {
  ir = JSON.parse(readFileSync(suppliedIr ?? irPath, "utf8")) as QuintIr;
} catch (error: unknown) {
  const said = error instanceof Error ? error.message : String(error);
  fail((compiled.stderr || compiled.stdout || said).trim());
} finally {
  if (!suppliedIr) rmSync(irPath, { force: true });
}

if (ir.stage !== "compiling" || ir.errors?.length) {
  fail("Quint did not produce a clean compiling-stage IR");
}

const declarations = new Map<string, QuintType>();
for (const module of ir.modules ?? []) {
  for (const declaration of module.declarations ?? []) {
    if (declaration.kind !== "typedef") continue;
    const name = required(declaration.name, module.name, "typedef name");
    const type = required(declaration.type, name, "typedef body");
    if (declarations.has(name)) fail(`duplicate type ${name}`);
    declarations.set(name, type);
  }
}

const apiModule = ir.modules?.find(
  (module: QuintModule) => module.name === "chuggy_api",
);
if (!apiModule) fail("compiled IR has no chuggy_api module");
const exports: ApiExport[] = (apiModule.declarations ?? [])
  .filter(
    (declaration: QuintDeclaration): declaration is Named =>
      declaration.kind === "typedef" &&
      declaration.name !== undefined &&
      declaration.type !== undefined &&
      declaration.name.startsWith("Api"),
  )
  .map((declaration: Named) => ({
    source: declaration.name,
    name: declaration.name.slice(3),
    type: declaration.type,
  }));
if (exports.length === 0) fail("chuggy_api exports no Api* types");

const publicName = new Map<string, string>(
  exports.map(({ source, name }) => [source, name]),
);
for (const { name } of exports) publicName.set(name, name);
for (const entry of exports) {
  if (
    entry.type.kind === "const" &&
    (publicName.get(entry.type.name ?? "") ?? entry.type.name) === entry.name
  ) {
    const alias = required(entry.type.name, entry.name, "alias name");
    const target = declarations.get(alias);
    if (!target) fail(`${entry.name}: unresolved Quint alias ${alias}`);
    entry.type = target;
  }
}

/**
 * A field the kind guarantees, read as a fact rather than as an assumption.
 * Quint's IR carries `name` on a const and `arg`/`res` on a function, but the
 * shape above cannot say which kind carries which, so the guarantee is checked
 * where it is relied on.
 */
function required<Value>(
  value: Value | undefined,
  owner: string,
  what: string,
): Value {
  if (value === undefined) {
    fail(`${owner}: the compiled IR carries no ${what}`);
  }
  return value;
}

function rowFields(
  row: QuintRow | undefined,
  owner: string,
): readonly QuintRowField[] {
  if (row?.kind !== "row" || row.other?.kind !== "empty") {
    fail(`${owner}: open or malformed rows are unsupported`);
  }
  return row.fields ?? [];
}

function deps(
  type: QuintType,
  owner: string,
  found: Set<string> = new Set<string>(),
): Set<string> {
  switch (type.kind) {
    case "bool":
    case "int":
    case "str":
      return found;
    case "const": {
      const named = required(type.name, owner, "type name");
      found.add(publicName.get(named) ?? named);
      return found;
    }
    case "list":
    case "set":
      return deps(required(type.elem, owner, "element type"), owner, found);
    case "fun":
      deps(required(type.arg, owner, "domain"), owner, found);
      return deps(required(type.res, owner, "codomain"), owner, found);
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
const ordered: ApiExport[] = [];
const visiting = new Set();
const visited = new Set();
function visit(name: string): void {
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

function resolve(type: QuintType, owner: string): QuintType {
  if (type.kind !== "const") return type;
  const named = required(type.name, owner, "type name");
  const target = declarations.get(named);
  if (!target) fail(`${owner}: unresolved Quint type ${named}`);
  return target;
}

function ts(type: QuintType, owner: string): string {
  switch (type.kind) {
    case "bool":
      return "boolean";
    case "int":
      return "number";
    case "str":
      return "string";
    case "const": {
      const named = required(type.name, owner, "type name");
      const name = publicName.get(named) ?? named;
      if (!byName.has(name))
        fail(`${owner}: ${type.name} is not in the API boundary`);
      return name;
    }
    case "list":
      return `readonly ${ts(required(type.elem, owner, "element type"), owner)}[]`;
    case "set":
      return `ReadonlySet<${ts(required(type.elem, owner, "element type"), owner)}>`;
    case "fun":
      return `ReadonlyMap<${ts(required(type.arg, owner, "domain"), owner)}, ${ts(required(type.res, owner, "codomain"), owner)}>`;
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
function sumSchema(
  type: QuintType,
  owner: string,
  payloadSchema: (payload: QuintType, owner: string) => string,
): string {
  const members = rowFields(type.fields, owner).map((field) => {
    const payload = field.fieldType;
    const unit =
      payload.kind === "tup" && rowFields(payload.fields, owner).length === 0;
    return unit
      ? `z.literal(${JSON.stringify(field.fieldName)})`
      : `z.object({ type: z.literal(${JSON.stringify(field.fieldName)}), value: ${payloadSchema(payload, owner)} }).readonly()`;
  });
  return members.length === 1
    ? (members[0] ?? fail(`${owner}: a sum with one arm emitted nothing`))
    : `z.union([${members.join(", ")}])`;
}

function schemaName(name: string): string {
  return `${(name[0] ?? "").toLowerCase()}${name.slice(1)}Schema`;
}
/**
 * The leaf arms both schema emitters share: the scalars, and a reference to
 * another boundary type. Only the reference differs between them, which is what
 * `named` renders.
 */
function leafSchema(
  type: QuintType,
  owner: string,
  named: (name: string) => string,
): string | undefined {
  switch (type.kind) {
    case "bool":
      return "z.boolean()";
    case "int":
      return "z.number().int().safe()";
    case "str":
      return "z.string()";
    case "const": {
      const alias = required(type.name, owner, "type name");
      const name = publicName.get(alias) ?? alias;
      if (!byName.has(name))
        fail(`${owner}: ${alias} is not in the API boundary`);
      return named(name);
    }
    default:
      return undefined;
  }
}

function schema(type: QuintType, owner: string): string {
  const leaf = leafSchema(type, owner, (name) => schemaName(name));
  if (leaf !== undefined) return leaf;
  switch (type.kind) {
    case "list":
      return `z.array(${schema(required(type.elem, owner, "element type"), owner)}).readonly()`;
    case "set":
      return `z.set(${schema(required(type.elem, owner, "element type"), owner)}).readonly()`;
    case "fun":
      return `z.map(${schema(required(type.arg, owner, "domain"), owner)}, ${schema(required(type.res, owner, "codomain"), owner)}).readonly()`;
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

function wireSchema(type: QuintType, owner: string): string {
  const leaf = leafSchema(type, owner, (name) => `${schemaName(name)}Wire`);
  if (leaf !== undefined) return leaf;
  switch (type.kind) {
    case "list":
      return `z.array(${wireSchema(required(type.elem, owner, "element type"), owner)}).readonly()`;
    case "set":
      return `z.array(${wireSchema(required(type.elem, owner, "element type"), owner)}).refine(distinctJson, { message: "set contains a duplicate" }).transform((items) => new Set(items))`;
    case "fun":
      return `z.array(z.tuple([${wireSchema(required(type.arg, owner, "domain"), owner)}, ${wireSchema(required(type.res, owner, "codomain"), owner)}])).refine((entries) => distinctJson(entries.map(([key]) => key)), { message: "map contains a duplicate key" }).transform((entries) => new Map(entries))`;
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
  "/** Generated by scripts/generate-model-api.ts from model/api.qnt.",
  " * Do not edit by hand; run `node scripts/generate-model-api.ts`. */",
  "",
];

/**
 * Written as a specifier rather than a constant so the two artifacts may be
 * emitted anywhere, which is what lets a suite put both in one temp directory.
 */
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
      `export const ${(entry.name[0] ?? "").toLowerCase()}${entry.name.slice(1)}Tags = [${tags.join(", ")}] as const;`,
    );
  }
  typeLines.push("");
  lines.push("");
}
/**
 * Both artifacts, or the gate half-checks: a --check reading one of them reports
 * current while the other is stale.
 */
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
