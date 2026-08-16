/**
 * THE CORPUS WALK'S OWN SUITE: every path in `verify.ts` that can produce a
 * finding or an error, driven against a tree carrying exactly the defect that
 * path names.
 *
 * WHY IT EXISTS, and the reason is a standing commitment rather than a
 * preference. An unverified control is worse than none, because a control that
 * reports success is believed and then never checked again — and this file's
 * subject is the control the whole conformance gate runs. Two of its
 * finding-producers were, until this suite, deletable in silence: mute
 * `pinsMissed`'s wiring and a fixture that no longer reaches what the manifest
 * says it is in the corpus for goes unreported anywhere in the tree; mute
 * `orphanFixtures` and a fixture dropped from the manifest goes unreported too.
 * `check-conformance.test.sh` appeared to cover the second and did not: its
 * case dropped a fixture whose coverage three other obligations also carried,
 * and matched a generic FINDING substring the resulting COVERAGE GAPS satisfy
 * on their own. Both are now cases here with the exact finding string, and the
 * shell case is repaired to drop a coverage-redundant fixture instead.
 *
 * EVERY CASE IS ONE MUTATION OF A CLEAN TREE. The first case establishes that
 * the committed corpus verifies clean; every case after it copies that corpus
 * and the model beside it, changes ONE thing, and asserts the findings as an
 * EXACT LIST. That is what makes a finding attributable to the mutation rather
 * than to the fixture repo: a case asserting "some finding appeared" would pass
 * for ANY producer in `verify.ts`, which is the failure mode this file was
 * written to answer and the one the shell case below it fell into.
 *
 * To re-derive which producers are covered, read the section headings: there is
 * one per `findings.push` in `verify.ts` and one per way the walk can stop, and
 * a producer added without a heading here is a producer nothing reds. The one
 * path with no case is `errorOnly`'s rethrow — the arm for an error that is
 * neither a `CorpusError` nor a `DecodeError`, which no input to this walk can
 * produce, and which exists so that a defect in the tool is not reported as a
 * finding about the corpus.
 *
 * IT CHANGES DIRECTORY, WHICH IS WORTH ONE SENTENCE. The corpus paths
 * `corpus.ts` exports are relative — the gate runs at the checkout root — so a
 * fixture tree is reached by `process.chdir` and restored in a `finally`.
 * `node --test` runs each test file in its own process, so nothing outside this
 * file can observe the change; the restore is there for the cases inside it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

import { verifyCorpus, type Verification } from "./verify.ts";
import {
  domainSource,
  manifestPath,
  mcSource,
  measureSource,
  refinementSource,
  witnessSource,
} from "./corpus.ts";

/** The checkout, captured before any case moves out of it. */
const checkout = process.cwd();

/**
 * The manifest as the fixture repo edits it — the fields a case touches, and no
 * more. It is deliberately not `Manifest`: `loadManifest` produces the parsed
 * form with `consts` already read into a `Config`, and what a case has to write
 * back is the FILE, in the model's own spelling.
 */
type RawFixture = {
  name: string;
  states: number;
  pins: string[];
};
type RawManifest = { tier1: RawFixture[]; tier2: RawFixture[] };

/**
 * Copy the committed corpus and the model into a fresh directory, apply one
 * edit, and verify from inside it.
 *
 * The MODEL is copied too, and not as a convenience: `staleConsts` reads the
 * model's own const blocks on every run, so a fixture repo without `model/` is
 * a repo where two of the producers below cannot run at all.
 */
function verifying(edit: (repo: string) => void): Verification {
  const repo = mkdtempSync(`${tmpdir()}/chuggy-verify-`);
  try {
    cpSync(`${checkout}/corpus`, `${repo}/corpus`, { recursive: true });
    cpSync(`${checkout}/model`, `${repo}/model`, { recursive: true });
    edit(repo);
    process.chdir(repo);
    return verifyCorpus();
  } finally {
    process.chdir(checkout);
    rmSync(repo, { recursive: true, force: true });
  }
}

