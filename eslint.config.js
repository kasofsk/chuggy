// Where house rules 2 through 5 are enforced, and therefore where they are
// stated. A rule with two homes has two versions of itself inside a year, so
// each of the four below is written here and nowhere else in this tree.
//
// RULE 2 — `src/domain/` reaches no I/O and no ambient capability. This file
// holds half of that: the ambient half, the globals a domain module may not
// name. The other half is reachability over the module graph, which no
// per-file linter can see, and it is `.dependency-cruiser.cjs` wrapped by
// `.chug/tasks/check-boundaries.sh`. Both halves are needed and neither is
// sufficient: a path helper inside the domain that imports a filesystem
// module names no forbidden global, and a decider that reads a clock imports
// nothing.
//
// THE ACTOR TAKES THE SAME AMBIENT HALF, under its own claim rather than house
// rule 2. Every step in `src/actor/` is a deterministic function of the state
// and its named picks, which is what makes crashing at every observable seam
// exhaustive rather than a scheduling problem; a clock read or a drawn number
// ends that and adds no edge for `actor-sees-domain-only` to catch. The roster
// of capabilities has one home, below — only the subject of the message
// differs, because only one of the layers is house rule 2's.
//
// SO DOES THE INTERPRETER, and for a reason of its own: its ports ARE its
// capabilities, and a capability it reached past them would be one no port
// declares, no adapter answers and no boundary rule can see. That it awaits is
// beside the point — the roster below is ambient authority, not asynchrony.
// `src/adapters/` is the one layer with no such block, because holding ambient
// capability is what an adapter is for and banning it there would ban the
// layer. What stands behind a stub that quietly read a clock is the reviewer
// and the suites, which is weaker, and is why the gap is one directory wide.
// The query checking scoped to `src/adapters/postgres/` at the bottom is a
// different subject — what a query claims, never what the layer may reach.
//
// RULE 3 — every discriminated union is switched exhaustively, with
// `assertNever` in the default arm. `switch-exhaustiveness-check` is the
// enforcement; `src/domain/assertNever.ts` is what the arm calls.
//
// RULE 4 — no floating promises.
//
// RULE 5 — a function is at most 70 lines, blank and comment lines excluded.
// The count is the linter's, so the rule cannot drift from what is measured.
//
// RULE 6 is Prettier's and is not restated here. RULE 1 is comment quantity,
// which needs the raw text rather than the syntax tree, and is
// `.chug/tasks/check-comments.sh`.
//
// WHY `recommendedTypeChecked` AND NOT `strictTypeChecked`. The strict set
// includes `no-unnecessary-condition`, which rejects a check the types have
// already proved cannot fail — and house rule 10 requires exactly those: a
// domain function asserts its arguments, its postconditions and the negative
// space, whether or not the compiler agrees they are reachable. Taking the
// strict set would mean disabling its most-cited rule everywhere, which is a
// worse statement of the same position. The individually strict rules that do
// not collide are enabled by name below.
//
// THE ADAPTER'S QUERIES ARE CHECKED AGAINST A LIVE SCHEMA when
// `CHUG_SAFEQL_DATABASE_URL` names a migrated database. The SafeQL block at
// the bottom loads its plugin only inside that guard, so a broken SQL parser
// can degrade only `.chug/tasks/check-queries.sh` — the gate that sets the
// variable — and never a plain `eslint .`. An editor opts in by exporting the
// variable against a migrated database of its own and gets the same
// diagnostics inline, with `--fix` writing the inferred row type at the call
// site. The unconditional block beside it is the half that needs no server:
// a query written as an untagged string, or written on a handle the checker
// does not read, is invisible to SafeQL either way, so both are findings on
// every run.

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// The capabilities a pure layer may not name, each with the sentence its
// message completes about the layer the block below is scoped to.
const ambientCapabilities = [
  { name: "Date", why: "takes time as an argument" },
  { name: "process", why: "reads no environment" },
  { name: "fetch", why: "reaches no network" },
  { name: "setTimeout", why: "schedules nothing" },
  { name: "setInterval", why: "schedules nothing" },
  { name: "setImmediate", why: "schedules nothing" },
  { name: "queueMicrotask", why: "schedules nothing" },
  { name: "crypto", why: "takes identifiers as arguments" },
  { name: "performance", why: "reads no clock" },
  { name: "structuredClone", why: "builds its own values" },
];

