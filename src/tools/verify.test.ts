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
 * one per `findings.push` and per `throw` site in `verify.ts`, and a producer
 * added without a heading here is a producer nothing reds.
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
 */
const rosterRenames: readonly {
  readonly what: string;
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
];

for (const rename of rosterRenames) {
  test(`staleRosters: a renamed ${rename.what} reds from both sides`, () => {
    const verification = verifying((repo) => {
      editModelText(repo, domainSource, rename.from, rename.to);
    });
    assert.deepEqual(verification.findings, [
      `model: ${rename.what} ${rename.now} — the model has it and this tree's roster does not`,
      `model: ${rename.what} ${rename.was} — this tree's roster has it and the model does not`,
    ]);
    assert.deepEqual(verification.errors, []);
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
