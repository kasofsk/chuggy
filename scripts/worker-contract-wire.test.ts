import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

/** What `reading` makes of a package of `modules` whose entries are `entries`, each package in a directory of its own because a module is imported once per path. */
async function packaged<Read>(
  modules: Readonly<Record<string, string>>,
  entries: readonly string[],
  reading: (directory: string) => Promise<Read>,
): Promise<Read> {
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
    return await reading(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The wire of a package of `modules` whose entries are `entries`. */
async function wireOf(
  modules: Readonly<Record<string, string>>,
  entries: readonly string[] = ["contract"],
): Promise<string> {
  return packaged(modules, entries, workerContractWireAt);
}

/** Asserts the wire of `modules` is refused, and that the refusal opens with `refusal`. */
async function refused(
  modules: Readonly<Record<string, string>>,
  refusal: string,
): Promise<void> {
  await assert.rejects(wireOf(modules), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.slice(0, refusal.length), refusal);
    return true;
  });
}

/** A contract exporting what `expression` makes as `s`, beneath `declaring`. */
function exporting(expression: string, declaring = ""): string {
  return `import { z } from "zod";\n${declaring}\nexport const s = ${expression};\n`;
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
export const identity = z.object({ record: z.string().optional() }).refine((value) => value.record === undefined);
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

test("a name no module declares and no global the language defines is refused", async () => {
  for (const [reading, name] of [
    ["value.length <= mystery", "mystery"],
    ["value !== process.env.LIMIT", "process"],
    ["value !== globalThis.limit", "globalThis"],
    ['value !== eval("value")', "eval"],
    ['value !== Function("return value")()', "Function"],
  ] as const)
    await refused(
      { contract: contract("", reading) },
      `contract.ts: ${name} is declared nowhere the digest can read, and is no global the language defines`,
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
      /contract\.ts#identity\.checks\[0\]\.fn: no module the package ships declares its source/u,
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

/** For each key the allowlist reads, and for the kind itself, two schemas that differ there alone. */
const keyRows: readonly (readonly [string, string, string])[] = [
  ["kind", "z.boolean()", "z.never()"],
  ["check kind", "z.number().gt(1)", "z.number().lt(1)"],
  ["array element", "z.array(z.string())", "z.array(z.number())"],
  ["array checks", "z.array(z.string())", "z.array(z.string()).min(1)"],
  [
    "refinement fn",
    "z.string().refine((value) => value.length > 1)",
    "z.string().refine((value) => value.length > 2)",
  ],
  [
    "refinement error",
    'z.string().refine((value) => value.length > 1, "short")',
    'z.string().refine((value) => value.length > 1, "brief")',
  ],
  ["enum entries", 'z.enum(["a", "b"])', 'z.enum(["a", "c"])'],
  ["literal values", 'z.literal("a")', 'z.literal("b")'],
  ["nullable innerType", "z.string().nullable()", "z.number().nullable()"],
  ["number checks", "z.number()", "z.number().gt(0)"],
  ["safe integer abort", "z.int()", "z.int({ abort: true })"],
  [
    "object shape",
    "z.object({ a: z.string() })",
    "z.object({ b: z.string() })",
  ],
  ["object catchall", "z.object({})", "z.strictObject({})"],
  ["object checks", "z.object({})", "z.object({}).refine(() => true)"],
  ["optional innerType", "z.string().optional()", "z.number().optional()"],
  [
    "record keyType",
    "z.record(z.string(), z.string())",
    "z.record(z.string().min(1), z.string())",
  ],
  [
    "record valueType",
    "z.record(z.string(), z.string())",
    "z.record(z.string(), z.number())",
  ],
  ["string checks", "z.string()", "z.string().min(1)"],
  [
    "datetime local",
    "z.iso.datetime({ pattern: /^a$/u })",
    "z.iso.datetime({ local: true, pattern: /^a$/u })",
  ],
  [
    "datetime offset",
    "z.iso.datetime({ pattern: /^a$/u })",
    "z.iso.datetime({ offset: true, pattern: /^a$/u })",
  ],
  [
    "datetime precision",
    "z.iso.datetime({ pattern: /^a$/u })",
    "z.iso.datetime({ precision: 3, pattern: /^a$/u })",
  ],
  [
    "datetime pattern",
    "z.iso.datetime({ pattern: /^a$/u })",
    "z.iso.datetime({ pattern: /^b$/u })",
  ],
  ["url abort", "z.url()", "z.url({ abort: true })"],
  [
    "union options",
    "z.union([z.string(), z.number()])",
    "z.union([z.number(), z.string()])",
  ],
  [
    "union discriminator",
    'z.discriminatedUnion("a", [z.object({ a: z.literal("x"), b: z.literal("y") })])',
    'z.discriminatedUnion("b", [z.object({ a: z.literal("x"), b: z.literal("y") })])',
  ],
  [
    "union inclusive",
    "z.union([z.string(), z.number()])",
    "z.xor([z.string(), z.number()])",
  ],
  ["greater-than value", "z.number().gt(1)", "z.number().gt(2)"],
  ["greater-than inclusive", "z.number().gt(1)", "z.number().gte(1)"],
  ["less-than value", "z.number().lt(1)", "z.number().lt(2)"],
  ["less-than inclusive", "z.number().lt(1)", "z.number().lte(1)"],
  ["maximum length", "z.string().max(1)", "z.string().max(2)"],
  ["minimum length", "z.string().min(1)", "z.string().min(2)"],
  ["regex source", "z.string().regex(/^a$/u)", "z.string().regex(/^b$/u)"],
  ["regex flags", "z.string().regex(/^a$/u)", "z.string().regex(/^a$/iu)"],
  [
    "starts-with prefix",
    'z.string().startsWith("a", { pattern: /^a/u })',
    'z.string().startsWith("b", { pattern: /^a/u })',
  ],
  [
    "starts-with pattern",
    'z.string().startsWith("a", { pattern: /^a/u })',
    'z.string().startsWith("a", { pattern: /^b/u })',
  ],
];

for (const [key, before, after] of keyRows)
  test(`a zod schema's ${key} moves the wire`, async () => {
    assert.notEqual(
      await wireOf({ contract: exporting(before) }),
      await wireOf({ contract: exporting(after) }),
    );
  });

test("a zod schema or check of a kind the allowlist does not name is refused", async () => {
  for (const [expression, refusal] of [
    [
      "z.string().superRefine(() => undefined)",
      "contract.ts#s.checks[0]: a zod check of kind custom",
    ],
    [
      "z.string().trim()",
      "contract.ts#s.checks[0]: a zod check of kind overwrite",
    ],
    [
      "z.map(z.string(), z.string())",
      "contract.ts#s: a zod schema of kind map",
    ],
    ['z.string().default("a")', "contract.ts#s: a zod schema of kind default"],
  ] as const)
    await refused({ contract: exporting(expression) }, refusal);
});

test("a key the allowlist does not read on a zod kind is refused where it sits", async () => {
  for (const [expression, refusal] of [
    [
      "z.coerce.number()",
      "contract.ts#s.coerce: a key a zod number is not read with",
    ],
    [
      'z.string().refine((value) => value.length > 1, { path: ["a"] })',
      "contract.ts#s.checks[0].path: a key a zod custom/custom is not read with",
    ],
    [
      "z.string().refine((value) => value.length > 1, { abort: true })",
      "contract.ts#s.checks[0].abort: a key a zod custom/custom is not read with",
    ],
  ] as const)
    await refused({ contract: exporting(expression) }, refusal);
});

test("a symbol key on a zod definition is refused", async () => {
  await refused(
    { contract: exporting('z.string({ [Symbol.for("k")]: 8 } as never)') },
    "contract.ts#s: a symbol key on a zod string",
  );
});

test("a when zod did not write is refused", async () => {
  await refused(
    {
      contract: exporting(
        "z.string().check(z.maxLength(8, { when: () => true }))",
      ),
    },
    "contract.ts#s.checks[0].when: a when zod did not write",
  );
});

test("an error that is not a message is refused", async () => {
  await refused(
    {
      contract: exporting(
        'z.string().refine((value) => value.length > 1, { error: () => "short" })',
      ),
    },
    "contract.ts#s.checks[0].error: an error that is not a message",
  );
});

test("a zod schema carrying metadata is refused", async () => {
  for (const expression of [
    'z.string().describe("a")',
    'z.string().meta({ title: "a" })',
  ])
    await refused(
      { contract: exporting(expression) },
      "contract.ts#s: zod metadata",
    );
});

test("an object that is not plain, an array or a regular expression is refused", async () => {
  for (const [expression, what] of [
    ["new Set([1])", "an object a Set made"],
    ["new Map([[1, 2]])", "an object a Map made"],
    ["new Date(0)", "an object a Date made"],
    ["new (class Limits {})()", "an object a Limits made"],
    ["Object.create(null)", "an object whose prototype is not Object's"],
    ["Object.create({ most: 8 })", "an object whose prototype is not Object's"],
  ] as const)
    await refused(
      { contract: exporting(expression) },
      `contract.ts#s: ${what}`,
    );
});

test("a symbol is refused", async () => {
  await refused(
    { contract: exporting('Symbol("a")') },
    "contract.ts#s: a symbol",
  );
});

test("a symbol key is refused", async () => {
  await refused(
    { contract: exporting('{ [Symbol.for("k")]: 8 }') },
    "contract.ts#s: a symbol key",
  );
});

test("a hidden key or an accessor is refused", async () => {
  for (const expression of [
    'Object.defineProperty({}, "k", { value: 8 })',
    "{ get k() { return 8; } }",
  ])
    await refused(
      { contract: exporting(expression) },
      "contract.ts#s.k: a hidden key or an accessor",
    );
});

test("an array with a hole, an accessor or a key of its own is refused", async () => {
  for (const expression of [
    "[1, , 3]",
    "Object.defineProperty([1], 0, { get: () => 2, enumerable: true })",
    "Object.assign([1], { k: 2 })",
  ])
    await refused(
      { contract: exporting(expression) },
      "contract.ts#s: an array with a hole, an accessor or a key of its own",
    );
});

test("a function carrying properties is refused", async () => {
  for (const [expression, declaring] of [
    ["Object.assign((value: string) => value.length > 1, { most: 8 })", ""],
    ["Limits", "class Limits { static most = 8; }"],
  ] as const)
    await refused(
      { contract: exporting(expression, declaring) },
      "contract.ts#s: a function carrying properties",
    );
});

test("a value that holds itself is refused", async () => {
  await refused(
    {
      contract: exporting(
        "held",
        "const held = (() => { const made: Record<string, unknown> = {}; made.self = made; return made; })();",
      ),
    },
    "contract.ts#s.self: a value that holds itself",
  );
});

test("NaN, the infinities, minus zero, a bigint and a plain object shaped like a tag each read as themselves", async () => {
  for (const [before, after] of [
    ["NaN", "null"],
    ["Infinity", "-Infinity"],
    ["-0", "0"],
    ["8n", '"8"'],
    ['{ number: "NaN" }', "NaN"],
  ] as const)
    assert.notEqual(
      await wireOf({ contract: exporting(before) }),
      await wireOf({ contract: exporting(after) }),
    );
});

test("an export that is undefined is not an export left out", async () => {
  assert.notEqual(
    await wireOf({ contract: exporting("undefined") }),
    await wireOf({ contract: "export {};\n" }),
  );
});

test("this or super bound outside the source the digest reads is refused", async () => {
  for (const [expression, declaring, word] of [
    [
      "new Bound(8).schema()",
      "class Bound { most: number; constructor(most: number) { this.most = most; } schema() { return z.string().refine((value) => value.length <= this.most); } }",
      "this",
    ],
    [
      "bounds.schema()",
      "const bounds = { most: 8, schema() { return z.string().refine((value) => value.length <= this.most); } };",
      "this",
    ],
    [
      "z.string().refine(new Bound().fits)",
      "class Bound { most = 8; fits = (value: string): boolean => value.length <= this.most; }",
      "this",
    ],
    [
      "bounds.schema()",
      "const base = { most: 8 };\nconst bounds = { __proto__: base, schema() { return z.string().refine((value) => value.length <= super.most); } };",
      "super",
    ],
    [
      "z.string().refine((value) => value !== most)",
      "const most = this;",
      "this",
    ],
  ] as const)
    await refused(
      { contract: exporting(expression, declaring) },
      `contract.ts: ${word} is bound outside the source the digest reads`,
    );
});

test("arguments is refused", async () => {
  await refused(
    {
      contract: exporting(
        "z.string().refine(function (value) { return arguments.length === 1 && value.length > 1; })",
      ),
    },
    "contract.ts: arguments is read, which the digest cannot follow to a call",
  );
});

test("import.meta, new.target and a dynamic import are refused", async () => {
  for (const [expression, declaring, read] of [
    [
      "z.string().refine((value) => value !== import.meta.url)",
      "",
      "import.meta",
    ],
    [
      "z.string().refine(fits)",
      "function fits(value: string): boolean { return new.target === undefined && value.length > 1; }",
      "new.target",
    ],
    [
      'z.string().refine((value) => import("./limits.ts") !== undefined && value.length > 1)',
      "",
      'import("./limits.ts")',
    ],
  ] as const)
    await refused(
      {
        contract: exporting(expression, declaring),
        limits: "export const limit = 8;\n",
      },
      `contract.ts: ${read} reads what no name declares`,
    );
});

test("a top-level let or var is refused", async () => {
  for (const declaring of ["let limit = 8;", "var limit = 8;"])
    await refused(
      { contract: contract(declaring, "value.length <= limit") },
      "contract.ts declares a top-level let or var",
    );
});

test("a top-level statement that is not an import, an export or a declaration is refused", async () => {
  for (const [declaring, statement] of [
    ['const kinds: string[] = [];\nkinds.push("a");', "ExpressionStatement"],
    ['for (const kind of ["a"]) void kind;', "ForOfStatement"],
    ["if (Math.random() > 2) void 0;", "IfStatement"],
  ] as const)
    await refused(
      { contract: contract(declaring, "value.length > 1") },
      `contract.ts runs a top-level ${statement}`,
    );
});

test("an assignment, an update or a delete in code that runs while a module loads is refused", async () => {
  for (const [declaring, written] of [
    [
      "const limits = { most: 8 };\nconst written = (limits.most = 9);",
      "limits.most",
    ],
    ["const counts = [0];\nconst counted = counts[0]++;", "counts[0]"],
    [
      "const limits: { most?: number } = { most: 8 };\nconst dropped = delete limits.most;",
      "limits.most",
    ],
    [
      "const limits = { most: 8 };\nclass Limits { static { limits.most = 9; } }",
      "limits.most",
    ],
    [
      "const limits = { most: 8 };\nclass Limits { static most = (limits.most = 9); }",
      "limits.most",
    ],
  ] as const)
    await refused(
      { contract: contract(declaring, "value.length > 1") },
      `contract.ts writes ${written} while it loads`,
    );
});

test("zod's namespace, a static method and a built-in passed as a function are read", async () => {
  const shapes: readonly ((limit: string) => Record<string, string>)[] = [
    (limit) => ({
      contract: `import * as z from "zod";\nexport const s = z.string().max(${limit});\n`,
    }),
    (limit) => ({
      contract: exporting(
        "z.string().refine(Checks.fits)",
        `class Checks { static fits(value: string): boolean { return value.length <= ${limit}; } }`,
      ),
    }),
    (limit) => ({
      contract: exporting(`z.number().refine(Number.isInteger).max(${limit})`),
    }),
  ];
  for (const shape of shapes)
    assert.notEqual(await wireOf(shape("8")), await wireOf(shape("9")));
});

test("a name is followed to its own declaration, not to an export that shares its name", async () => {
  const shadowed = (limit: string) => ({
    contract: contract(
      `const limit = ${limit};\nconst other = 20;\nexport { other as limit };`,
      "value.length <= limit",
    ),
  });
  assert.notEqual(await wireOf(shadowed("8")), await wireOf(shadowed("9")));
});

test("the wire is the same in every locale", async () => {
  const reader = new URL("./worker-contract-wire.ts", import.meta.url).href;
  const [plain, lithuanian] = await packaged(
    {
      contract: contract(
        "const typeMax = 8;\nconst tokenMax = 9;",
        "value.length <= typeMax && value.length <= tokenMax",
      ),
    },
    ["contract"],
    (directory) =>
      Promise.resolve(
        ["C", "lt_LT.UTF-8"].map(
          (locale) =>
            spawnSync(
              process.execPath,
              [
                "--input-type=module",
                "--eval",
                `import { workerContractWireAt } from ${JSON.stringify(reader)};\nconsole.log(await workerContractWireAt(${JSON.stringify(directory)}));`,
              ],
              { encoding: "utf8", env: { ...process.env, LC_ALL: locale } },
            ).stdout,
        ),
      ),
  );
  assert.match(plain ?? "", /^[0-9a-f]{64}\n$/u);
  assert.equal(lithuanian, plain);
});
