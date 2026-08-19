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

const noAmbientDraws = (subject) => [
  "error",
  {
    object: "Math",
    property: "random",
    message: `${subject} takes its draws as arguments.`,
  },
];

export default tseslint.config(
  {
    ignores: ["node_modules/**", "model/**", "docs/**", ".chug/**"],
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
  // The configs themselves. They sit outside tsconfig.json's include, so the
  // type-aware rules have no program to ask and are turned off rather than
  // left to fail on every run.
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false } },
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
