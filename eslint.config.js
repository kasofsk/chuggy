/**
 * The whole-tree lint. Defaults, not opinions: ESLint's own recommended set
 * and typescript-eslint's strict type-checked set, with exactly two additions,
 * each of which mechanizes a line of ORCHESTRATION.md's engineering bar.
 *
 *   1. `switch-exhaustiveness-check` — "every discriminated union is switched
 *      exhaustively, with an assertNever default arm". `tsc` catches a missing
 *      arm only once the author has written the default; this catches the
 *      switch that never had one.
 *   2. the purity block, spread in from `eslint.purity.config.js` — so the
 *      ambient-capability rules bind the whole-tree lint as well as the
 *      purity stage that runs them alone.
 *
 * Type-aware linting is on for `src/`, which is why `tsconfig.json` and this
 * file must agree about what is in the program: a source file outside
 * `include` fails to lint rather than linting loosely.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

import purity from "./eslint.purity.config.js";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "model/**", "dist/**", "coverage/**"],
  },
  {
    files: ["src/**/*.ts"],
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
      // `node:test`'s `test()` returns a promise the runner already awaits,
      // and this is typescript-eslint's own documented shape for saying so.
      // The rule stays on everywhere else, which is the point: s5's actor is
      // the place a dropped promise would cost a journal write.
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
    files: ["**/*.js"],
    extends: [js.configs.recommended],
  },
);
