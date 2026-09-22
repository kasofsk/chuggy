# Mutation sweep — PR 4 (Finalization Unavailable escalates), whole branch

Reviewed at `d38edc9a` in `~/claude/chuggy-wt/finunavail-sweep`, detached,
scope `git diff e5f7b3d3...d38edc9a`. Fresh session, authored none of it. Every
mutation below was applied one at a time and reverted with `git checkout -- .`;
the tree is clean at `d38edc9a` and nothing was committed. Root `npm ci` only.

## APPROVE

Fifty mutations, covering every behaviour the brief names. Forty went red in a
suite that names the behaviour it lost. Ten did not, and **none of the ten is a
behaviour defect** — the branch is right everywhere I could make it wrong. They
are unpinned behaviours, listed separately at the end; under the house rule a
sweep round ships on them.

Three of the ten are the shape round 1 rejected over (a load-bearing guard
nothing can redden), and one is a test case that names the arm it cannot see
change. They are cheap and I would take them before merge, but they block
nothing: I could not construct a wrong answer out of the branch as written.

Baseline, every gate clean at this tip before mutating: doc-lint (21 files),
check-figures (102 files), check-paths (1212 claims, 1162 files), check-comments
(909 files), check-knowledge, check-duplication (1039 files), check-gates (23
gates), check-console-sheets (31 sheets), check-shell-quoting, check-boundaries
(1058 modules), check-source static + unit (208 suites), check-console (5
scripts), check-conformance (10 goldens, 226 steps), check-random (2000 runs,
80000 steps), check-postgres (76 suites), check-queries, check-keto,
check-model (113 tests), check-model-api. Full `CHUG_CI_FULL=1 ci.sh` re-run at
this tip: `ci: all gates clean`, no gate skipped.

## The table

`model/domain.qnt` — the model only; `check-conformance` and `check-random`
read the TypeScript, so a `.qnt` edit leaves both green by construction (probed
once, on Q1).

| # | mutation | went red |
|---|---|---|
| Q1 | the Unavailable arm completes the ticket | check-model: `finalizationUnavailableEscalatesTest`, `finalizationUnavailableWitness` |
| Q2 | escalate at `NoResume` | check-model: those two, `resumeReturnsToStampedPhaseTest`, and the randomized invariant run |
| Q3 | escalate at `ResumeWork` | check-model: those three |
| Q4 | the label misspelt | check-model: the unit test and the witness |

`src/domain`, `src/contract`, `src/actor`.

| # | mutation | went red |
|---|---|---|
| T1 | the Unavailable arm completes the ticket | `deciders.test.ts` ×2, check-conformance, check-random |
| T2 | escalate at `NoResume` | `deciders.test.ts`, `decisionSemantics.test.ts` |
| T3 | escalate at `ResumeWork` | the same two |
| T4 | the label misspelt | `deciders.test.ts`, check-conformance (check-random green: a label is not walked) |
| T5 | `finalizationOutcomes` missing the member | `enablement.test.ts` |
| T6 | `finalizationOutcomeEnabled` false for the new outcome | `decisionSemantics.test.ts` only — `enablement.test.ts`, conformance and random all green (see Unpinned) |
| T7 | `escalationReasons` without the member | `rosters.test.ts` |
| T8 | `decisionSemanticsVersionCurrent` 5 → 6 | `decisionSemantics.test.ts` ×4, incl. the new wall case |
| T9 | the new outcome listed as a superseded spelling | `decisionSemantics.test.ts` ×2 |
| K1 | `ticketResponseSchema` without `finalizationBlockedBy` | `responses.test.ts` |
| R1 | one kind removed from `finalizationUnavailableKinds` | `rosters.test.ts` (the complement) |
| R2 | one of the five added | `rosters.test.ts`; check-console typecheck (TS2366), lint (exhaustiveness), `codeLabels.test.ts` |
| R3 | a kind that is no hold at all | `rosters.test.ts` |

The pass (`src/interpreter/finalizerRun.ts`, `finalizer.ts`,
`finalizerSettings.ts`), against `test/interpreter/finalizerRun.test.ts` and
`finalizerSettings.test.ts`.

