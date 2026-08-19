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
 * IT ALSO CARRIES RULES THAT ARE NOT ABOUT PURITY AT ALL, and the misfit is
 * worth naming at the top rather than leaving to be found halfway down. THE
 * MODULE GRAPH IS COMPLETE ONLY IF NOTHING IN THIS TREE FETCHES A MODULE AT RUN
 * TIME — a claim about the tree rather than about a layer, since a graph with
 * one unresolvable edge in it cannot answer a reachability question anywhere.
 *
 * WHAT IS CLOSED, rather than how many ways there were of breaking it: the
 * dynamic-import EXPRESSION; every spelling of the builtins that hand back a
 * module (`module`, `worker_threads`, each with and without the `node:`
 * prefix); the accessor that hands one back with no import to see
 * (`getBuiltinModule`) AND its reflective spelling `Reflect.get(process,
 * "getBuiltinModule")`, whose property name is a string LITERAL and so is
 * greppable; and plain `eval`, which runs an `import()` the graph never sees.
 * Each shape was measured live from `src/adapters/` into `src/spine/actor.ts`,
 * the single writer, with depcruise, tsc and the whole lint green over it.
 *
 * WHAT IS NOT CLOSED, AND CANNOT BE, said in the same breath so the closure is
 * never read as completeness: no lint enumerates every spelling of a name. The
 * property reached by a CONCATENATED name — `Reflect.get(process, "getBuiltin"
 * + "Module")`, `process["getBuiltin" + "Module"]` — is an edge no static rule
 * sees, and this file bans the readable spellings precisely because it cannot
 * ban the obfuscated one. So the boundary claims the STATIC edges it closes and
 * names that limit, and does not assert that nothing in this tree fetches a
 * module at run time — only that no readable spelling of doing so passes.
 *
 * A COUNT WOULD BE THE WRONG SHAPE OF SENTENCE HERE, and this file keeps
 * learning it: the roster was a list of directories until a file at the `src/`
 * root walked past it, a list of loaders until a bare specifier and an accessor
 * did, and a list of import-and-accessor spellings until a reflective read and
 * a bare `eval` did — so what is written down is the closure, and a name that
 * belongs in it is an addition rather than a refutation.
 *
 * The rules live in a second block below, applied to every TypeScript file
 * under `src/` that the pure block does not already cover. The alternative was
 * a third config file, which would put the two spellings of the same claim in
 * two places.
 *
 * WHAT IT CATCHES: any lexical reference to a rostered ambient global, any
 * `Math.random()` or `Date.now()` property access, `eval`, `new Function`, a
 * dynamic `import()`, and `import.meta` — across every file extension the
 * `PURE_FILES` glob below admits; and everywhere else under `src/`, a dynamic
 * `import()`, an import of a module loader, a reach for `getBuiltinModule` by
 * member access or by `Reflect.get` with a literal name, and plain `eval`.
 * `new Function` outside the pure core is closed too, but by the whole-tree
 * lint's `@typescript-eslint/no-implied-eval` rather than by this file — which
 * is why the purity stage, running this config alone, leans on the full
 * `check-ts.sh` for that one route.
 *
 * WHAT IT CANNOT CATCH, stated rather than hoped:
 *
 *   1. A capability that is not on the roster. See the dated sweep. The
 *      compensating control is not a promise to remember: the purity stage
 *      hands every pure-core file to eslint EXPLICITLY under `--max-warnings=0`,
 *      so a file this config does not match is a finding rather than a silent
 *      skip. That gap is how a `.mts` file reached `Date.now()` and the whole
 *      gate still printed clean.
 *   2. A capability reached by computed name — `globalThis["Da" + "te"]`, or a
 *      module getter as `Reflect.get(process, "getBuiltin" + "Module")`. The
 *      readable spellings are rostered in both blocks — `globalThis`, `global`,
 *      `eval`, `new Function` and `WebAssembly` in the pure core, and the
 *      module getter, its reflective literal and `eval` outside it — which
 *      closes what a reader can grep; a name assembled at run time gets through,
 *      here and in the second block alike, and no lint changes that.
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
 * THE MODULE LOADERS THAT ARRIVE AS IMPORTS. A dynamic `import()` is not the
 * only way to fetch a module at run time, and the rest arrive as ordinary node
 * builtins in exactly the layers that are allowed node builtins.
 *
 * `createRequire(import.meta.url)("../spine/actor.ts")` executed against this
 * tree returns `commit` and every other export of the single writer;
 * `new Worker(new URL(…))` is the same class with a thread around it. Both
 * passed depcruise, tsc and the whole lint (measured), because both are a legal
 * import of a legal builtin followed by a call.
 *
 * BOTH SPELLINGS OF EVERY NAME, and the pair is why this is a list rather than
 * a prefix test: node resolves `module` and `node:module` to the same builtin,
 * and it resolves `worker_threads` the same way. A roster holding one spelling
 * of a name is a roster with a synonym for the thing it forbids.
 *
 * A LAYER HERE NEEDS A MEDIUM, NOT A MODULE LOADER, and that sentence is the
 * whole rule. `src/adapters/` is deliberately not reachability-bounded — a
 * medium is what an adapter is for — and `src/tools/` spawns quint and reads
 * the corpus; `fs`, `child_process`, `os` and `path` are all legitimate in
 * both, and `src/effects/` and `src/interp/` reach neither. What none of them
 * has any use for is a way to fetch an arbitrary module by name, which is not a
 * medium at all: it is the module graph's own job, done where the graph cannot
 * see it.
 */