/** Read the fixture repo's manifest, change it, and write it back. */
function editManifest(
  repo: string,
  edit: (manifest: RawManifest) => void,
): void {
  const path = `${repo}/${manifestPath}`;
  const manifest = JSON.parse(readFileSync(path, "utf8")) as RawManifest;
  edit(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Replace the first occurrence of `from` at or after `module`'s header. */
function editModule(
  repo: string,
  source: string,
  module: string,
  from: string,
  to: string,
): void {
  const path = `${repo}/${source}`;
  const text = readFileSync(path, "utf8");
  const at = text.indexOf(`module ${module} {`);
  assert.ok(at >= 0, `${source}: no module ${module} to edit`);
  const patched = text.slice(at).replace(from, to);
  assert.notEqual(patched, text.slice(at), `${module}: ${from} was not there`);
  writeFileSync(path, text.slice(0, at) + patched);
}

/**
 * A file name no manifest entry carries, so a fixture written under it is an
 * orphan. It is a binding rather than a literal at each use because
 * `.chug/tasks/check-paths.sh` reads a slashed token in a `.ts` file as a claim
 * about this tree — which is right, and this one is a claim about a throwaway
 * fixture repo instead.
 */
const stray = "stray.itf.json";

/** One fixture's committed trace, for a case that needs a valid trace's bytes. */
function fixtureText(name: string, tier: 1 | 2): string {
  return readFileSync(
    `${checkout}/corpus/tier${String(tier)}/${name}.itf.json`,
    "utf8",
  );
}

// === The baseline ==========================================================

test("verifyCorpus: the committed corpus verifies clean, which is what makes every case below attributable", () => {
  const verification = verifying(() => {
    // No edit: the tree as committed.
  });
  assert.deepEqual(verification.findings, []);
  assert.deepEqual(verification.errors, []);
  // THE ROSTER AND NOT A COUNT: what replayed is the manifest's own names, in
  // its own order, so a fixture that stopped being walked is a named failure
  // rather than a number that moved.
  const manifest = JSON.parse(
    readFileSync(`${checkout}/${manifestPath}`, "utf8"),
  ) as RawManifest;
  assert.deepEqual(verification.replayed, [
    ...manifest.tier1.map((f) => f.name),
    ...manifest.tier2.map((f) => f.name),
  ]);
});

// === orphanFixtures ========================================================

test("verifyCorpus: a committed file the manifest names no fixture for is a finding, in both tiers", () => {
  const verification = verifying((repo) => {
    writeFileSync(
      `${repo}/corpus/tier1/${stray}`,
      fixtureText("retryfree-settled", 1),
    );
    writeFileSync(
      `${repo}/corpus/tier2/${stray}`,
      fixtureText("witness-quiet-land", 2),
    );
  });
  // The strays replay perfectly well — they are copies of committed fixtures —
  // so nothing but the orphan check has anything to say about them.
  assert.deepEqual(verification.findings, [
    `corpus: corpus/tier1/${stray} is committed and the manifest names no fixture for it (tier 1)`,
    `corpus: corpus/tier2/${stray} is committed and the manifest names no fixture for it (tier 2)`,
  ]);
  assert.deepEqual(verification.errors, []);
});

test("verifyCorpus: a fixture dropped from the manifest is an ORPHAN, and the case says so by name", () => {
  // THE CASE `check-conformance.test.sh` GOT WRONG, put right here and there.
  // `budgeted-desk-only-revoke` is coverage-redundant — every roster entry it
  // reaches, another fixture reaches too — so dropping it can produce exactly
  // one finding, and only `orphanFixtures` can produce it. Dropping
  // `retryfree-settled` instead, as that suite did, also reds three coverage
  // obligations, and a case matching a generic substring then passes whether
  // or not the orphan check exists at all.
  const verification = verifying((repo) => {
    editManifest(repo, (manifest) => {
      manifest.tier1 = manifest.tier1.filter(
        (fixture) => fixture.name !== "budgeted-desk-only-revoke",
      );
    });
  });
  assert.deepEqual(verification.findings, [
    "corpus: corpus/tier1/budgeted-desk-only-revoke.itf.json is committed and the manifest names no fixture for it (tier 1)",
  ]);
});

test("verifyCorpus: a tier directory that cannot be listed is could-not-run, never a clean walk", () => {
  const verification = verifying((repo) => {
    rmSync(`${repo}/corpus/tier2`, { recursive: true, force: true });
  });
  assert.deepEqual(verification.findings, []);
  assert.equal(verification.errors.length, 1);
  assert.match(
    verification.errors[0] ?? "",
    /^corpus\/tier2 cannot be listed: /,
  );
  assert.deepEqual(verification.replayed, []);
});

// === staleConsts ===========================================================

test("verifyCorpus: a tier-1 instance whose consts moved under the corpus is a finding naming the const", () => {
  const verification = verifying((repo) => {
    editModule(
      repo,
      mcSource,
      "mc_chuggy_deadline_only",
      "GAS = 3,",
      "GAS = 4,",
    );
  });
  // Only the deadline-only fixture names that instance, so the whole corpus
  // reports exactly one — and it replays green throughout, because a replay is
  // driven at the MANIFEST's consts. That is the point of the alarm: without
  // it, a model that moved leaves every fixture passing against a machine that
  // no longer exists.
  assert.deepEqual(verification.findings, [
    "corpus: deadline-only-gate-rework (mc_chuggy_deadline_only).gas: the manifest says 3, the model says 4",
  ]);
});

test("verifyCorpus: a tier-2 witness module whose consts moved is a finding too", () => {
  const verification = verifying((repo) => {
    editModule(
      repo,
      witnessSource,
      "chuggy_witness_draft_wait_test",
      "MAX_STAGES = 1,",
      "MAX_STAGES = 2,",
    );
  });
  assert.deepEqual(verification.findings, [
    "corpus: witness-draft-wait (chuggy_witness_draft_wait_test).maxStages: the manifest says 1, the model says 2",
  ]);
});

// === replayFixture: the replay itself ======================================

test("verifyCorpus: a fixture this tree replays differently is a finding naming the fixture and the state", () => {
  const verification = verifying((repo) => {
    const path = `${repo}/corpus/tier1/budgeted-cascade-park.itf.json`;
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        '"gasLeft":{"#bigint":"3"}',
        '"gasLeft":{"#bigint":"2"}',
      ),
    );
  });
  // ONE BYTE, ONE STATE: the first arrival's remaining gas. The finding carries
  // the fixture, the trace state and the field, which is what a reader needs to
  // decide whether the corpus or the code moved.
  assert.deepEqual(verification.findings, [
    "budgeted-cascade-park: state 1: ticket-arrived: tickets.tickets[1].gasLeft: expected 2, got 3",
  ]);
});

