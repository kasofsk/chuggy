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
// means read one folder at a time. So the rules here are the whole boundary
// the tree can currently be held to, and
// `docs/design/004-pure-core-implementation.md` under "The target tree" is the
// rest — the directories that do not exist yet, each with the rule name it
// owes this file. There is no third place, and neither holds the other's rows.
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
        "observable seam is exhaustive; a path from the actor to a platform " +
        "module or an outer layer is where that quietly stops being true.",
      severity: "error",
      from: { path: "^src/actor/" },
      to: {
        reachable: true,
        path: "^(?!src/(domain|actor)/)",
      },
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
        "either way it is not what the tree claims to hold.",
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