const MODULE_LOADERS = [
  "node:module",
  "module",
  "node:worker_threads",
  "worker_threads",
];

/**
 * THE MODULE LOADER THAT ARRIVES AS NO IMPORT AT ALL.
 * `process.getBuiltinModule("node:module").createRequire(…)` reached the single
 * writer from `src/adapters/`, executed live, with every gate green — and
 * `no-restricted-imports` is structurally blind to it, because there is no
 * import statement anywhere in the expression.
 *
 * IT IS BANNED BY THE PROPERTY NAME AND NOT BY `process.` IN FRONT OF IT, which
 * is the difference from `Math.random` in the roster above. The pure core bans
 * the `process` global outright, so a receiver there has nowhere to hide; here
 * `process` is legitimate — `src/tools/` sets `process.exitCode`, and its suite
 * moves with `process.chdir`/`process.cwd` — so what has to be forbidden is the
 * METHOD, on any receiver it is reached through. Nothing in this tree offers a
 * member of this name for any other purpose.
 */
const BUILTIN_MODULE_GETTER = "getBuiltinModule";

/**
 * THE SAME GETTER REACHED REFLECTIVELY. `Reflect.get(process,
 * "getBuiltinModule")` executed live returned the single writer's exports from
 * an adapter, with every gate green: `no-restricted-properties` reads a member
 * expression and a destructure, and this is neither — it is a call whose
 * property name rides in as a string ARGUMENT. It is closed here rather than
 * left to the computed-name limit below because the name is a STRING LITERAL:
 * greppable, readable, a spelling a roster can hold. `Reflect.get(process,
 * "getBuiltin" + "Module")` is the computed route this cannot see and does not
 * claim to — see WHAT IT CANNOT CATCH. The selector matches the literal
 * wherever it sits in the call, which is all a `Reflect.get` needs it to.
 */