// === replayFixture: the pins ===============================================

test("verifyCorpus: a pin the fixture does not reach is a finding, one per pin", () => {
  // THE PRODUCER THAT WAS DELETABLE IN SILENCE. A `pins` entry is the fixture's
  // own checked claim about what it is in the corpus for; muting this wiring
  // makes every claim unfalsifiable, and no other check in the tree asks it —
  // corpus-wide coverage is satisfied as long as SOME fixture reaches the
  // entry, which is exactly the claim a pin is not making.
  const verification = verifying((repo) => {
    editManifest(repo, (manifest) => {
      for (const fixture of manifest.tier2) {
        if (fixture.name === "witness-draft-wait") {
          fixture.pins = ["decideRevoke", "settled"];
        }
      }
    });
  });
  assert.deepEqual(verification.findings, [
    "witness-draft-wait: the manifest pins decideRevoke to this fixture, and it reaches no such step",
    "witness-draft-wait: the manifest pins settled to this fixture, and it reaches no such step",
  ]);
});

test("verifyCorpus: a pin IS checked against the fixture's own replay, not against the corpus's", () => {
  // The other half of the same claim, and the one that says why coverage is
  // taken per fixture before it is folded: `settled` is reached by
  // `retryfree-settled` and by nothing else, so pinning it to a second fixture
  // must red even though the corpus as a whole covers it.
  const verification = verifying((repo) => {
    editManifest(repo, (manifest) => {
      for (const fixture of manifest.tier1) {
        if (fixture.name === "budgeted-work-failed") {
          fixture.pins = [...fixture.pins, "settled"];
        }
      }
    });
  });
  assert.deepEqual(verification.findings, [
    "budgeted-work-failed: the manifest pins settled to this fixture, and it reaches no such step",
  ]);
});

// === replayFixture: the length pin =========================================

/** Drop `state` from a fixture repo's committed trace, keeping it valid JSON. */
function dropState(repo: string, name: string, tier: 1 | 2, at: number): void {
  const path = `${repo}/corpus/tier${String(tier)}/${name}.itf.json`;
  const doc = JSON.parse(readFileSync(path, "utf8")) as {
    states: unknown[];
  };
  doc.states.splice(at, 1);
  writeFileSync(path, JSON.stringify(doc));
}

test("verifyCorpus: a fixture with its LAST state removed is a finding naming the fixture and both counts", () => {
  // THE ONE CORRUPTION A TRACE CANNOT REPORT ABOUT ITSELF. Every state carries
  // its own `#meta.index` and the decoder checks it against its position, so a
  // state taken out of the middle is a decode failure — but taking the last one
  // leaves a dense, ascending, perfectly readable shorter trace, and replay has
  // nothing to say about steps that are no longer there. This fixture's `pins`
  // are all reached before its end, so before the manifest carried a length the
  // whole gate passed over it at exit 0.
  const verification = verifying((repo) => {
    dropState(repo, "witness-lease-exclusive", 2, 19);
  });
  assert.deepEqual(verification.findings, [
    "witness-lease-exclusive: the manifest says the trace holds 20 state(s) and it holds 19",
  ]);
  assert.deepEqual(verification.errors, []);
});

test("verifyCorpus: a fixture with a state removed from the MIDDLE is still a decode error, not a length finding", () => {
  // The division of labour, stated as a case: the index check is the sharper
  // instrument where it reaches, because it names the state. The length pin is
  // only for the end, and adding it did not move the boundary.
  const verification = verifying((repo) => {
    dropState(repo, "witness-lease-exclusive", 2, 5);
  });
  assert.deepEqual(verification.findings, []);
  assert.match(
    verification.errors[0] ?? "",
    /witness-lease-exclusive\.states\[5\]\.#meta\.index: state 5 is indexed 6$/,
  );
});

test("verifyCorpus: a manifest length nobody emitted is the same finding, from the other side", () => {
  // The pin is an EQUALITY, not a floor: a count edited upwards without the
  // trace to match is the same disagreement, and it reads the same way. Which
  // of the two files moved is what the diff says.
  const verification = verifying((repo) => {
    editManifest(repo, (manifest) => {
      for (const fixture of manifest.tier1) {
        if (fixture.name === "retryfree-settled") {
          fixture.states += 1;
        }
      }
    });
  });
  assert.deepEqual(verification.findings, [
    "retryfree-settled: the manifest says the trace holds 7 state(s) and it holds 6",
  ]);
});

// === coverageGaps ==========================================================

test("verifyCorpus: an obligation no remaining fixture reaches is a coverage finding", () => {
  // Dropped from the manifest AND from the disk, so the orphan check has
  // nothing to say and the coverage roster is the only producer left. The
  // free-climb witness is the fixture the model's own no-arm-without-a-witness
  // rule exists for: without it, the `RetryFree` pipeline exemption arm is
  // fired by nothing in the corpus.
  const verification = verifying((repo) => {
    editManifest(repo, (manifest) => {
      manifest.tier2 = manifest.tier2.filter(
        (fixture) => fixture.name !== "witness-free-climb",
      );
    });
    rmSync(`${repo}/corpus/tier2/witness-free-climb.itf.json`);
  });
  assert.deepEqual(verification.findings, [
    "coverage: step label rework-started eval_failure — no fixture reaches it",
    "coverage: step label ticket-escalated rework_budget_exhausted — no fixture reaches it",
    "coverage: stepDescends exemption arm operator-retry, RetryFree pipeline flavor — no fixture reaches it",
    // AND THE RESUME ARM, which is the obligation this witness was carrying
    // that no roster used to state: its retry is the only `REvaluating` one in
    // the whole corpus, and while `decideOpRetry` was the finest grain
    // available, dropping the fixture left that reported covered by the three
    // retries at other resume points.
    "coverage: decideOpRetry resume arm REvaluating — no fixture reaches it",
  ]);
});