const noAmbientGlobals = (subject) => [
  "error",
  ...ambientCapabilities.map(({ name, why }) => ({
    name,
    message: `${subject} ${why}.`,
  })),
];

// The platform capability the console's files may name. Everything a browser
// and the suite runner both provide is spelled once here, and a name absent
// from it is `no-undef`.
const browserCapabilities = Object.fromEntries(
  [
    "AbortController",
    "TextDecoder",
    "TextEncoder",
    "URL",
    "URLSearchParams",
    "clearTimeout",
    "console",
    "crypto",
    "document",
    "fetch",
    "history",
    "location",
    "sessionStorage",
    "setTimeout",
    "window",
  ].map((name) => [name, "readonly"]),
);

const noAmbientDraws = (subject) => [
  "error",
  {
    object: "Math",
    property: "random",
    message: `${subject} takes its draws as arguments.`,
  },
];

// A query the checker cannot see is a claim nothing checks: an untagged
// string reaches the server as SQL and never reaches SafeQL, and so does a
// tagged one on a handle the checker's wrapper pattern does not name. A
// second values argument is unchecked too: pg replaces the values carried by
// the checked tag with that argument. So all three forms are findings
// unconditionally — no server needed — with transaction control exempt
// everywhere and the migration executor's variables exempt only where the
// caller passes their names.
const adapterQueriesTagged = (runtimeExemption) => [
  "error",
  {
    selector:
      "CallExpression[callee.property.name='query'][arguments.0.type='TemplateLiteral']",
    message:
      "adapter queries are sql-tagged: an untagged template is invisible to check-queries.",
  },
  {
    selector:
      "CallExpression[callee.property.name='query'][arguments.0.type='TaggedTemplateExpression']:not([arguments.0.tag.name='sql'])",
    message:
      "adapter queries use the sql tag from @ts-safeql/sql-tag; another tag is not checked.",
  },
  {
    selector:
      "CallExpression[callee.property.name='query'][arguments.0.type='TaggedTemplateExpression'][arguments.length>1]",
    message:
      "sql-tagged queries pass no separate values: pg would replace the checked tag's values.",
  },
  {
    selector:
      "CallExpression[callee.property.name='query'][arguments.0.type='Literal']:not([arguments.0.value=/^(BEGIN|COMMIT|ROLLBACK|BEGIN ISOLATION LEVEL [A-Z ]+|SET TRANSACTION [A-Z, ]+)$/])",
    message:
      "adapter queries are sql-tagged: a plain string is invisible to check-queries. Transaction control is the exemption.",
  },
  {
    selector: `CallExpression[callee.property.name='query'][arguments.0.type!='Literal'][arguments.0.type!='TemplateLiteral'][arguments.0.type!='TaggedTemplateExpression']${runtimeExemption}`,
    message: "a query assembled at runtime cannot be checked.",
  },
  {
    selector:
      "CallExpression[callee.property.name='query']:not([callee.object.name=/^(client|pool)$/])",
    message:
      "check-queries reads the queries on the client and pool handles; one on another handle is checked by nothing.",
  },
];