| # | mutation | went red |
|---|---|---|
| P1 | `recordHold` never called | 3 cases: the dwell, the clear, the two-request case |
| P2 | a hold off the roster recorded too | 2 cases: never-recorded, count-left-alone |
| P3 | `recordHold` called after a result-ending pass (`tally.conclusions === spent` dropped) | **nothing** |
| P4 | `held.passes < max` → `<= max` | the dwell case |
| P5 | the Unavailable submission names an attempt | **nothing** (see Unpinned) |
| P6 | the kind submitted differs from the one recorded | the dwell case |
| P7 | `holdPassesMax` default 10 → 9 | **nothing** (10 → 1 reddens six unrelated hold cases, which pins "not 1", not "10") |
| P8 | `CHUG_FINALIZER_HOLD_PASSES_MAX` ignored | `finalizerSettings.test.ts` |

Migration 007, against check-postgres (76 suites).

| # | mutation | went red |
|---|---|---|
| D1 | the same kind resets `held_since` | `migration.test.ts`: the counts-restarts-clears case |
| D2 | a different kind keeps the count | that case and `finalizerUnavailable.test.ts` |
| D3 | a null kind does not clear | the wholeness CHECK fires across four finalizer suites |
| D4 | the claim fence removed | `finalizerUnavailable.test.ts` (the successor case) and `migration.test.ts` |
| D5 | the epoch check removed | **nothing** |
| D6 | the state check admits `Fulfilled` | **nothing** |
| E1 | the third arm fences on nothing | 3 cases across `migration.test.ts` and `finalizerUnavailable.test.ts` |
| E2 | the third arm admits a mismatched kind | 2 cases |
| E3 | the third arm admits an attempt | `finalizerUnavailable.test.ts` |
| E4 | `ticket_projection_reason_is_known` without the new value | 2 cases |
| E5 | `native_action_reason_check` without it | 2 cases |
| E6 | `decision_event_is_valid`'s outcome list without it | the two-validators case |
| E7 | `ticket_command_is_valid`'s outcome list without it | 4 cases |
| E8 | the `chuggy_api` grant removed | 5 cases, incl. the desk read |
| E9 | the boundary owner's `UPDATE(hold_kind)` removed | 15 cases across five finalizer suites — they do run as the roles |
| E10 | `finalization_request_hold_kind_is_known` drops a kind | the roster-home case and the door case |

The read and the evidence.

| # | mutation | went red |
|---|---|---|
| N1 | the `t.reason='FinalizationUnavailableEscalated'` predicate dropped | **nothing** |
| N2 | `ORDER BY f.authorizing_seq DESC` → `ASC` | **nothing** |
| N3 | `readiness.ts` gathers attempt evidence for the new outcome | `finalizerUnavailable.test.ts` (throws "failed on no attempt") |

Console.

| # | mutation | went red |
|---|---|---|
| C1 | `resumeSentence` back to the pre-branch fallback | nothing — and correctly so: that edit is behaviour-identical, so it is not a mutation. C1b is the real one |
| C1b | the finalization wall's Resume says "rework this ticket with a fresh cycle" | **nothing** |
| C2 | `escalationDetail` ignores `finalizationBlockedBy` | check-console typecheck, lint, `codeLabels.test.ts` |
| C3 | the two walls' precedence swapped | **nothing** — unobservable, the two fields cannot co-occur (round 1 judged this and was right) |
| C4 | one of the thirteen labels missing | check-console typecheck, lint, `codeLabels.test.ts` ×2 |
| C5 | `resumePoint` gives the new reason `ResumeWork` | `resumePoint.test.ts` |
| C6 | `escalationDetailLine` gives the new reason `interruptedLabel(facts)` | **nothing** |

## Findings

### 1. `ui/chuggy-ui/test/codeLabels.test.ts:96` — the case for the new arm is vacuous

```ts
const bare = { lastSet: undefined, stageCount: 2 };
expect(escalationDetailLine("FinalizationUnavailableEscalated", bare)).toBe(
  undefined,
);
```

