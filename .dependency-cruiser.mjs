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
 * The anti-roster argument does NOT carry across to the other half, and
 * `eslint.purity.config.js` is exactly the roster this paragraph disparages.
 * Its header states the contradiction and why it is unavoidable there: "not
 * under src/domain/" is decidable from a path, while "is an ambient
 * capability" is not decidable from anything, so that half is enumerated and
 * dated and this half is not. Two halves, two shapes, one rule.
 *
 * It is transitive by construction — `reachable` walks the graph. What that
 * buys over the direct form is narrower than it looks and worth writing down,
 * because a test case once claimed the wrong credit for it: a chain of
 * ordinary domain modules ending outside the domain is caught by the direct
 * form too, since every hop's SOURCE is itself a domain file in the `from`
 * set. `reachable` earns its place on the paths the `from` set excludes —
 * through a `.test.ts` file — and on reporting the chain's origin rather than
 * only its last hop.
 *
 * WHAT IT CATCHES: any import, static or type-only, from a `src/domain/`
 * module to anything not under `src/domain/`, at any depth.
 *
 * WHAT IT CANNOT CATCH:
 *
 *   1. A capability reached without an import. That is the lint half's job,
 *      and neither half covers for the other.
 *   2. A capability passed in as a function argument — not a breach but the
 *      design.
 *   3. Anything a `.test.ts` reaches on its own account. Domain tests are
 *      excluded from every `from` set below, because a domain test must be
 *      able to import `node:test`. The exemption is compensated twice over:
 *      `domain-not-through-its-tests` stops domain source depending on a test
 *      file at all, and `eslint.purity.config.js` covers `src/domain/` tests
 *      with the full ambient roster, so the exempted files are unpoliced only
 *      with respect to imports and only while nothing ships them.
 */

/** @type {import("dependency-cruiser").IConfiguration} */
export default {
  forbidden: [
    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "src/domain/ must reach nothing outside itself: no node builtin, no package, no sibling layer, at any depth.",
      from: { path: "^src/domain/", pathNot: "[.]test[.](ts|mts|cts)$" },
      to: { reachable: true, pathNot: "^src/domain/" },
    },
    {
      name: "domain-not-through-its-tests",
      severity: "error",
      comment:
        "Domain source may not import a domain test. This is not the purity rule wearing a second hat: `domain-is-pure` already catches an impure test file, because whatever that file reaches is reachable from the source that imported it. What this catches is the case that one cannot — a domain module depending on a fixture that exists only for the suite, and so is not part of what the domain ships.",
      from: { path: "^src/domain/", pathNot: "[.]test[.](ts|mts|cts)$" },
      to: { reachable: true, path: "[.]test[.](ts|mts|cts)$" },
    },
    {
      name: "effects-reach-only-domain",
      severity: "error",
      comment:
        "An effect is data describing a request to the world, so the effect vocabulary may reach the domain and nothing above it. This adds no protection to the domain, which cannot import upward anyway; it protects the meaning of the effects layer.",
      from: { path: "^src/effects/", pathNot: "[.]test[.](ts|mts|cts)$" },
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
