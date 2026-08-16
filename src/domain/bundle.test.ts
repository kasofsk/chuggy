/**
 * THE BUNDLE'S ROSTER — `allInvariants`' conjuncts as a list of named calls,
 * and the exact set of them a state turns red.
 *
 * WHY IT IS A FILE OF ITS OWN, and not part of either suite that reads it. Two
 * layers need to name a failing conjunct and neither can own the naming.
 * `invariants.test.ts` needs the exact set to state what each defect tree reds,
 * which is what makes its red-proofs evidence rather than decoration.
 * `spine/walk.test.ts` needs it so a randomized walk's finding says which
 * conjunct went red instead of "expected true". A second copy of a
 * twenty-four-entry roster is the drift this tree spends its duplication gate
 * on, and the alternative — one suite importing the other — would run that
 * suite's whole file again inside the other's process, so its tests would be
 * counted twice by a gate that reads counts.
 *
 * WHY IT IS NOT IN `invariants.ts`. The shipped bundle is a plain
 * short-circuiting conjunction and its header argues for that: a roster of
 * named verdicts evaluates every conjunct, turning a state the model reports as
 * a plain violation into whatever the conjuncts after the violation do with it.
 * This roster is the checking layer's second opinion, so it belongs to the
 * suites and carries the `.test.ts` suffix that says so.
 *
 * IT DECLARES NO TEST. `fixtures.test.ts` is the precedent, and the rule it
 * sits on is the same: the suffix is this tree's file class for "exists only
 * for the suite", and no module that ships may import one.
 */

import type { Config } from "./domain.ts";
import {
  accountsBounded,
  artifactWellFormed,
  cascadeSafety,
  completionExclusive,
  depsAcyclic,
  deskConsistent,
  idsAccounted,
  idsDense,
  leaseExclusive,
  measureDescends,
  noLeaseWithoutAKind,
  noStructuralDeadlock,
  programsWellFormed,
  projectsWellFormed,
  quietProjectLandsCleanly,
  recordMonotone,
  recordWellFormed,
  revokedNeverCompletes,
  stuckSubsetCovered,
  tasksWellFormed,
  terminalsAbsorbing,
  wrapUpIsolation,
  wrapUpWallNamed,
  wrapUpWellFormed,
  type StepHistory,
} from "./invariants.ts";
import type { Core } from "./measure.ts";

/**
 * Everything the bundle reads, so a defect tree can be stated once and asked
 * anything.
 *
 * The three fields are the bundle's whole signature: `allInvariants` takes a
 * `Config`, a `Core` and the one step of history `invariants.ts` names, so a
 * subject is a state anything below can be asked of.
 */
export type Subject = {
  readonly cfg: Config;
  readonly core: Core;
  readonly history: StepHistory;
};

/**
 * The conjuncts of `allInvariants`, in the model's order, each as the call the
 * bundle makes. It exists so a caller can name an EXACT SET of failing
 * conjuncts; the shipped bundle is a plain short-circuiting conjunction, and
 * `invariants.test.ts`'s agreement test keeps the two from drifting apart.
 */
export const bundleConjuncts: readonly (readonly [
  string,
  (s: Subject) => boolean,
])[] = [
  ["completionExclusive", (s) => completionExclusive(s.core)],
  ["revokedNeverCompletes", (s) => revokedNeverCompletes(s.core)],
  [
    "wrapUpIsolation",
    (s) => wrapUpIsolation(s.cfg, s.core, s.history.lastStep),
  ],
  [
    "quietProjectLandsCleanly",
    (s) => quietProjectLandsCleanly(s.history.lastStep),
  ],
  ["leaseExclusive", (s) => leaseExclusive(s.cfg, s.core)],
  ["noLeaseWithoutAKind", (s) => noLeaseWithoutAKind(s.core)],
  ["artifactWellFormed", (s) => artifactWellFormed(s.core)],
  ["projectsWellFormed", (s) => projectsWellFormed(s.cfg, s.core)],
  ["wrapUpWellFormed", (s) => wrapUpWellFormed(s.cfg, s.core)],
  ["terminalsAbsorbing", (s) => terminalsAbsorbing(s.history.lastStep)],
  ["deskConsistent", (s) => deskConsistent(s.core)],
  ["wrapUpWallNamed", (s) => wrapUpWallNamed(s.cfg, s.core)],
  ["accountsBounded", (s) => accountsBounded(s.cfg, s.core)],
  ["tasksWellFormed", (s) => tasksWellFormed(s.cfg, s.core)],
  ["recordWellFormed", (s) => recordWellFormed(s.core)],
  ["recordMonotone", (s) => recordMonotone(s.core, s.history.prevRecords)],
  ["idsAccounted", (s) => idsAccounted(s.core)],
  ["programsWellFormed", (s) => programsWellFormed(s.cfg, s.core)],
  ["depsAcyclic", (s) => depsAcyclic(s.core)],
  ["idsDense", (s) => idsDense(s.cfg, s.core)],
  ["stuckSubsetCovered", (s) => stuckSubsetCovered(s.core)],
  ["cascadeSafety", (s) => cascadeSafety(s.core)],
  ["noStructuralDeadlock", (s) => noStructuralDeadlock(s.core)],
  [
    "measureDescends",
    (s) =>
      measureDescends(s.cfg, s.core, s.history.lastStep, s.history.prevMeasure),
  ],
];

/** The exact set of bundle conjuncts a subject turns red. */
export function redConjuncts(s: Subject): ReadonlySet<string> {
  return new Set(
    bundleConjuncts.filter(([, holds]) => !holds(s)).map(([name]) => name),
  );
}