// === The could-not-run paths ===============================================

test("verifyCorpus: no corpus at all is an ERROR with no findings, because 2 is not a pass", () => {
  const verification = verifying((repo) => {
    rmSync(`${repo}/corpus`, { recursive: true, force: true });
  });
  assert.deepEqual(verification.findings, []);
  assert.deepEqual(verification.replayed, []);
  assert.match(
    verification.errors[0] ?? "",
    /^corpus\/manifest\.json cannot be read: /,
  );
});

test("verifyCorpus: a fixture that is not JSON stops the walk and keeps what it had already found", () => {
  const verification = verifying((repo) => {
    // An orphan FIRST, so the case can show that findings accumulated before
    // the stop are carried out with the error rather than discarded.
    writeFileSync(
      `${repo}/corpus/tier1/${stray}`,
      fixtureText("retryfree-settled", 1),
    );
    writeFileSync(`${repo}/corpus/tier2/witness-quiet-land.itf.json`, "{oh no");
  });
  assert.deepEqual(verification.findings, [
    `corpus: corpus/tier1/${stray} is committed and the manifest names no fixture for it (tier 1)`,
  ]);
  assert.match(
    verification.errors[0] ?? "",
    /^corpus\/tier2\/witness-quiet-land\.itf\.json is not JSON: /,
  );
  // The walk stopped where it stopped: tier 1 replayed, tier 2 did not finish.
  assert.ok(verification.replayed.includes("retryfree-settled"));
  assert.ok(!verification.replayed.includes("witness-wrapup-none"));
});

test("verifyCorpus: a document that is JSON and is not a trace is a DECODE error, not a finding", () => {
  const verification = verifying((repo) => {
    writeFileSync(
      `${repo}/corpus/tier1/retryfree-settled.itf.json`,
      '{"states":"not an array"}',
    );
  });
  assert.deepEqual(verification.findings, []);
  assert.ok(
    (verification.errors[0] ?? "").includes("retryfree-settled"),
    `expected a decode error naming the fixture, got ${JSON.stringify(verification.errors)}`,
  );
});

test("verifyCorpus: a manifest that cannot be believed is an error before any fixture is opened", () => {
  const verification = verifying((repo) => {
    editManifest(repo, (manifest) => {
      for (const fixture of manifest.tier1) {
        fixture.pins = ["decideNothing"];
      }
    });
  });
  assert.deepEqual(verification.findings, []);
  assert.deepEqual(verification.replayed, []);
  assert.deepEqual(verification.errors, [
    "corpus/manifest.json.tier1[0].pins: decideNothing is not a decider, a step label or an exemption arm",
  ]);
});

// === staleRosters: the model's surface against the hand-typed rosters ======

/**
 * Replace every occurrence of `from` in a fixture repo's model source, and
 * refuse to pass silently if there was none.
 *
 * It is a whole-file replace rather than `editModule`'s module-scoped one
 * because a roster is a property of the file: what these cases move is a
 * declaration, and each anchor below is verified unique against the committed
 * source by the assertion that follows the replace.
 */
function editModelText(
  repo: string,
  source: string,
  from: string,
  to: string,
): void {
  const path = `${repo}/${source}`;
  const text = readFileSync(path, "utf8");
  assert.ok(text.includes(from), `${source}: ${from} is not there to rename`);
  writeFileSync(path, text.split(from).join(to));
}

/**
 * ONE RENAME PER ROSTER, WHICH REDS BOTH DIRECTIONS AT ONCE — the entry the
 * model gained and the entry this tree's roster kept. A rename is the mutation
 * a model PR actually makes, and asking both halves of one exact-set comparison
 * from one edit is what keeps these cases as short as the claim they carry.
 *
 * `source` names the model file the edit lands in, because the rosters no
 * longer come from one: the decision-event vocabulary and this layer's own
 * invariant bundles are `refinement.qnt`'s.
 */
