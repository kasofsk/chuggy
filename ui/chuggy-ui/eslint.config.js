// The console's own lint, because the root's is scoped to a tree this
// directory is not in: `eslint.config.js` at the root gives browser globals to
// `ui/**/*.js` and takes its type-aware program from the root `tsconfig.json`,
// and this console is TypeScript outside that program. So the root declines
// this directory and what runs over it is here, reached by `npm run lint`,
// which is what `.chug/tasks/check-console.sh` calls.
//
// THE HOUSE RULES THAT ARE ESLINT'S ARE RESTATED, NOT INHERITED. Rules 3, 4
// and 5 are stated at the root in the config that enforces them, and a second
// config enforcing them over a second program is the same rule applied twice
// rather than a second version of it: a console exempt from exhaustive
// switching or the function-length cap would be exempt for no reason anyone
// could state.
//
// `no-undef` IS OFF AND `tsconfig.json`'s `lib` IS WHAT REPLACES IT. The root
// keeps a hand-written roster of browser globals because its console is
// JavaScript that no program typechecks with a DOM library. This one is
// typechecked against `["es2023", "dom", "dom.iterable"]` and nothing else, so
// a capability outside that list is a compile error with a better message, and
// `no-undef` over TypeScript reports every ambient type as undefined.

import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.tools.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          allowDefaultCaseForExhaustiveSwitch: true,
          requireDefaultForNonUnion: true,
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "max-lines-per-function": [
        "error",
        { max: 70, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
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
  // This file, which no program of the console's typechecks and which runs on
  // Node rather than in a browser.
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { project: false } },
  },
);