`interruptedLabel` (`codeLabels.ts:156-158`) returns `undefined` the moment
`facts.lastSet` is `undefined`, and `bare.lastSet` is. So the assertion holds
for every arm of that switch, not just the one it names: replace
`case "FinalizationUnavailableEscalated": return undefined;`
(`codeLabels.ts:182-183`) with `return interruptedLabel(facts)` and the case
still passes (C6). The input that would see it is a ticket parked at the
finalization wall carrying a `lastSet` from its work — the page then draws
"Work cancelled" as the second line under a wall that cancelled nothing. Fix:
assert the arm against a facts object that has a `lastSet`, as the
stage-failure case above it does.

### 2. `src/adapters/postgres/nativeReads.ts:570` — the reason predicate is load-bearing and unproved

The subquery's `AND t.reason='FinalizationUnavailableEscalated'` is what makes
`finalizationBlockedBy` the optional field the contract says it is
(`src/contract/responses.ts:232-238`, `nativeWeb.ts:280-286`: "present only on
a ticket the read reports `FinalizationUnavailableEscalated` for"). Delete that
one line and **all 76 postgres suites stay green** (N1). What it prevents: a
ticket merely *held* mid-finalization — reason `NoReason`, phase
`Finalization`, `hold_kind` already recorded before the dwell is spent — is
then reported with `finalizationBlockedBy` set, and `escalationDetail`
(`codeLabels.ts:130-133`) draws that hold's label on any park whose
`executionBlockedBy` is absent. `finalizerUnavailable.test.ts`'s desk case
reads the ticket only after the escalation, so the predicate never matters to
it. Fix: one more read in that suite, of the same ticket one pass *before* the
dwell is spent, asserting the field is absent.

### 3. `src/adapters/postgres/nativeReads.ts:571` — so is the ordering, and it is reachable

`ORDER BY f.authorizing_seq DESC` → `ASC` reddens nothing (N2), and the
scenario that refutes it is the one this PR builds: request 1 escalates at
`RepositoryUnbound` and **keeps** its hold columns (007's header says so
outright — "a fulfilled request keeps the columns as the evidence of why it
ended"); the operator resumes, which mints request 2 at a later
`authorizing_seq`; request 2 is held at `TargetUnreadable` and spends its own
dwell. The reason is now `FinalizationUnavailableEscalated` with two requests
carrying two different kinds, and `ASC` tells the desk to go fix the repository
binding it bound an hour ago. Round 1's note defends `DESC` picking the right
row; nothing defends against the other direction. Fix: extend the desk case
through one resume and a second escalation at a different kind.

## Unpinned behaviours — no defect, nothing to redden

- **P3** — that a result-ending pass records nothing
  (`finalizerRun.ts:1773`). Drop the guard and a fulfilled request's hold
  columns are wiped by a trailing `recordHold(null)`. Nothing reads those
  columns on a Succeeded or NeedsWork request today, so the loss is silent; the
  guard is right and I would leave it, noting only that it is free.
- **P5** — that the Unavailable submission names no attempt
  (`finalizerRun.ts:1750`). The door refuses one (E3 proves that arm), so the
  effect of getting it wrong is a request that submits every pass and never
  escalates — the exact failure this PR exists to end — but the refusal is
  downstream, and the pass's own suite never looks at the offer's attempt.
- **P7** — `holdPassesMax`'s default. `10` is asserted nowhere; `9` is as green
  as `10`. A default is a value, not a claim, so this is a note rather than a
  gap: what the tree needs pinned is "more than one", and six existing hold
  cases pin that by accident.
- **D5** — `record_finalization_hold`'s epoch check. Removing both epoch
  clauses leaves every suite green; the claim fence (D4, proved) is what
  actually stops a stale finalizer counting.
- **D6** — its state check. Admitting `Fulfilled` changes nothing any suite
  sees, for the same reason: a fulfilled request is not one a pass holds a
  claim on.
- **C1b** — the finalization wall's Resume sentence.
  `ui/chuggy-ui/test/ticketActions.test.ts:77-90` asserts the four reasons
  produce exactly two distinct sentences and names which two reasons get which;
  the new one is free to say either. Putting it on "rework this ticket with a
  fresh cycle" — which is wrong, the resume re-runs the finalizer — keeps the
  count at two and ships. One `expect` closes it.
- **C3** — the two walls' precedence in `escalationDetail`. Unobservable, and
  round 1 said so.
- **T6** — `finalizationOutcomeEnabled`'s new arm is pinned only through
  `decisionSemantics.test.ts`'s replay, not in `enablement.test.ts`;
  check-conformance states in its own header that it proves nothing about the
  enablement predicates, and check-random walks the outcome without ever
  drawing a disabled one. Not a gap — the replay is a real red — but the guard's
  own suite is not where it dies.

## Notes — read and not flagged

- **Docs, once.** Every comment the branch adds or touches reads true against
  the code beside it. Checked in particular: 007's header claims that the
  boundary owner "reaches this relation by grant rather than by owning it, so
  the three columns are granted to that role as `state` already is" (baseline
  `privileges.ts:597,600` — true) and that the api role "reaches no other
  column of this relation and writes none" (no prior `finalization_request`
  grant to `chuggy_api` anywhere — true); and `FinalizerConfig.holdPassesMax`'s
  "a held request is redrawn once its claim lease lapses" (the claim predicate
  at `finalizer.ts:299` is `claim_owner IS NULL OR claim_expires_at <= now()`
  and a held pass never settles — true, so the dwell is passes × lease).
