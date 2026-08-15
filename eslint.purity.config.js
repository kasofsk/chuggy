/**
 * Half of the purity rule: `src/domain/` reaches no ambient capability.
 *
 * The other half — no transitive path out of the directory by import — is the
 * module graph, and it lives in `.dependency-cruiser.mjs`. A module graph
 * cannot see `Date.now()`, because a global is not an import; a lint rule
 * cannot see a three-hop path into `node:fs`, because it reads one file at a
 * time. Neither half is redundant and neither alone is the rule.
 *
 * THIS HALF IS A ROSTER, AND `.dependency-cruiser.mjs` ARGUES AGAINST ROSTERS.
 * The contradiction is real and worth stating rather than leaving to be found.
 * The graph half can be spelled as a closed predicate — nothing reachable from
 * the domain lies outside it — because "outside the domain" is decidable from
 * a path. Ambient capability has no such predicate: the set of globals a
 * JavaScript host offers is open, it grows with the runtime, and nothing about
 * the shape of `Intl` distinguishes it from `Map` except knowing what it does.
 * So this half is enumerated, which means it is exactly as complete as its
 * last sweep — and the sweep is therefore dated. A roster with a date is
 * honest; a roster presented as a closed rule is not.
 *
 * SWEPT 2026-08-15 against all 172 own properties of `globalThis` under node
 * 22.18.0, and CORRECTED 2026-08-15 after review. Rostered everything that
 * reads the world or introduces nondeterminism.
 *
 * THE CORRECTION IS THE INSTRUCTIVE PART, because it says how to run the next
 * sweep. The first pass classified by what a constructor is FOR, and two
 * entries it declined as inert data turned out to carry a clock in a property
 * nobody would think to name:
 *
 *   - `new File([body], name).lastModified` defaults to the current wall time
 *     — measured equal to `Date.now()` to the millisecond. `Blob`, the other
 *     half of that pair, genuinely has no such property and stays declined,
 *     which is exactly why "inert data type" was too coarse a category to
 *     decline a name under.
 *   - `new Event("tick").timeStamp` is a monotonic clock, inherited by
 *     `CustomEvent` and `MessageEvent` — measured 24.22 apart across a 25ms
 *     busy wait.
 *
 * So the rule for the next sweep is: a name is declined on what its instances
 * can be OBSERVED to return, not on what the constructor is called. Every
 * entry below now carries the reading that put it there.
 *
 * Deliberately NOT rostered, each re-checked against that rule:
 * `structuredClone`, `atob`/`btoa`, `TextEncoder`/`TextDecoder` (pure, total,
 * no ambient read); `URL`/`URLSearchParams` (parsers); `Request`/`Response`/
 * `Headers`/`FormData`/`Blob` and the stream constructors (no property whose
 * value depends on when or where it was constructed; they carry no capability
 * until an adapter hands them one, and the graph half is what keeps that
 * adapter out); `Proxy`/`Reflect` (metaprogramming whose only route to a
 * capability runs through a name this roster already holds). Also checked and
 * found NOT to be a hole: the builtin module names — `fs`, `child_process`,
 * `net` and the rest — are own properties of `globalThis` under `node -e` and
 * in the REPL, but `undefined` inside a loaded module, so a bare `fs.…` in a
 * source file is a ReferenceError rather than an escape.
 *
 * This file is a standalone flat config so the purity stage of
 * `.chug/tasks/check-ts.sh` can run it by itself, in milliseconds, without the
 * type information the full lint needs. `eslint.config.js` spreads the same
 * array in, so the rules have one definition and the whole-tree lint enforces
 * them too.
 *
 * WHAT IT CATCHES: any lexical reference to a rostered ambient global, any
 * `Math.random()` or `Date.now()` property access, `eval`, `new Function`, a
 * dynamic `import()`, and `import.meta` — across every file extension the
 * `DOMAIN_FILES` glob below admits.
 *
 * WHAT IT CANNOT CATCH, stated rather than hoped:
 *
 *   1. A capability that is not on the roster. See the dated sweep. The
 *      compensating control is not a promise to remember: the purity stage
 *      hands `src/domain/` files to eslint EXPLICITLY under `--max-warnings=0`,
 *      so a file this config does not match is a finding rather than a silent
 *      skip. That gap is how a `.mts` file reached `Date.now()` and the whole
 *      gate still printed clean.
 *   2. A capability reached by computed name — `globalThis["Da" + "te"]`.
 *      `globalThis`, `global`, `eval`, `new Function` and `WebAssembly` are all
 *      rostered, which closes the readable spellings; obfuscation gets through.
 *   3. A capability handed in as an argument by an impure caller. Not a hole
 *      but the design: a decider is pure with respect to what it is given, and
 *      the model's own `Core` is exactly that argument. What forbids a *port*
 *      from reaching the domain is the module-graph half, not this one.
 */

