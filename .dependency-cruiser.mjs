/**
 * The other half of the purity rule: `src/domain/` has no transitive path out
 * of itself. The ambient-capability half is `eslint.purity.config.js`.
 *
 * THE RULE IS SPELLED AS REACHABILITY, NOT AS A LIST OF FORBIDDEN TARGETS.
 * "Nothing reachable from the domain lies outside the domain" needs no roster
 * of banned modules to keep current: a node builtin, an npm package, a sibling
 * layer and a package nobody has invented yet all fail the same predicate. A
 * roster would have to be edited every time the ecosystem grew a new way to
 * touch a disk, and the edit nobody makes is the hole.
 *
 * It is transitive by construction — `reachable` walks the graph — so the
 * three-hop path through two innocent-looking domain modules is caught exactly
 * as the direct import is.
 *
 * WHAT IT CATCHES: any import, static or type-only, from a `src/domain/`
 * module to anything not under `src/domain/`, at any depth.
 *
 * WHAT IT CANNOT CATCH: a capability reached without an import — that is the
 * lint half's job — and a capability passed in as a function argument, which
 * is not a breach but the design.
 */

/** @type {import("dependency-cruiser").IConfiguration} */
export default {
  forbidden: [
    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "src/domain/ must reach nothing outside itself: no node builtin, no package, no sibling layer, at any depth.",
      from: { path: "^src/domain/", pathNot: "[.]test[.]ts$" },
      to: { reachable: true, pathNot: "^src/domain/" },
    },
    {
      name: "domain-not-through-its-tests",
      severity: "error",
      comment:
        "Domain source may not import a domain test. This is not the purity rule wearing a second hat: `domain-is-pure` already catches an impure test file, because whatever that file reaches is reachable from the source that imported it. What this catches is the case that one cannot — a domain module depending on a fixture that exists only for the suite, and so is not part of what the domain ships.",
      from: { path: "^src/domain/", pathNot: "[.]test[.]ts$" },
      to: { reachable: true, path: "[.]test[.]ts$" },
    },
    {
      name: "effects-reach-only-domain",
      severity: "error",
      comment:
        "An effect is data describing a request to the world, so the effect vocabulary may reach the domain and nothing above it. This adds no protection to the domain, which cannot import upward anyway; it protects the meaning of the effects layer.",
      from: { path: "^src/effects/", pathNot: "[.]test[.]ts$" },
      to: { reachable: true, pathNot: "^src/(effects|domain)/" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle makes the layer a module claims to be in unfalsifiable, and makes initialization order load-bearing.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Type-only imports count. They cannot reach I/O at runtime, but the rule
    // being enforced is that the domain does not know about anything else, and
    // a type import is knowledge.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