- **"Conclusive" after the rename.** Three survive in the tree
  (`finalizer.ts:757`, `finalizerPermit.ts:28`,
  `test/interpreter/finalizer.test.ts:7`). All three are about
  `ContradictoryEvidence` and the ambiguous-promotion path, which stays a hold
  off the roster, so all three are still true. No line the branch touches calls
  a finalizer's report conclusive.
- **The figures.** check-figures' scope is `*.md`, `*.sh`, `*.qnt`, the hook
  and the justfile — not `*.ts`. The branch's only spelled quantities are
  "thirteen" and "the five left out" in `src/contract/rosters.ts:54-71` and
  `test/contract/rosters.test.ts:193-196`, both immediately above or beside the
  list they count, with the complement asserted. Legitimate under the header's
  "the sentence ships the procedure that reproduces it". The dwell's default of
  ten and the claim lease are in code, never in a comment: the `holdPassesMax`
  doc comment names `requestClaimLeaseSecs` rather than a number and says "a
  dwell of one pass", which is below the Q2 floor. Nothing to mark. Note that
  either roster sentence becomes a finding the moment it moves into a `.md` or
  a `.qnt` header.
- **Fabric alignment: clean.** Nothing in `.chug/configurations/*.json`,
  `images/`, `deploy/` or `~/claude/chuggy-fabric-wt/no-accounts` names the new
  outcome, the reason or a hold kind. `CHUG_FINALIZER_HOLD_PASSES_MAX` appears
  in neither tree, which is correct: it has a code default, so no fabric change
  rides with this PR. The finalizer env variables the fabric does set are the
  forge and credential ones, all unchanged.
- **The clear paths.** A pass whose decision is `Settled` or `Abort` calls
  `recordHold(null)` against a row whose claim it has just released, so the
  fence refuses and nothing is cleared. A pass that hits a ceiling holds at
  `PassCeilingReached`, which is off the roster, so a backlog cannot clear a
  count either. Both right; round 1 reached the same place.
- **Practices invoked**: `modular-and-layered-code` (findings 2 and 3 are its
  "test hardest at the boundary" — the boundary here is the tagged query) and
  `comments-describe-the-code` (for the docs pass above).
- **Unsure about**: nothing that changed the verdict. I did not mutate the
  goldens themselves — they are the model's output, and check-conformance
  refuses to regenerate by design, so a golden mutation tests the corpus rather
  than the branch.

Worktree left clean at `d38edc9a`; `git status` empty, nothing committed.