const REFLECTIVE_BUILTIN_MODULE_GETTER = `CallExpression[callee.object.name='Reflect'][callee.property.name='get'] > Literal[value='${BUILTIN_MODULE_GETTER}']`;

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
    /**
     * EVERY TypeScript FILE UNDER `src/` THAT THE PURE BLOCK DOES NOT ALREADY
     * COVER, spelled as the COMPLEMENT rather than as a list of directories.
     *
     * THE SPELLING IS THE RULE. This was a roster of the layers
     * `.dependency-cruiser.mjs` bounds by direction, and a roster of
     * directories is a roster somebody has to extend: a file at the `src/` root
     * or in a new top-level directory matched neither glob and dynamic-imported
     * with every stage of `.chug/tasks/check-ts.sh` clean (measured on two
     * probes). `src/**` minus the pure core has no such gap — a directory
     * nobody has invented yet is inside it — which is `.dependency-cruiser.mjs`'s
     * own argument for reachability over a list of forbidden targets, applied
     * to a glob.
     *
     * WHAT IT ENFORCES, EXACTLY: no file it matches may write a dynamic
     * `import()`, import a module loader, reach `getBuiltinModule` by member or
     * by `Reflect.get` with a literal name, or call `eval`. That is narrower
     * than "no module in this tree is loaded at run time", which is a property
     * of the TREE and needs every one of those bans, the pure block's own
     * copies, and the whole-tree lint's `no-implied-eval` for `new Function` —
     * `createRequire`, `Worker`, a reflective getter and an `eval("import(…)")`
     * each fetch a module without a plain `import()` anywhere. The messages say
     * what these rules stop and cite the property rather than claiming it.
     *
     * WHY BAN RATHER THAN REQUIRE A LITERAL. A literal `import("…")` is already
     * resolved and walked by the graph, so permitting it and banning the rest
     * would be a rule with an exception, and the exception is the part a reader
     * has to remember. Nothing in this tree loads a module at run time at all;
     * the day something must, that is a change here with an argument attached,
     * which is the point of having it.
     *
     * `ignores` RATHER THAN A DISJOINT GLOB, and this is a mechanical trap
     * rather than a taste. ESLint flat config resolves a rule by NAME with the
     * last match winning, so a block matching a pure-core file and setting
     * `no-restricted-syntax` would REPLACE the pure block's — silently dropping
     * the `import.meta` ban there. That hazard was real while the two globs
     * were maintained disjoint BY HAND; excluding `PURE_FILES` by name makes
     * the disjointness structural, so the trap is no longer a thing to
     * remember. The pure core keeps its own copy of this ban in its own block.
     */
    files: ["src/**/*.{ts,mts,cts}"],
    ignores: PURE_FILES,
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: `this file may not use a dynamic import: ${NO_DYNAMIC_IMPORT}`,
        },
        // AND THE SAME GETTER REACHED REFLECTIVELY. See
        // `REFLECTIVE_BUILTIN_MODULE_GETTER`: `no-restricted-properties` below
        // sees `process.getBuiltinModule` and `process["getBuiltinModule"]`,
        // but not `Reflect.get(process, "getBuiltinModule")`, whose property
        // name is a call argument. The literal is readable, so the spelling is
        // closed; the concatenated one is not, and is named as a limit rather
        // than claimed.
        {
          selector: REFLECTIVE_BUILTIN_MODULE_GETTER,
          message: `a layer here needs a medium, not a module loader: \`Reflect.get(…, "${BUILTIN_MODULE_GETTER}")\` fetches a builtin by name with no import to see, which is the module graph's job done where the graph cannot see it`,
        },
      ],
      // THE MODULE LOADERS THAT ARRIVE AS IMPORTS, closed in the same block
      // because they are the same claim: see `MODULE_LOADERS`. It is `no-
      // restricted-imports` rather than a graph rule because what is wrong is
      // HOLDING the loader, not reaching the module it would load — the graph
      // cannot see the second, and by the time it could there would be nothing
      // left to forbid.
      "no-restricted-imports": [
        "error",
        {
          paths: MODULE_LOADERS.map((name) => ({
            name,
            message: `a layer here needs a medium, not a module loader: \`${name}\` fetches a module by name, which is the module graph's job done where the graph cannot see it`,
          })),
        },
      ],
      // ...AND THE ONE THAT NEEDS NO IMPORT. See `BUILTIN_MODULE_GETTER`: an
      // import ban cannot see an expression with no import in it, and this
      // expression reached the single writer. Keyed on the property alone
      // rather than on `process.`, because `process` itself is legitimate here.
      "no-restricted-properties": [
        "error",
        {
          property: BUILTIN_MODULE_GETTER,
          message: `a layer here needs a medium, not a module loader: \`${BUILTIN_MODULE_GETTER}\` fetches a builtin by name with no import to see, which is the module graph's job done where the graph cannot see it`,
        },
      ],
      // PLAIN `eval` OUTSIDE THE PURE CORE. `eval("import('../spine/actor.ts')")`
      // reached the single writer, and the "eval is rostered" reassurance was
      // the pure core's alone — `no-eval` lived only in the block above. The
      // whole-tree lint's `@typescript-eslint/no-implied-eval` (from
      // strictTypeChecked) already closes `new Function` here, so that route
      // needs no second ban; plain `eval` was closed NOWHERE outside the core,
      // and is the one added.
      "no-eval": "error",
    },
  },
];
