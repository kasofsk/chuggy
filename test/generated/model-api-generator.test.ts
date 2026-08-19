import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const generator = join(root, "scripts/generate-model-api.ts");
const quint = join(root, "node_modules/.bin/quint");

function fixture(mutator: (ir: Record<string, unknown>) => void): {
  readonly directory: string;
  readonly ir: string;
  readonly output: string;
  readonly types: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "chuggy-model-api-test-"));
  const ir = join(directory, "api.json");
  const output = join(directory, "model-api.ts");
  const types = join(directory, "modelTypes.ts");
  execFileSync(
    quint,
    [
      "compile",
      "model/api.qnt",
      "--target=json",
      "--flatten=false",
      "--init=apiInit",
      "--step=apiStep",
      `--out=${ir}`,
    ],
    { cwd: root },
  );
  const parsed = JSON.parse(readFileSync(ir, "utf8")) as Record<
    string,
    unknown
  >;
  mutator(parsed);
  writeFileSync(ir, JSON.stringify(parsed));
  return { directory, ir, output, types };
}

function apiDeclarations(
  ir: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const modules = ir["modules"] as Array<Record<string, unknown>>;
  const api = modules.find((module) => module["name"] === "chuggy_api");
  assert.ok(api, "fixture has chuggy_api module");
  return api["declarations"] as Array<Record<string, unknown>>;
}

test("generator emits a fixed tuple from compiled Quint IR", () => {
  const paths = fixture((ir) => {
    const declarations = apiDeclarations(ir);
    declarations.push({
      kind: "typedef",
      name: "ApiPair",
      type: {
        kind: "tup",
        fields: {
          kind: "row",
          fields: [
            { fieldName: "1", fieldType: { kind: "int" } },
            { fieldName: "2", fieldType: { kind: "str" } },
          ],
          other: { kind: "empty" },
        },
      },
    });
  });
  try {
    execFileSync(
      "node",
      [
        generator,
        `--ir=${paths.ir}`,
        `--out-schemas=${paths.output}`,
        `--out-types=${paths.types}`,
      ],
      { cwd: root },
    );
    const types = readFileSync(paths.types, "utf8");
    const generated = readFileSync(paths.output, "utf8");
    assert.match(types, /export type Pair = readonly \[number, string\]/);
    assert.doesNotMatch(
      types,
      /zod|z\./,
      "the domain reads this artifact, so it may import nothing",
    );
    assert.match(
      generated,
      /export const pairSchema: z\.ZodType<Pair> = z\s*\.tuple\(/,
    );
    assert.match(
      generated,
      /import type \{[^}]*Pair[^}]*\} from "\.\/modelTypes\.ts"/s,
    );
  } finally {
    rmSync(paths.directory, { force: true, recursive: true });
  }
});

test("generator refuses an unsupported Quint type instead of approximating it", () => {
  const paths = fixture((ir) => {
    const declarations = apiDeclarations(ir);
    declarations.push({
      kind: "typedef",
      name: "ApiUnsupported",
      type: { kind: "var", name: "T" },
    });
  });
  try {
    assert.throws(
      () =>
        execFileSync(
          "node",
          [
            generator,
            `--ir=${paths.ir}`,
            `--out-schemas=${paths.output}`,
            `--out-types=${paths.types}`,
          ],
          { cwd: root, stdio: "pipe" },
        ),
      /unsupported Quint type kind "var"/,
    );
  } finally {
    rmSync(paths.directory, { force: true, recursive: true });
  }
});
