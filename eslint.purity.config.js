/**
 * Half of the purity rule: `src/domain/` reaches no ambient capability.
 *
 * The other half — no transitive path out of the directory by import — is the
 * module graph, and it lives in `.dependency-cruiser.mjs`. A module graph
 * cannot see `Date.now()`, because a global is not an import; a lint rule
 * cannot see a three-hop path into `node:fs`, because it reads one file at a
 * time. Neither half is redundant and neither alone is the rule.
 *
 * This file is a standalone flat config so the purity stage of
 * `.chug/tasks/check-ts.sh` can run it by itself, in milliseconds, without the
 * type information the full lint needs. `eslint.config.js` spreads the same
 * array in, so the rules have one definition and the whole-tree lint enforces
 * them too.
 *
 * WHAT IT CATCHES: any lexical reference to a named ambient global, any
 * `Math.random()` or `Date.now()` property access, `eval`, `new Function`, a
 * dynamic `import()`, `require()`, and `import.meta`.
 *
 * WHAT IT CANNOT CATCH, stated rather than hoped: a capability reached by
 * computed name (`globalThis["Da" + "te"]` — though `globalThis` itself is
 * restricted, which closes the readable spellings), and a capability handed in
 * as an argument by an impure caller. The second is not a hole but the design:
 * a decider is pure with respect to what it is given, and the model's own
 * `Core` is exactly that argument. What forbids a *port* from reaching the
 * domain is the module-graph half, not this one.
 */

import tseslint from "typescript-eslint";

/** The directory this file exists to govern. */
export const DOMAIN_FILES = ["src/domain/**/*.ts"];

const why = (capability, reason) => ({
  name: capability,
  message: `src/domain/ may not reach \`${capability}\`: ${reason}`,
});

const NONDETERMINISM = "a replayed decision must produce the same record twice";
const AMBIENT_IO = "the domain decides; it never performs";
const HOST_COUPLING = "the domain runs identically wherever it is replayed";

const restrictedGlobals = [
  why("Date", NONDETERMINISM),
  why("performance", NONDETERMINISM),
  why("WeakRef", NONDETERMINISM),
  why("FinalizationRegistry", NONDETERMINISM),
  why("crypto", NONDETERMINISM),

  why("process", AMBIENT_IO),
  why("console", AMBIENT_IO),
  why("fetch", AMBIENT_IO),
  why("XMLHttpRequest", AMBIENT_IO),
  why("WebSocket", AMBIENT_IO),
  why("EventSource", AMBIENT_IO),
  why("navigator", AMBIENT_IO),
  why("localStorage", AMBIENT_IO),
  why("sessionStorage", AMBIENT_IO),
  why("indexedDB", AMBIENT_IO),

  why("setTimeout", AMBIENT_IO),
  why("setInterval", AMBIENT_IO),
  why("setImmediate", AMBIENT_IO),
  why("clearTimeout", AMBIENT_IO),
  why("clearInterval", AMBIENT_IO),
  why("clearImmediate", AMBIENT_IO),
  why("queueMicrotask", AMBIENT_IO),

  why("globalThis", HOST_COUPLING),
  why("global", HOST_COUPLING),
  why("window", HOST_COUPLING),
  why("document", HOST_COUPLING),
  why("Buffer", HOST_COUPLING),
  why("require", HOST_COUPLING),
  why("module", HOST_COUPLING),
  why("exports", HOST_COUPLING),
  why("__dirname", HOST_COUPLING),
  why("__filename", HOST_COUPLING),

  why("Atomics", "shared mutable state has no place below the single writer"),
  why(
    "SharedArrayBuffer",
    "shared mutable state has no place below the single writer",
  ),
];

export default [
  {
    files: DOMAIN_FILES,
    // The purity stage runs this config alone, so it carries the parser it
    // needs. None of these rules is type-aware, which is why the stage is fast
    // enough to be the one a developer runs on every save.
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-globals": ["error", ...restrictedGlobals],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: `src/domain/ may not reach \`Math.random\`: ${NONDETERMINISM}`,
        },
        {
          object: "Date",
          property: "now",
          message: `src/domain/ may not reach \`Date.now\`: ${NONDETERMINISM}`,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message:
            "src/domain/ may not use a dynamic import: the module graph must be statically checkable",
        },
        {
          selector: "MetaProperty[meta.name='import']",
          message: `src/domain/ may not read \`import.meta\`: ${HOST_COUPLING}`,
        },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
];
