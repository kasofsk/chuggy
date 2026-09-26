import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  workerContractWireAt,
  workerContractWireSourceText,
} from "./worker-contract-wire.ts";

const zod = fileURLToPath(new URL("../node_modules/zod", import.meta.url));

/** The wire of a package of `modules` whose entries are `entries`, each package in a directory of its own because a module is imported once per path. */
async function wireOf(
  modules: Readonly<Record<string, string>>,
  entries: readonly string[] = ["contract"],
): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "worker-contract-wire-"));
  try {
    mkdirSync(join(directory, "node_modules"));
    symlinkSync(zod, join(directory, "node_modules/zod"));
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "@chuggy/fixture",
        private: true,
        license: "MIT",
        type: "module",
        exports: Object.fromEntries(
          entries.map((entry) => [`./${entry}`, `./${entry}.ts`]),
        ),
        peerDependencies: {},
      }),
    );
    for (const [name, source] of Object.entries(modules))
      writeFileSync(join(directory, `${name}.ts`), source);
    return await workerContractWireAt(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** A contract whose one schema reads `reading`, beneath the `declaring` that binds whatever it reads. */
function contract(declaring: string, reading: string): string {
  return `import { z } from "zod";
${declaring}
export const identity = z.string().refine((value) => Number.isInteger(value.length) && ${reading});
`;
}

test("a comment, a re-wrap or a trailing comma moves no source, and a literal, an operator or a name does", () => {
  const written = workerContractWireSourceText(
    "(value) => { const bounded = isBoundedText(value, sessionIdentityCharsMax); return bounded && value.length > 1; }",
  );
  for (const formatted of [
    "(value) => {\n  /** why */\n  const bounded = isBoundedText(value, sessionIdentityCharsMax); return bounded && value.length > 1; }",
    "(value) => { const bounded = /* why */ isBoundedText(value, sessionIdentityCharsMax); // and\n return bounded && value.length > 1; }",
    "(value) => {\n  const bounded = isBoundedText(\n    value,\n    sessionIdentityCharsMax,\n  );\n  return bounded && value.length > 1;\n}",
    "(value) => { const bounded = isBoundedText(value, sessionIdentityCharsMax); return bounded && value.length > 0x1; }",
  ])
    assert.equal(workerContractWireSourceText(formatted), written);
  for (const changed of [
    "(value) => { const bounded = isBoundedText(value, sessionIdentityCharsMax); return bounded && value.length > 2; }",
    "(value) => { const bounded = isBoundedText(value, sessionIdentityCharsMax); return bounded && value.length >= 1; }",
    "(value) => { const bounded = isBoundedText(value, repositoryIdentityCharsMax); return bounded && value.length > 1; }",
  ])
    assert.notEqual(workerContractWireSourceText(changed), written);
});

test("a number is its value and a type is nothing, so neither a separator nor an annotation moves the wire", async () => {
  assert.equal(
    await wireOf({
      contract: contract(
        "const limit: number = 65_536 as number;",
        "value.length <= limit",
      ),
    }),
    await wireOf({
      contract: contract("const limit = 65536;", "value.length <= limit"),
    }),
  );
});

test("a bound a module keeps, a function it keeps, an aliased import and a destructured name are each followed, so changing the bound moves the wire", async () => {
  const shapes: readonly ((limit: string) => Record<string, string>)[] = [
    (limit) => ({
      contract: contract(`const limit = ${limit};`, "value.length <= limit"),
    }),
    (limit) => ({
      contract: contract(
        `function fits(value: string): boolean { return value.length <= ${limit}; }`,
        "fits(value)",
      ),
    }),
    (limit) => ({
      contract: contract(
        `import { limit as most } from "./limits.ts";`,
        "value.length <= most",
      ),
      limits: `export const limit = ${limit};\n`,
    }),
    (limit) => ({
      contract: contract(
        `const { limit: most } = { limit: ${limit} };`,
        "value.length <= most",
      ),
    }),
  ];
  for (const shape of shapes)
    assert.notEqual(await wireOf(shape("8")), await wireOf(shape("9")));
});

test("a module the entries never import is neither read nor refused", async () => {
  const loose = (separator: string) => ({
    contract: contract("const limit = 8;", "value.length <= limit"),
    loose: `import * as path from "node:path";\nconst { sep } = path;\nexport const joined = [sep, "${separator}"];\n`,
  });
  assert.equal(await wireOf(loose("a")), await wireOf(loose("b")));
});

test("a property sharing a declaration's name is not that declaration", async () => {
  const keeping = (record: string) => ({
    contract: `import { z } from "zod";
const record = ${record};
export const identity = z.record(z.string(), z.string()).refine((value) => value.record === undefined);
`,
  });
  assert.equal(await wireOf(keeping("8")), await wireOf(keeping("9")));
});

test("a bound a factory's closure carries is refused by module and name", async () => {
  await assert.rejects(
    wireOf({
      contract: `import { z } from "zod";
function isBoundedText(value: string, charsMax: number): boolean { return value.length <= charsMax; }
function boundedTextSchema(charsMax: number) { return z.string().refine((value) => isBoundedText(value, charsMax)); }
export const sessionIdentitySchema = boundedTextSchema(8);
`,
    }),
    /contract\.ts: charsMax is bound in an enclosing scope/u,
  );
});

test("a name no module declares and no global is is refused", async () => {
  await assert.rejects(
    wireOf({ contract: contract("", "value.length <= mystery") }),
    /contract\.ts: mystery is declared nowhere the digest can read/u,
  );
});

test("a name imported from a package other than zod is refused", async () => {
  await assert.rejects(
    wireOf({
      contract: contract(
        `import { sep } from "node:path";`,
        "!value.includes(sep)",
      ),
    }),
    /contract\.ts: sep is imported from node:path, which the package does not ship/u,
  );
});

test("a default import is refused", async () => {
  await assert.rejects(
    wireOf({
      contract: contract(`import fits from "./limits.ts";`, "fits(value)"),
      limits:
        "export default function fits(value: string): boolean { return value.length <= 8; }\n",
    }),
    /contract\.ts imports a default/u,
  );
});

test("a namespace import is refused", async () => {
  await assert.rejects(
    wireOf({
      contract: contract(
        `import * as limits from "./limits.ts";`,
        "value.length <= limits.limit",
      ),
      limits: "export const limit = 8;\n",
    }),
    /contract\.ts imports a namespace/u,
  );
});

test("a namespace export is refused", async () => {
  await assert.rejects(
    wireOf({
      contract: `export * as limits from "./limits.ts";\n`,
      limits: "export const limit = 8;\n",
    }),
    /contract\.ts exports a namespace/u,
  );
});

test("a function whose source no shipped module declares is refused", async () => {
  for (const held of [
    "fits.bind(null)",
    `new Function("value", "return value.length <= 8") as (value: string) => boolean`,
  ])
    await assert.rejects(
      wireOf({
        contract: `import { z } from "zod";
function fits(value: string): boolean { return value.length <= 8; }
export const identity = z.string().refine(${held});
`,
      }),
      /contract\.ts#identity: no module the package ships declares its source/u,
    );
});

test("an entry the manifest names and the package lacks is refused", async () => {
  await assert.rejects(
    wireOf(
      { contract: contract("const limit = 8;", "value.length <= limit") },
      ["contract", "absent"],
    ),
    /the manifest names .*absent\.ts, which is not there/u,
  );
});
