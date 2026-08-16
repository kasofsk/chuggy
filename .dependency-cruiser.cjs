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
        "over a directory exclude the file it started from.",
      severity: "error",
      from: { path: "^src/adapters/([^/]+)" },
      to: {
        reachable: true,
        path: "^src/adapters/",
        pathNot: "^src/adapters/$1",
      },
    },
    {
      name: "nothing-imports-the-composition-root",
      comment:
        "src/compose.ts is the graph's root: it may import everything and " +
        "nothing may import it, because a root something depends on is a " +
        "module, and the layers below could then reach an adapter through " +
        "it. A plain import rule is complete here where the two above are " +
        "not — every path into a module ends at some module importing it " +
        "directly, and `from` is unrestricted.",
      severity: "error",
      from: { pathNot: "^src/compose[.]ts$" },
      to: { path: "^src/compose[.]ts$" },
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
        "root needs no carve-out here and has none: an orphan is a module with " +
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