const rosterRenames: readonly {
  readonly what: string;
  readonly source?: string;
  readonly from: string;
  readonly to: string;
  readonly was: string;
  readonly now: string;
}[] = [
  {
    what: "decider",
    from: "pure def decideOpRetry(",
    to: "pure def decideOperatorRetry(",
    was: "decideOpRetry",
    now: "decideOperatorRetry",
  },
  {
    what: "effect",
    from: '"OpenGate"',
    to: '"OpenTheGate"',
    was: "OpenGate",
    now: "OpenTheGate",
  },
  {
    what: "step label",
    from: '"wrapup-started"',
    to: '"wrapup-begun"',
    was: "wrapup-started",
    now: "wrapup-begun",
  },
  {
    // The one roster the model states in prose: its two-line entries name a
    // flavor the code has no separate name for, so the roster comment is where
    // the eight live and where a ninth would be added.
    what: "stepDescends exemption arm",
    from: "Current roster:\n  ///   init",
    to: "Current roster:\n  ///   genesis",
    was: "init",
    now: "genesis",
  },
  {
    what: "nondet binder",
    from: "nondet moved =",
    to: "nondet movedFlag =",
    was: "moved",
    now: "movedFlag",
  },
  {
    what: "model const",
    from: "const MAX_STAGES:",
    to: "const MAX_TIERS:",
    was: "MAX_STAGES",
    now: "MAX_TIERS",
  },
  {
    // The bundle, stated as a conjunction of names: the anchor is the conjunct
    // line and not the `val` it names, so the edit moves the ROSTER and leaves
    // every other reader of this file alone.
    what: "allInvariants conjunct",
    from: "\n    depsAcyclic,\n",
    to: "\n    depsAreAcyclic,\n",
    was: "depsAcyclic",
    now: "depsAreAcyclic",
  },
  {
    what: "Cmd arm",
    source: refinementSource,
    from: "| JOpRetry(int)",
    to: "| JOperatorRetry(int)",
    was: "JOpRetry",
    now: "JOperatorRetry",
  },
  {
    what: "refinementCore conjunct",
    source: refinementSource,
    from: "\n    executorSound,\n",
    to: "\n    executorBookkeepingSound,\n",
    was: "executorSound",
    now: "executorBookkeepingSound",
  },
  {
    what: "refinementInvariants conjunct",
    source: refinementSource,
    from: "\n    noDuplicateCycle\n",
    to: "\n    noDuplicateCycles\n",
    was: "noDuplicateCycle",
    now: "noDuplicateCycles",
  },
];

for (const rename of rosterRenames) {
  test(`staleRosters: a renamed ${rename.what} reds from both sides`, () => {
    const verification = verifying((repo) => {
      editModelText(
        repo,
        rename.source ?? domainSource,
        rename.from,
        rename.to,
      );
    });
    assert.deepEqual(verification.findings, [
      `model: ${rename.what} ${rename.now} — the model has it and this tree's roster does not`,
      `model: ${rename.what} ${rename.was} — this tree's roster has it and the model does not`,
    ]);
    assert.deepEqual(verification.errors, []);
  });
}

/**
 * THE THREE SURFACES A ROSTER READ OF `pure def`s AND CODE LITERALS COULD NOT
 * SEE, each mutated in one direction at a time.
 *
 * WHY THESE GET AN ADDITION AND A REMOVAL AND THE RENAMES ABOVE DO NOT. A
 * rename asks both halves of the comparison at once, which is the whole of what
 * an exact set has to answer — but each of these three surfaces reproduced the
 * failure this alarm exists for, at exit 0 across every gate, so the direction
 * that matters is asked ALONE as well: the model gains a conjunct, an arm, an
 * obligation, and nothing in this tree owes it.
 *
 * A MODEL-SIDE ADDITION AND A TREE-SIDE REMOVAL ARE THE SAME COMPARISON, and
 * so are their opposites — `rosterDisagrees` is symmetric and reads both
 * differences off the same two sets. Editing the model is what a fixture repo
 * can do; the shipped roster is compiled in. So each case below is the red
 * proof for its own direction from either side.
 */
const rosterAdditions: readonly {
  readonly what: string;
  readonly source: string;
  readonly from: string;
  readonly to: string;
  readonly gained: string;
}[] = [
  {
    what: "allInvariants conjunct",
    source: domainSource,
    from: "\n    measureDescends\n",
    to: "\n    measureDescends,\n    leasesAccounted\n",
    gained: "leasesAccounted",
  },
  {
    // THE LIVE CASE, in the packet's own words: an action with no decider of
    // its own, so the decider roster stays level and this is the only alarm
    // that can fire.
    what: "Cmd arm",
    source: refinementSource,
    from: "    | JOpRetry(int)\n",
    to: "    | JOpRetry(int)\n    | JPause(int)\n",
    gained: "JPause",
  },
  {
    what: "refinementInvariants conjunct",
    source: refinementSource,
    from: "\n    noDuplicateCycle\n",
    to: "\n    noDuplicateCycle,\n    noOrphanedLease\n",
    gained: "noOrphanedLease",
  },
];

for (const added of rosterAdditions) {
  test(`staleRosters: a ${added.what} the model gained and this tree does not owe is a finding`, () => {
    const verification = verifying((repo) => {
      editModelText(repo, added.source, added.from, added.to);
    });
    assert.deepEqual(verification.findings, [
      `model: ${added.what} ${added.gained} — the model has it and this tree's roster does not`,
    ]);
    assert.deepEqual(verification.errors, []);
  });
}

const rosterRemovals: readonly {
  readonly what: string;
  readonly source: string;
  readonly from: string;
  readonly to: string;
  readonly lost: string;
}[] = [
  {
    what: "allInvariants conjunct",
    source: domainSource,
    from: "\n    cascadeSafety,",
    to: "",
    lost: "cascadeSafety",
  },
  {
    what: "Cmd arm",
    source: refinementSource,
    from: "\n    | JRevalFail(int)",
    to: "",
    lost: "JRevalFail",
  },
  {
    what: "refinementCore conjunct",
    source: refinementSource,
    from: "\n    executorSound,",
    to: "",
    lost: "executorSound",
  },
];