import tseslint from "typescript-eslint";

/**
 * The files this config governs. Every TypeScript extension rather than `.ts`
 * alone: `.mts` and `.cts` are TypeScript that `tsc` compiles and that a
 * `*.ts` glob silently declines to lint. `.d.ts` matches too, and costs
 * nothing.
 *
 * Plain JavaScript is absent on purpose rather than by oversight. It is not
 * permitted under `src/` at all — `.chug/tasks/check-ts.sh` fails its types
 * stage on any file there that is not one of these three — because a `.js`
 * file sits outside the typechecker's program, so "TypeScript strict" would
 * quietly not apply to it. Rostering it here would have bought lint coverage
 * for a file that is still type-invisible, which is the worse of the two
 * answers.
 */
export const DOMAIN_FILES = ["src/domain/**/*.{ts,mts,cts}"];

const why = (capability, reason) => ({
  name: capability,
  message: `src/domain/ may not reach \`${capability}\`: ${reason}`,
});

const NONDETERMINISM = "a replayed decision must produce the same record twice";
const AMBIENT_IO = "the domain decides; it never performs";
const HOST_COUPLING = "the domain runs identically wherever it is replayed";
const SHARED_STATE =
  "shared mutable state has no place below the single writer";

const restrictedGlobals = [
  why("Date", NONDETERMINISM),
  why("performance", NONDETERMINISM),
  why("Performance", NONDETERMINISM),
  why("PerformanceObserver", NONDETERMINISM),
  // `PerformanceMark` and `PerformanceMeasure` both stamp `startTime` from the
  // same monotonic clock. They are rostered rather than left to the types
  // stage, which currently rejects them only because neither `lib: es2023` nor
  // `@types/node` declares them globally — a lib list is a moving target and a
  // capability rule that depends on one is a capability rule with a schedule.
  why("PerformanceMark", NONDETERMINISM),
  why("PerformanceMeasure", NONDETERMINISM),
  why("WeakRef", NONDETERMINISM),
  why("FinalizationRegistry", NONDETERMINISM),
  why("crypto", NONDETERMINISM),
  why("Crypto", NONDETERMINISM),
  // `new File([body], name).lastModified` defaults to the current wall time,
  // with no clock named anywhere in the expression. `Blob` has no such
  // property and is declined; the pair is why this roster now turns on what a
  // constructor's instances return rather than on what it is for.
  why("File", NONDETERMINISM),
  // `Event.prototype.timeStamp` is a monotonic clock, and the two subclasses
  // inherit it.
  why("Event", NONDETERMINISM),
  why("CustomEvent", NONDETERMINISM),
  why("MessageEvent", NONDETERMINISM),
  // Formats and resolves against the host's clock, calendar and time zone.
  // `new Intl.DateTimeFormat("en-CA").format()` is a wall-clock read with no
  // import and no clock anywhere in the expression, and
  // `.resolvedOptions().timeZone` answers differently on a different machine.
  why("Intl", NONDETERMINISM),

  why("process", AMBIENT_IO),
  why("console", AMBIENT_IO),
  why("fetch", AMBIENT_IO),
  why("XMLHttpRequest", AMBIENT_IO),
  why("WebSocket", AMBIENT_IO),
  why("EventSource", AMBIENT_IO),
  why("navigator", AMBIENT_IO),
  why("Navigator", AMBIENT_IO),
  why("localStorage", AMBIENT_IO),
  why("sessionStorage", AMBIENT_IO),
  why("indexedDB", AMBIENT_IO),
  why("BroadcastChannel", AMBIENT_IO),
  why("MessageChannel", AMBIENT_IO),
  why("MessagePort", AMBIENT_IO),

  why("setTimeout", AMBIENT_IO),
  why("setInterval", AMBIENT_IO),
  why("setImmediate", AMBIENT_IO),
  why("clearTimeout", AMBIENT_IO),
  why("clearInterval", AMBIENT_IO),
  why("clearImmediate", AMBIENT_IO),
  why("queueMicrotask", AMBIENT_IO),
  // `AbortSignal.timeout()` is a timer wearing another name, and cancellation
  // is fabric vocabulary the machine deliberately does not know.
  why("AbortSignal", AMBIENT_IO),
  why("AbortController", AMBIENT_IO),

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
  // The remaining way to run code the typechecker never saw, alongside `eval`
  // and `new Function` below.
  why("WebAssembly", HOST_COUPLING),

  why("Atomics", SHARED_STATE),
  why("SharedArrayBuffer", SHARED_STATE),
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
