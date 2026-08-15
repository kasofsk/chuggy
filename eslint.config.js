/**
 * The whole-tree lint. Defaults, not opinions: ESLint's own recommended set
 * and typescript-eslint's strict type-checked set, with two additions and one
 * relaxation. Three departures, and the relaxation is the one that matters,
 * because a rule turned down is the kind of change that gets described as
 * "defaults" and then is not.
 *
 *   ADDED 1. `switch-exhaustiveness-check` — "every discriminated union is
 *      switched exhaustively, with an assertNever default arm". `tsc` catches
 *      a missing arm only once the author has written the default; this
 *      catches the switch that never had one.
 *   ADDED 2. the purity block, spread in from `eslint.purity.config.js` — so
 *      the ambient-capability rules bind the whole-tree lint as well as the
 *      purity stage that runs them alone.
 *   RELAXED. `no-floating-promises`, narrowed by typescript-eslint's own
 *      documented `allowForKnownSafeCalls` entry for `node:test`, whose
 *      `test()` returns a promise the runner already awaits. Scoped to that
 *      package and those seven names; the rule is untouched everywhere else,
 *      which is what matters for s5's actor.
 *
 * Type-aware linting is on for `src/`, which is why `tsconfig.json` and this
 * file must agree about what is in the program: a source file outside
 * `include` fails to lint rather than linting loosely. Both now spell the
 * TypeScript extensions in full — `tsconfig.json` by including `src/**` and
 * letting tsc expand it, this file by naming `{ts,mts,cts}` — because a bare
 * `*.ts` glob let a `.mts` file be neither typechecked nor linted while the
 * gate printed clean.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

import purity from "./eslint.purity.config.js";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "model/**", "dist/**", "coverage/**"],
  },
  {
    files: ["src/**/*.{ts,mts,cts}"],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
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
      // The relaxation named in the header. s5's actor is the place a dropped
      // promise would cost a journal write, and nothing here touches that.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            {
              from: "package",
              package: "node:test",
              name: [
                "after",
                "afterEach",
                "before",
                "beforeEach",
                "describe",
                "it",
                "test",
              ],
            },
          ],
        },
      ],
    },
  },
  ...purity,
  {
    // The config files themselves. They are not in the TypeScript program, so
    // the type-aware rules cannot apply to them and would error if they tried.
    // This block governs nothing under `src/`: JavaScript is not permitted
    // there, and `.chug/tasks/check-ts.sh` fails its types stage on any file
    // in that tree that is not `.ts`, `.mts` or `.cts`.
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
  },
);