for (const removed of rosterRemovals) {
  test(`staleRosters: a ${removed.what} the model dropped and this tree still holds is a finding`, () => {
    const verification = verifying((repo) => {
      editModelText(repo, removed.source, removed.from, removed.to);
    });
    assert.deepEqual(verification.findings, [
      `model: ${removed.what} ${removed.lost} — this tree's roster has it and the model does not`,
    ]);
    assert.deepEqual(verification.errors, []);
  });
}

/**
 * PARSE HONESTY, PER READER: a declaration whose shape these readers no longer
 * recognize is a could-not-run, never an empty roster and never a roster of
 * whatever the text happened to hold.
 *
 * `readModuleConsts`'s rule, and the reason it is asked of every new reader
 * one at a time: an empty answer here would red every entry of the roster at
 * once and blame the tree for a defect in this file, while a roster built out
 * of an unparsed expression would report a disagreement nobody can act on.
 *
 * ONE ARM IS NOT DRIVEN FROM HERE, and it is named rather than left to be
 * found: the bracket scan's "these do not close", shared by the const-block
 * reader and the record readers. A Quint source is never short of a closing
 * brace by the time this walk opens it — `check-model.sh` parses the same
 * files in the same `just check` — and a source with one deleted does not
 * reach that arm anyway: the scan stops at the next unmatched brace and the
 * text it hands back trips a field refusal above instead. Driving it would
 * mean building a source no reader in this tree can be given.
 */
const parseHonesty: readonly {
  readonly case: string;
  readonly source: string;
  readonly from: string;
  readonly to: string;
  readonly error: string;
}[] = [
  {
    case: "the bundle's declaration is spelled another way",
    source: domainSource,
    from: "val allInvariants: bool = and {",
    to: "val allInvariants: bool = every {",
    error:
      'model/domain.qnt: val allInvariants: no "val allInvariants: bool = and {" declaration',
  },
  {
    case: "the bundle conjoins nothing at all",
    source: domainSource,
    from: "val allInvariants: bool = and {\n    completionExclusive,",
    to: "val allInvariants: bool = and {}\n  val allSafety: bool = and {\n    completionExclusive,",
    error: "model/domain.qnt: val allInvariants: this parse matched nothing",
  },
  {
    case: "a conjunct is an expression rather than a name",
    source: domainSource,
    from: "\n    cascadeSafety,",
    to: "\n    completions >= 0,",
    error:
      'model/domain.qnt: val allInvariants: "completions >= 0" is not a conjunct name',
  },
  {
    case: "the decision event's type is renamed",
    source: refinementSource,
    from: "type Cmd =",
    to: "type Decision_ =",
    error: 'model/refinement.qnt: type Cmd: no "type Cmd =" declaration',
  },
  {
    case: "the arms move onto the declaration's own line",
    source: refinementSource,
    from: "type Cmd =\n      JArrive(",
    to: "type Cmd = JArrive(",
    error:
      "model/refinement.qnt: type Cmd: the arm list does not start on the line below the declaration",
  },
  {
    case: "an arm is spelled outside the model's constructor case",
    source: refinementSource,
    from: "| JOpRetry(int)",
    to: "| jOpRetry(int)",
    error:
      'model/refinement.qnt: type Cmd: "jOpRetry(int)" is not a constructor',
  },
  {
    // The declaration ends where Quint's layout ends it — at the first
    // non-blank line indented no deeper than the `type` — so an empty arm list
    // is one whose next declaration follows immediately. It used to be spelled
    // as a blank line under the `type`, which is now an INTERIOR blank and is
    // skipped: that spelling was the truncation this reader had to lose.
    case: "the arm list is empty",
    source: refinementSource,
    from: "type Cmd =\n      JArrive(",
    to: "type Cmd =\n  type CmdTag = int\n      JArrive(",
    error: "model/refinement.qnt: type Cmd: this parse matched nothing",
  },
  {
    case: "the record type's declaration is spelled another way",
    source: measureSource,
    from: "type StepRecord = {",
    to: "type StepRecord = (",
    error:
      'model/measure.qnt: type StepRecord: no "type StepRecord = {" declaration',
  },
  {
    case: "a record field is not a field declaration",
    source: measureSource,
    from: "type Transition = { ticket: int, from: Phase, to: Phase }",
    to: "type Transition = { ticket int, from: Phase, to: Phase }",
    error:
      'model/measure.qnt: type Transition: "ticket int" is not a field declaration',
  },
  {
    case: "a record declares no fields at all",
    source: measureSource,
    from: "type Task = { id: int, kind: TaskKind, state: TaskState }",
    to: "type Task = {  }",
    error: "model/measure.qnt: type Task: this parse matched nothing",
  },
  {
    // The one entry read from an ARM rather than from a `type` of its own: a
    // payload that stops being a record has no fields to compare, and saying
    // "no fields" would red every one of them at once.
    case: "the wrap-up attempt's payload stops being a record",
    source: measureSource,
    from: "WOAttempt({ project: int, invalidated: bool })",
    to: "WOAttempt(int)",
    error: 'model/measure.qnt: WOAttempt: no "WOAttempt({" arm',
  },
  {
    case: "the refinement bundle's declaration is spelled another way",
    source: refinementSource,
    from: "val refinementInvariants: bool = and {",
    to: "val refinementInvariants: bool = every {",
    error:
      'model/refinement.qnt: val refinementInvariants: no "val refinementInvariants: bool = and {" declaration',
  },
];

