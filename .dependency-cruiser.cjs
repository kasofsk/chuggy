// The graph half of house rule 2, and the layering boundary each source
// directory has as it arrives.
//
// WHY REACHABILITY AND NOT IMPORTS. A per-file import check passes on a path
// helper inside the domain that imports a filesystem module, because that
// helper is not a decider; the decider that calls it is clean by the same
// check, and the invariant is broken anyway. `reachable` rules ask whether a
// path exists through the module graph, which is the shape house rule 2 is
// actually stated in — transitively, by any path.
//
// EVERY RULE HERE JUDGES A DIRECTORY THAT EXISTS, and that is a rule about
// this file rather than an accident of what has been built. A forbidden rule
// naming a directory the tree has not got is inert — it can never fire, so it
// has never been shown to fire — and it also makes this file claim a path the
// tree does not have, which `check-paths.sh` rejects and offers no way to
// suppress. So each layer's boundary lands in the commit that lands the layer,
// which is what "the graph rule lands in the same commit as the folder split"
// means read one folder at a time. Every directory the tree has now has its
// rule here, so this file is the whole boundary and there is no second place
// holding rows. A layer argued for before it exists owes its rule name to the
// design doc arguing it, and collects the rule here in the commit that builds
// the directory.
//
// Every rule below is proved to bite against a fixture tree carrying its
// violation, in `.chug/tasks/check-boundaries.test.sh`. An unverified control
// is worse than none, and a boundary rule that has never rejected anything is
// exactly that.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-is-pure",
      comment:
        "house rule 2: src/domain/ reaches no I/O and no ambient capability, " +
        'transitively, by any path in the module graph. Stated as "reaches ' +
        'nothing outside itself", which is the stronger claim and the simpler ' +
        "one: it subsumes the zero-runtime-dependency target, because a " +
        "package is a module outside src/domain/ like any other, and it needs " +
        "no list of forbidden platform modules to be kept current.",
      severity: "error",
      from: { path: "^src/domain/" },
      to: {
        reachable: true,
        path: "^(?!src/domain/)",
      },
    },
    {
      name: "contract-reaches-only-zod",
      comment:
        "src/contract/ is the one public HTTP contract, and the server and " +
        "the browser both import it: a module it reaches is a module a " +
        "bundle must carry and a browser must run. So it reaches nothing " +
        "outside itself but the parser library, transitively, by any path — " +
        "no platform module, no framework, and nothing from the layers that " +
        "own the server. NOT STATED AS REACHABILITY, and alone here in that: " +
        "this rule's `to` is the complement of its `from`, so every path out " +
        "of src/contract/ has a first edge that already violates it and a " +
        "relay is caught as the module outside the directory that it is. The " +
        "flag would be unfalsifiable rather than merely redundant — no " +
        "fixture could redden its absence — and check-boundaries.test.sh " +
        "requires a rule carrying it to have one. The rules above take it " +
        "because their `to` names a directory rather than everything else, " +
        "which is what leaves a relay belonging to neither of them invisible " +
        "to a per-import check. The direction is one-way and no rule here " +
        "says so: the layers may read the contract, and a cycle is what " +
        "would make that unanswerable, which no-circular-dependency already " +
        "forbids. The parser's exemption is not anchored at the path root " +
        "because a fixture tree reaches its node_modules through a symlink " +
        "and resolves the same package to a path outside itself.",
      severity: "error",
      from: { path: "^src/contract/" },
      to: {
        path: "^(?!src/contract/)",
        pathNot: "(^|/)node_modules/zod/",
      },
    },
    {
      name: "actor-sees-domain-only",
      comment:
        "The actor is the journaled decision layer: it reads the domain and " +
        "nothing else, transitively, by any path in the module graph. What " +
        "that buys is the crash-seam demonstration — every actor step is a " +
        "pure function of its state and picks, so crashing at every " +
        "observable seam is exhaustive. This rule is the graph half of that " +
        "and the ambient half is `eslint.config.js`, because a step that " +
        "reads a clock takes no path anywhere for a graph rule to find.",
      severity: "error",
      from: { path: "^src/actor/" },
      to: {
        reachable: true,
        path: "^(?!src/(domain|actor)/)",
      },
    },
    {
      name: "interpreter-constructs-no-adapter",
      comment:
        "The interpreter declares the ports and never picks who answers them: " +
        "an adapter reached from here is a deployment choice inside the layer " +
        "that must not have one, and it is also the edge that would let a " +
        "second fabric change the core. Stated as reachability rather than as " +
        "an import, because the shape that breaks it is a relay — a module " +
        "belonging to neither directory that one imports and the other " +
        "answers, which is what the domain and the actor are each already " +
        "forbidden to be.",
      severity: "error",
      from: { path: "^src/interpreter/" },
      to: { reachable: true, path: "^src/adapters/" },
    },
    {
      name: "no-adapter-sees-another",
      comment:
        "Two adapters that need each other are either one adapter or a " +
        "coordination belonging above both, and the second is the executor's " +
        "job. Reachability again, and for the same reason: the interesting " +
        "violation is a shared helper between two stubs rather than one stub " +
        "importing another by name. The capture group is what lets a rule " +
        "over a directory exclude the adapter it started from, and the " +
        "segment anchor is what keeps that exclusion inside it: an adapter " +
        "is a directory as readily as a file, and an unanchored name excuses " +
        "every sibling it is a prefix of.",
      severity: "error",
      from: { path: "^src/adapters/([^/]+)" },
      to: {
        reachable: true,
        path: "^src/adapters/",
        pathNot: "^src/adapters/$1(/|$)",
      },
    },
    {
      name: "nothing-imports-a-process-root",
      comment:
        "src/roots/ holds the graph's executable roots: they may import " +
        "everything and nothing may import them, because a root something depends on is a " +
        "module, and the layers below could then reach an adapter through " +
        "it. src/compose.ts is shared wiring rather than a root: separately " +
        "operated processes select from it without duplicating composition. " +
        "A plain import rule is complete here where the two above are " +
        "not — every path into a module ends at some module importing it " +
        "directly, and `from` is unrestricted.",
      severity: "error",
      from: { pathNot: "^src/roots/" },
      to: { path: "^src/roots/" },
    },
    {
      name: "no-source-reaches-a-suite",
      comment:
        "The suites mirror src/ and are downstream of every part of it. They " +
        "are not colocated, which is the more common idiom, because a " +
        "*.test.ts carve-out inside domain-is-pure's glob is the escape hatch " +
        "that makes a graph rule stop meaning anything: a suite may " +
        "legitimately read a file, and a pattern that admits one exception " +
        "admits the helper a decider imports. Refutation trigger: if " +
        "navigating between a module and its suite becomes the friction, " +
        "colocate and pay for the narrow exclusion instead.",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^test/" },
    },
    {
      name: "console-reaches-no-source",
      comment:
        "A console is served to a browser, so a module it reaches is a module " +
        "the browser must fetch, and nothing this tree holds outside ui/ is " +
        "something a browser can be served: src/ would mean shipping " +
        "TypeScript no browser parses, and test/ or model/ would mean " +
        "shipping what is not the product at all. A package is the one thing " +
        "outside ui/ this rule leaves to the console, because whether a " +
        "client dependency is available to it depends on whether it builds, " +
        "and the console that does not build answers for that below. Node's " +
        "own modules are not packages: they resolve to a bare specifier, so " +
        "this rule refuses them to every console. A package is recognised by " +
        "the node_modules directory holding it and not by where that " +
        "directory is, because the resolver reports the install it actually " +
        "found — hoisted, linked, or beside the module. Stated as " +
        "reachability and " +
        "as one rule over the whole directory, because the shape that breaks " +
        "it is a shared helper somebody adds between a console and the server " +
        "to stop writing a constant twice — which is what test/ui/ holds the " +
        "two copies equal for instead.",
      severity: "error",
      from: { path: "^ui/" },
      to: {
        reachable: true,
        path: "^(?!ui/)",
        pathNot: "node_modules/|^src/contract/",
      },
    },
    {
      name: "unbuilt-console-uses-no-package",
      comment:
        "ui/console/ is plain files a browser fetches as they stand, so a " +
        "package it reached would have to be fetched the same way — which is " +
        "the client dependency a console without a build step exists " +
        "without. This is the half of the rule above that stops being true " +
        "of a console the moment it builds, which is why it is stated over " +
        "the console it is true of rather than over ui/: a console that " +
        "builds collects the rule bounding what it may reach in the commit " +
        "that lands its directory, as every other directory here does.",
      severity: "error",
      from: { path: "^ui/console/" },
      to: { reachable: true, path: "node_modules/" },
    },
    {
      name: "console-decisions-touch-no-document",
      comment:
        "ui/console/app/ is that console's decision layer and its sibling " +
        "dom/ is what performs its effects, which is the same split the " +
        "interpreter and the adapters have and it is enforced the same way. " +
        "The split is that console's own and the rule names it: a console " +
        "layered some other way is not bound by a rule about a layering it " +
        "does not have, and states its own with the commit that lands it. " +
        "What it buys is that every arrangement the console can show " +
        "is reachable from a suite with no browser: a decision that reached " +
        "the document would need one to be tested, and this tree has no " +
        "browser harness to give it. Reachability again, because a relay " +
        "belonging to neither directory is the shape a per-import rule " +
        "misses. It is stated over EVERY dom/ under ui/ rather than the " +
        "matching one, which is wider than the split it names and is sound " +
        "only because no-console-sees-another holds below: a decision that " +
        "reached a sibling console's document layer is already a finding " +
        "there, so the two rules together admit exactly the one edge this " +
        "one is about. Writing the pair over every console with a $1 " +
        "backreference would say it exactly, and does not work — " +
        "dependency-cruiser substitutes a capture group into " +
        "`to.pathNot`, and into `to.path` on a plain dependency rule, but " +
        "not into `to.path` on a `reachable` one, where it matches nothing " +
        "and the rule passes everything. check-boundaries.test.sh carries " +
        "the case that would go quiet if someone tries it again.",
      severity: "error",
      from: { path: "^ui/console/app/" },
      to: { reachable: true, path: "^ui/[^/]+/dom/" },
    },
    {
      name: "no-console-sees-another",
      comment:
        "Each directory under ui/ is a whole console: its own document root, " +
        "its own configuration, its own image. Two that need each other are " +
        "either one console or a shared module, and a shared module under " +
        "ui/ is the client dependency console-reaches-no-source refuses on " +
        "the server side and would have no reason to permit here — what a " +
        "browser fetches for one console would be decided by the other's " +
        "needs. So a constant two consoles both need is written twice, and " +
        "test/ui/ holds the copies equal, which is the arrangement already " +
        "in force between the console and the server. Capture group and " +
        "segment anchor for the same reasons no-adapter-sees-another states " +
        "them: the interesting violation is a reachable helper rather than " +
        "one console importing another by name, and an unanchored name " +
        "excuses every sibling it is a prefix of.",
      severity: "error",
      from: { path: "^ui/([^/]+)" },
      to: {
        reachable: true,
        path: "^ui/",
        pathNot: "^ui/$1(/|$)",
      },
    },
    {
      name: "chuggy-ui-is-what-a-browser-fetches",
      comment:
        "ui/chuggy-ui/app/ is the console's whole served graph: its entry " +
        "document names one module in it, the bundler follows what that " +
        "reaches, and every file it reaches is shipped. So the directory is " +
        "the boundary, and the rule the commit landing this console owes is " +
        "this one — what the browser is handed reaches its own files, the " +
        "public contract and a package, and nothing else here. The contract " +
        "and the packages are console-reaches-no-source's exemptions and are " +
        "not restated; what this adds is the rest of the console's OWN " +
        "directory, because a build has a second kind of file in it — the " +
        "build's configuration, which imports the bundler and reads a " +
        "filesystem. Nothing stops a shared constant being lifted into one " +
        "of those and imported from a component, and the result is a bundle " +
        "carrying a build tool. Reachability, because that lift arrives as a " +
        "helper belonging to neither half.",
      severity: "error",
      from: { path: "^ui/chuggy-ui/app/" },
      to: { reachable: true, path: "^ui/chuggy-ui/(?!app/)" },
    },
    {
      name: "chuggy-ui-decisions-render-nothing",
      comment:
        "ui/chuggy-ui/app/core/ is that console's decision layer and " +
        "ui/chuggy-ui/app/browser/ is what performs its effects and draws " +
        "them, which is " +
        "the split ui/console/ has under another pair of names and is the " +
        "reason this console states its own rather than inheriting one about " +
        "a layering it does not have. The core reaches its own files, the " +
        "public contract, and the parser the contract is written in — a " +
        "closed list, so React, the router, the query cache and the " +
        "platform's own globals are all outside it. What it buys is that the " +
        "client, the parsers, the authorization flow, the stream and the " +
        "cache decisions are all reachable from a suite with no renderer: a " +
        "decision that reached a component would need one mounted to be " +
        "tested, and a suite that mounts a tree to check a bound is a suite " +
        "nobody adds a case to. Reachability, because the shape that breaks " +
        "it is a hook somebody adds between the two.",
      severity: "error",
      from: { path: "^ui/chuggy-ui/app/core/" },
      to: {
        reachable: true,
        path: "^(?!ui/chuggy-ui/app/core/)",
        pathNot: "^src/contract/|node_modules/zod/",
      },
    },
    {
      name: "chuggy-ui-primitives-reach-no-effect",
      comment:
        "ui/chuggy-ui/app/browser/ui/ draws values and performs nothing: it " +
        "reaches its own files, the decision layer, the contract and a package, " +
        "and no other module of browser/ — not the query client, the stream, the " +
        "router adapters or the ports. What it buys is that every primitive " +
        "mounts in a suite with render() and no provider, so a state a page can " +
        "draw is asserted without a scripted API. Reachability, because the " +
        "shape that breaks it is a hook a primitive grows to read a clock.",
      severity: "error",
      from: { path: "^ui/chuggy-ui/app/browser/ui/" },
      to: {
        reachable: true,
        path: "^ui/chuggy-ui/app/browser/(?!ui/)",
      },
    },
    {
      name: "no-circular-dependency",
      comment: "A cycle makes the layer a module belongs to unanswerable.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphan-module",
      comment:
        "A module nothing reaches is either dead or a boundary nobody crossed; " +
        "either way it is not what the tree claims to hold. The composition " +
        "process root needs no carve-out here and has none: an orphan is a module with " +
        "no dependents AND no dependencies, and a root that composes anything " +
        "has dependencies. A root that stopped having them would be composing " +
        "nothing, which is what this rule should say about it.",
      severity: "error",
      from: { orphan: true, pathNot: "\\.d\\.ts$" },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // A console's build output is not this tree's source: it is generated,
    // it is not in git, and a bundle is one module reaching everything by
    // construction. Every other gate is scoped by `git ls-files`; this one
    // walks directories, so the one kind of directory that is output rather
    // than input is named here.
    exclude: { path: "^ui/[^/]+/dist/" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
