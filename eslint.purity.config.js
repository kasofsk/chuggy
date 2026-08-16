/**
 * Half of the purity rule: THE PURE CORE reaches no ambient capability.
 *
 * THE PURE CORE IS TWO DIRECTORIES, `src/domain/` and `src/spine/`, and the
 * roster below governs both. The spine holds the decision-event vocabulary,
 * the machine's own step and the golden-trace replayer — the path standing
 * rule 4 rests on, where "the same Core and the same event produce the same
 * StepRecord on any host at any hour" is the whole conformance argument, and
 * where s5's `replayCore` folds. A clock there voids the replay exactly as
 * a clock in a decider does. `src/tools/` is deliberately NOT here: it reads
 * the filesystem and spawns quint by design, and what keeps that honest is the
 * module graph's reachability rules, which forbid anything pure from reaching
 * it.
 *
 * The other half — no transitive path out of the pure core by import — is the
 * module graph, and it lives in `.dependency-cruiser.mjs`. A module graph
 * cannot see `Date.now()`, because a global is not an import; a lint rule
 * cannot see a three-hop path into `node:fs`, because it reads one file at a
 * time. Neither half is redundant and neither alone is the rule.
 *
 * THIS HALF IS A ROSTER, AND `.dependency-cruiser.mjs` ARGUES AGAINST ROSTERS.
 * The contradiction is real and worth stating rather than leaving to be found.
 * The graph half can be spelled as a closed predicate — nothing reachable from
 * a pure directory lies outside it — because "outside the directory" is
 * decidable from a path. Ambient capability has no such predicate: the set of globals a
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
 * IT ALSO CARRIES ONE RULE THAT IS NOT ABOUT PURITY AT ALL, and the misfit is
 * worth naming at the top rather than leaving to be found halfway down. The
 * dynamic-import ban is a claim about the MODULE GRAPH being statically
 * checkable, not about ambient capability — and every layer whose rule is a
 * reachability rule needs it, not only the pure ones. So a second block below
 * applies that one rule, and nothing else, to `src/effects/`, `src/interp/`
 * and `src/adapters/`: see `REACHABILITY_FILES` for the argument. The
 * alternative was a third config file holding one selector, which would put
 * the two spellings of the same ban in two places.
 *
 * WHAT IT CATCHES: any lexical reference to a rostered ambient global, any
 * `Math.random()` or `Date.now()` property access, `eval`, `new Function`, a
 * dynamic `import()`, and `import.meta` — across every file extension the
 * `PURE_FILES` glob below admits; and a dynamic `import()` alone across
 * `REACHABILITY_FILES`.
 *
 * WHAT IT CANNOT CATCH, stated rather than hoped:
 *
 *   1. A capability that is not on the roster. See the dated sweep. The
 *      compensating control is not a promise to remember: the purity stage
 *      hands every pure-core file to eslint EXPLICITLY under `--max-warnings=0`,
 *      so a file this config does not match is a finding rather than a silent
 *      skip. That gap is how a `.mts` file reached `Date.now()` and the whole
 *      gate still printed clean.
 *   2. A capability reached by computed name — `globalThis["Da" + "te"]`.
 *      `globalThis`, `global`, `eval`, `new Function` and `WebAssembly` are all
 *      rostered, which closes the readable spellings; obfuscation gets through.
 *   3. A capability handed in as an argument by an impure caller. Not a hole
 *      but the design: a decider is pure with respect to what it is given, and
 *      the model's own `Core` is exactly that argument. What forbids a *port*
 *      from reaching the pure core is the module-graph half, not this one.
 */

import tseslint from "typescript-eslint";

/**
 * The files this config governs: every TypeScript file of the two pure
 * directories. Every TypeScript extension rather than `.ts`
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
export const PURE_FILES = [
  "src/domain/**/*.{ts,mts,cts}",
  "src/spine/**/*.{ts,mts,cts}",
];

/**
 * THE LAYERS WHOSE RULES ARE REACHABILITY RULES — everything above the pure
 * core that `.dependency-cruiser.mjs` governs by direction: `src/effects/`
 * reaches the domain and nothing above it, `src/interp/` may not reach an
 * adapter, `src/adapters/` may not reach the single writer or the event
 * vocabulary. `src/tools/` is deliberately absent, for the reason it is absent
 * from every rule in that file: it has no reachability bound to defeat.
 *
 * THEY GET ONE RULE, AND IT IS NOT A PURITY CLAIM. These layers are supposed
 * to hold capabilities — a port arrives as an argument, an adapter opens a
 * medium — so the ambient roster above would be wrong here. What they cannot
 * afford is an import the MODULE GRAPH cannot see: `const P = "../spine/
 * actor.ts"; import(P)` passes dependency-cruiser, tsc, the whole lint and
 * every gate, and it is a live edge from an adapter into the single writer.
 * Dependency-cruiser resolves a literal dynamic import and misses a computed
 * one, so the rule that closes it is the one the pure core already carries:
 * ban the expression outright, where a statically checkable graph is what the
 * layer's rule rests on.
 *
 * WHY BAN RATHER THAN REQUIRE A LITERAL. A literal `import("…")` is already
 * caught by the graph, so permitting it and banning the rest would be a rule
 * with an exception, and the exception is the part a reader has to remember.
 * Nothing in this tree loads a module at run time at all; the day something
 * must, that is a change to this list with an argument attached, which is the
 * point of having it.
 */
export const REACHABILITY_FILES = [
  "src/effects/**/*.{ts,mts,cts}",
  "src/interp/**/*.{ts,mts,cts}",
  "src/adapters/**/*.{ts,mts,cts}",
];

const NO_DYNAMIC_IMPORT =
  "the module graph must be statically checkable: a computed dynamic import is an edge `.dependency-cruiser.mjs` cannot see";

const why = (capability, reason) => ({
  name: capability,
  message: `the pure core may not reach \`${capability}\`: ${reason}`,
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
    files: PURE_FILES,
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
          message: `the pure core may not reach \`Math.random\`: ${NONDETERMINISM}`,
        },
        {
          object: "Date",
          property: "now",
          message: `the pure core may not reach \`Date.now\`: ${NONDETERMINISM}`,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: `the pure core may not use a dynamic import: ${NO_DYNAMIC_IMPORT}`,
        },
        {
          selector: "MetaProperty[meta.name='import']",
          message: `the pure core may not read \`import.meta\`: ${HOST_COUPLING}`,
        },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    // The one control the layers above the pure core share with it, and the
    // only one: see `REACHABILITY_FILES` for why it is not the ambient roster.
    files: REACHABILITY_FILES,
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: `a layer with a reachability rule may not use a dynamic import: ${NO_DYNAMIC_IMPORT}`,
        },
      ],
    },
  },
];