export default tseslint.config(
  // `.claude/` is the agent harness's, and the parallel worktrees live under
  // it: each one a whole checkout of this repo with a tsconfig of its own, so
  // a linter that walks in builds a type-aware program per worktree and
  // exhausts the heap on a checkout hosting a few. `.prettierignore` declines
  // the directory and `.jscpd.json` the worktrees under it, each for its own
  // tool; the gates scoped by `git ls-files` never see an untracked tree.
  {
    ignores: [
      "node_modules/**",
      "model/**",
      "docs/**",
      ".chug/**",
      ".claude/**",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          allowDefaultCaseForExhaustiveSwitch: true,
          requireDefaultForNonUnion: true,
        },
      ],
      // node:test's `test` returns a promise the runner owns and the caller
      // must not await; naming those functions is narrower than the blanket
      // exemption a `test/**` override would be, and it keeps the rule live
      // for every other promise a suite creates.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            {
              from: "package",
              package: "node:test",
              name: [
                "test",
                "it",
                "describe",
                "before",
                "after",
                "beforeEach",
                "afterEach",
              ],
            },
          ],
        },
      ],
      "@typescript-eslint/no-misused-promises": "error",
      "max-lines-per-function": [
        "error",
        { max: 70, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      // The rest of the strict set that does not collide with house rule 10,
      // each one a place the types already know something the code restates:
      // a value stringified without a `toString`, a type argument that is the
      // default, a union member another member subsumes, a caught value given
      // a type nothing checked.
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-unsafe-unary-minus": "error",
      "@typescript-eslint/no-duplicate-type-constituents": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
      "@typescript-eslint/no-unnecessary-type-arguments": "error",
      "@typescript-eslint/no-confusing-void-expression": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-globals": noAmbientGlobals("house rule 2: the domain"),
      "no-restricted-properties": noAmbientDraws("house rule 2: the domain"),
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "fs", "path", "os", "http*", "crypto"],
              message: "house rule 2: the domain imports no platform module.",
            },
            {
              group: ["../*", "../../*"],
              message:
                "house rule 2: a relative import leaving src/domain/ points outward. The graph rule is check-boundaries.sh.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/actor/**/*.ts"],
    rules: {
      "no-restricted-globals": noAmbientGlobals("the journaled actor"),
      "no-restricted-properties": noAmbientDraws("the journaled actor"),
    },
  },
  {
    files: ["src/interpreter/**/*.ts"],
    rules: {
      "no-restricted-globals": noAmbientGlobals("the interpreter"),
      "no-restricted-properties": noAmbientDraws("the interpreter"),
    },
  },
  // Untagged query strings and unread handles are findings everywhere in the
  // adapter; only the migration executor's own file may hand `.query` its
  // named variables.
  {
    files: ["src/adapters/postgres/**/*.ts"],
    rules: { "no-restricted-syntax": adapterQueriesTagged("") },
  },
  {
    files: ["src/adapters/postgres/pool.ts"],
    rules: {
      "no-restricted-syntax": adapterQueriesTagged(
        ":not([arguments.0.name=/^(statement|migrationLedger)$/])",
      ),
    },
  },
  // The adapter's queries, verified against the database the variable names.
  // The untaken branch never evaluates, so the plugin and its SQL parser
  // load only when the variable is set.
  ...(process.env.CHUG_SAFEQL_DATABASE_URL
    ? [
        {
          files: ["src/adapters/postgres/**/*.ts"],
          plugins: {
            "@ts-safeql": {
              rules: (await import("@ts-safeql/eslint-plugin")).rules,
            },
          },
          rules: {
            "@ts-safeql/check-sql": [
              "error",
              {
                connections: [
                  {
                    databaseUrl: process.env.CHUG_SAFEQL_DATABASE_URL,
                    targets: [{ wrapper: { regex: "(client|pool)\\.query" } }],
                  },
                ],
              },
            ],
          },
        },
      ]
    : []),
  // The configs themselves, and every console's document layer. Both sit
  // outside tsconfig.json's include, so the type-aware rules have no program to
  // ask and are turned off rather than left to fail on every run. A console's
  // `app/` is inside that include and is excluded here, so its decisions keep
  // house rules 3 and 4 while the DOM writes beneath them do not.
  {
    files: ["**/*.js", "**/*.mjs"],
    ignores: ["ui/*/app/**"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { process: "readonly" },
      parserOptions: { projectService: false },
    },
  },
  // The console runs in a browser, and this is the closed roster of platform
  // capability it may name: one it reaches for and this list does not carry is
  // `no-undef` rather than a runtime surprise in somebody's tab. `process` is
  // taken back from the block above, which grants it to a config file.
  {
    files: ["ui/**/*.js"],
    languageOptions: { globals: browserCapabilities },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "process", message: "the console runs in a browser." },
      ],
    },
  },
  {
    files: ["**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
      },
      parserOptions: { projectService: false },
    },
  },
);