for (const honesty of parseHonesty) {
  test(`staleRosters: ${honesty.case} — could-not-run, never a roster`, () => {
    const verification = verifying((repo) => {
      editModelText(repo, honesty.source, honesty.from, honesty.to);
    });
    assert.deepEqual(verification.findings, []);
    assert.deepEqual(verification.errors, [honesty.error]);
  });
}

test("staleRosters: a renamed mc instance reds from both sides, and the const alarm then cannot run", () => {
  // THE ONE ROSTER WHOSE ENTRIES THE CONST ALARM ALSO LOOKS UP, which is why
  // the surface is compared first: a module this tree cannot find is a
  // could-not-run, and reporting it without the roster finding that explains it
  // would leave a reader with an unreadable model and no reason for it.
  const verification = verifying((repo) => {
    editModelText(
      repo,
      mcSource,
      "module mc_chuggy_retryfree {",
      "module mc_chuggy_retry_free {",
    );
  });
  assert.deepEqual(verification.findings, [
    "model: mc instance retry_free — the model has it and this tree's roster does not",
    "model: mc instance retryfree — this tree's roster has it and the model does not",
  ]);
  assert.match(verification.errors[0] ?? "", /no module mc_chuggy_retryfree$/);
});

test("staleRosters: a code literal spelled as neither an effect nor a step label is reported, never skipped", () => {
  // THE PARTITION'S THIRD BUCKET. The two spelling rules are the model's own
  // convention, and a literal obeying neither would otherwise be absent from
  // both rosters in silence — which is the failure the whole alarm is against.
  const verification = verifying((repo) => {
    editModelText(
      repo,
      domainSource,
      "  val measureDescends: bool =",
      '  val strayLiteral: str = "9lives"\n\n  val measureDescends: bool =',
    );
  });
  assert.deepEqual(verification.findings, [
    'model: string literal "9lives" — the model\'s code holds it and it is spelled as neither an effect nor a step label',
  ]);
});

// === staleRosters: the record schemas =====================================

/**
 * THE TWELFTH ROSTER, and the one every roster above it is written in. A
 * decider, a label and an effect are NAMES; a record is the VOCABULARY a golden
 * trace is expressed in, and the way one goes stale is a FIELD, which no name
 * roster can see. Both shipped copies are hand-typed — `itf.ts` decodes each
 * record against an exact field set, `entry.ts` states the journal row's schema
 * — and the only thing that ever held either against `model/` was regenerating
 * the corpus, which no gate does. A rename upstream crossed a whole release
 * that way.
 *
 * EACH CASE STATES ITS OWN FINDINGS RATHER THAN DERIVING THEM, because the
 * count is part of the claim: `StepRecord` is copied in two files and reds
 * from both on one rename, while `Ticket` is copied in one and reds once.
 * A shared expectation builder would hide exactly that.
 */
const recordSchemaCases: readonly {
  readonly case: string;
  readonly source: string;
  readonly from: string;
  readonly to: string;
  readonly findings: readonly string[];
}[] = [
  {
    // THE LIVE CASE, and the one this roster was cut for: kasofsk PR #51
    // renamed exactly this field, every gate stayed green, and the drift was
    // found by a human reading two files side by side.
    case: "the step record's attribution field is renamed",
    source: measureSource,
    from: "    attempt: WrapUpObs\n  }",
    to: "    landing: WrapUpObs\n  }",
    findings: [
      "model: StepRecord field (src/spine/itf.ts) landing — the model has it and this tree's roster does not",
      "model: StepRecord field (src/spine/itf.ts) attempt — this tree's roster has it and the model does not",
      "model: StepRecord field (src/spine/entry.ts) landing — the model has it and this tree's roster does not",
      "model: StepRecord field (src/spine/entry.ts) attempt — this tree's roster has it and the model does not",
    ],
  },
  {
    case: "the ticket record gains a field this tree does not decode",
    source: measureSource,
    from: "    completions: int\n  }",
    to: "    completions: int,\n    leaseHeld: bool\n  }",
    findings: [
      "model: Ticket field (src/spine/itf.ts) leaseHeld — the model has it and this tree's roster does not",
    ],
  },
  {
    case: "the ticket record loses a field this tree still decodes",
    source: measureSource,
    from: "\n    spawned: int,",
    to: "",
    findings: [
      "model: Ticket field (src/spine/itf.ts) spawned — this tree's roster has it and the model does not",
    ],
  },
  {
    case: "a task's identity field is renamed",
    source: measureSource,
    from: "type Task = { id: int, kind: TaskKind, state: TaskState }",
    to: "type Task = { tid: int, kind: TaskKind, state: TaskState }",
    findings: [
      "model: Task field (src/spine/itf.ts) tid — the model has it and this tree's roster does not",
      "model: Task field (src/spine/itf.ts) id — this tree's roster has it and the model does not",
    ],
  },
  {
    case: "an eval stage's fan-out is renamed",
    source: measureSource,
    from: "type Stage = { fanout: int, combinator: Combinator }",
    to: "type Stage = { width: int, combinator: Combinator }",
    findings: [
      "model: Stage field (src/spine/itf.ts) width — the model has it and this tree's roster does not",
      "model: Stage field (src/spine/itf.ts) fanout — this tree's roster has it and the model does not",
    ],
  },
  {
    case: "a transition's subject is renamed",
    source: measureSource,
    from: "type Transition = { ticket: int, from: Phase, to: Phase }",
    to: "type Transition = { subject: int, from: Phase, to: Phase }",
    findings: [
      "model: Transition field (src/spine/itf.ts) subject — the model has it and this tree's roster does not",
      "model: Transition field (src/spine/itf.ts) ticket — this tree's roster has it and the model does not",
    ],
  },
  {
    // The one read out of a sum ARM rather than a `type` of its own — the
    // wrap-up attribution the golden traces carry per project.
    case: "the wrap-up attempt's attribution is renamed",
    source: measureSource,
    from: "WOAttempt({ project: int, invalidated: bool })",
    to: "WOAttempt({ target: int, invalidated: bool })",
    findings: [
      "model: WOAttempt field (src/spine/itf.ts) target — the model has it and this tree's roster does not",
      "model: WOAttempt field (src/spine/itf.ts) project — this tree's roster has it and the model does not",
    ],
  },
  {
    // The journal row, which is `refinement.qnt`'s and which `entry.ts` states
    // schema-first: the row shape outlives the process, so a field moving under
    // it is the drift with the longest reach in this tree.
    case: "the journal row's record field is renamed",
    source: refinementSource,
    from: "type Entry = { seq: int, cmd: Cmd, rec: StepRecord }",
    to: "type Entry = { seq: int, cmd: Cmd, record: StepRecord }",
    findings: [
      "model: Entry field (src/spine/entry.ts) record — the model has it and this tree's roster does not",
      "model: Entry field (src/spine/entry.ts) rec — this tree's roster has it and the model does not",
    ],
  },
];

