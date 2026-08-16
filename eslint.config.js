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

const domainForbiddenGlobals = [
  {
    name: "Date",
    message: "house rule 2: the domain takes time as an argument.",
  },
  {
    name: "process",
    message: "house rule 2: the domain reads no environment.",
  },
  { name: "fetch", message: "house rule 2: the domain reaches no network." },
  {
    name: "setTimeout",
    message: "house rule 2: the domain schedules nothing.",
  },
  {
    name: "setInterval",
    message: "house rule 2: the domain schedules nothing.",
  },
  {
    name: "setImmediate",
    message: "house rule 2: the domain schedules nothing.",
  },
  {
    name: "queueMicrotask",
    message: "house rule 2: the domain schedules nothing.",
  },
  {
    name: "crypto",
    message: "house rule 2: the domain takes identifiers as arguments.",
  },
  { name: "performance", message: "house rule 2: the domain reads no clock." },
  {
    name: "structuredClone",
    message: "house rule 2: the domain builds its own values.",
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
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", ...domainForbiddenGlobals],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "house rule 2: the domain takes its draws as arguments.",
        },
      ],
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