for (const schema of recordSchemaCases) {
  test(`staleRosters: ${schema.case} — the record schema reds, naming the field and the file`, () => {
    const verification = verifying((repo) => {
      editModelText(repo, schema.source, schema.from, schema.to);
    });
    assert.deepEqual(verification.findings, schema.findings);
    assert.deepEqual(verification.errors, []);
  });
}

// === The readers' tolerance of the model's own prose =======================

test("sumTypeArms: a comment and a blank line INSIDE the arm list hide no arm", () => {
  // THE TRUNCATION THIS READER USED TO HAVE. `withoutComments` rewrites a `//`
  // line to whitespace, and the read ended at the first empty line — so an
  // ordinary note beside a new `Cmd` arm dropped every arm below it from the
  // roster, and the exact-set comparison went on reporting agreement over a
  // vocabulary it could no longer see. Both spellings are in this one edit:
  // the comment, and the blank line under it.
  const verification = verifying((repo) => {
    editModelText(
      repo,
      refinementSource,
      "    | JGateResolve({ ticket: int, out: WrapUpOutcome })",
      "    // the gate resolution, drawn with its outcome\n\n    | JGateResolve({ ticket: int, out: WrapUpOutcome })",
    );
  });
  // Every arm below the note is still rostered, so nothing reds: with the
  // truncation, every arm from `JGateResolve` down reports as held by this
  // tree and not by the model.
  assert.deepEqual(verification.findings, []);
  assert.deepEqual(verification.errors, []);
});

test("conjunctsOf: a comment and a blank line INSIDE a bundle hide no conjunct", () => {
  // The sibling reader, audited for the same defect and found not to have it —
  // it splits the whole block on commas and drops empty pieces, so a blanked
  // comment line is nothing rather than a boundary. This is the case that keeps
  // it that way: the bundle's own roster is what `staleRosters` compares, and a
  // reader that started truncating would report agreement over half a bundle.
  const verification = verifying((repo) => {
    editModelText(
      repo,
      domainSource,
      "\n    depsAcyclic,\n",
      "\n    depsAcyclic,\n    // the dense-id pair below is the fleet's own\n\n",
    );
  });
  assert.deepEqual(verification.findings, []);
  assert.deepEqual(verification.errors, []);
});

test("recordTypeFields: the model's field-by-field prose hides no field", () => {
  // `Ticket` is the record the model documents most heavily — a comment above
  // nearly every field — so a reader bounded by blank lines or by comments
  // would see the first field and none of the rest. The committed tree already
  // exercises that;
  // this adds a blank line INSIDE the block, which is the shape the sum reader
  // above was truncating on.
  const verification = verifying((repo) => {
    editModelText(
      repo,
      measureSource,
      "    spawned: int,",
      "\n    // the ghost the accounting invariant reads\n\n    spawned: int,",
    );
  });
  assert.deepEqual(verification.findings, []);
  assert.deepEqual(verification.errors, []);
});

test("staleRosters: a roster the parse can no longer see is could-not-run, never an empty roster", () => {
  // `readModuleConsts`'s rule, applied to every roster reader: "no entries" and
  // "entries this parse cannot see" must not report the same. Reporting the
  // second as the first would red every entry of the roster at once and blame
  // the tree for a defect in the reader.
  const verification = verifying((repo) => {
    editModelText(repo, domainSource, "Current roster:", "The arms:");
  });
  assert.deepEqual(verification.findings, []);
  assert.deepEqual(verification.errors, [
    'model/domain.qnt: no "Current roster:" comment before val stepDescends',
  ]);
});
