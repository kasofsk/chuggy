# Review: three-deletions round 1 (Task A) — CHANGES

**CHANGES**

The machine change is right and I could not break it. I read the whole diff
`617675bb..c64bb04c`, read `model/ticket.qnt`, `model/domain.qnt`,
`model/refinement.qnt`, `model/tests/`, `src/domain/`, `src/actor/` and the
A-owned suites in full rather than as hunks, and checked the deletions against
the tree rather than against the report: `decideRevoke` transitions one ticket
with one `CancelTicketWork` and no desk task; a passing final stage always
enters Finalizing; `Stage` is its fan-out; `Reason` has no cascade wall; and no
symbol or prose in `model/`, `src/` or the A-owned suites names `Combinator`,
`AnyPass`, `UnanimousPass`, `Finalizer`, `NoFinalizer`, `ManagedFinalizer`,
`DependencyRevoked`, `cascadeSafety`, `revokeDoomed`, `noStructuralDeadlock`,
`modeledResumeExists` or `wrapup_none` — with one exception, finding 1.

I ran what I could and mutated what I could not read. All nine committed ITF
files are byte-identical to a fresh `emit-goldens.sh` run into scratch under the
pinned quint; `nofinalizer-completion` is gone from the manifest and nothing
else names it (`corpus.ts`/`coverage.test.ts` are manifest-driven, so they
needed no edit and have none). `check-model`, `check-conformance`,
`check-random`, `check-boundaries`, `check-model-api`, `check-comments`,
`check-figures` and `check-paths` are green in the worktree; `check-source` is
red exactly as described (see note 6). All eight mutations the report names go
red; two model mutations I picked myself go red, one of them through the
randomized invariant run. I verified the zod strip empirically — a pinned
pre-4 row carrying `finalizer: "NoFinalizer"` and `combinator: "AnyPass"`
parses clean with both keys gone — and I built an AnyPass-decided history by
hand and confirmed `storedJournalLegalOn` refuses it on the record, which is
the one refusal in the header that no fixture pins.

What is wrong is three things, none of them the machine: one dead key naming a
deleted concept in a fixture the change edited, one replacement comment that
does not parse, and one manifest line mangled into escape sequences for no
reason this change has.

## Findings

### 1. `test/domain/deciders.test.ts:63` — a `finalizer` key the type no longer has, silently kept

```ts
const authoring = {
  deps: depsOf(),
  program: defaultProgram(config),
  workFanout: config.nTasks,
  finalizer: "ManagedFinalizer" as const,
};
```

`freshTicket` (`src/domain/deciders.ts:58-61`) and `decideReleaseTicket`
(`:87-90`) both take `{ deps, program, workFanout }` after this change. The
key is dead. TypeScript does not catch it because excess-property checking
applies to an object literal at the argument position, not to a named `const`
passed as one — which is why the commit that dropped the argument from
`ticketOn` everywhere else in this same file left this untouched.

It matters because the report states the opposite: "No comment anywhere in
`model/` still cites `cascadeSafety`, `DependencyRevoked`, `NoFinalizer` or
`AnyPass`; the same grep is clean across `src/domain`, `src/actor`,
`src/generated` and the A-owned suites." `grep -n ManagedFinalizer
test/domain/deciders.test.ts` returns this line. A deleted vocabulary that
survives in a fixture is what the next reader copies.

Fix: drop the key.

### 2. `src/domain/config.ts:51` — the replacement comment does not parse

```ts
/** The default program: one stage at full fan-out, which every evaluator sharing stage 0 behaves as. */
```

"which every evaluator sharing stage 0 behaves as" has no readable
antecedent — an evaluator does not behave *as* a program. The four-line comment
it replaced said something true, and the model still says it correctly at
`model/domain.qnt:107-109`: "Every evaluator defaults to stage 0, so a ticket
whose evaluators all share one stage behaves exactly like a single fan-out."
A comment is a doc and held to the doc bar (CLAUDE.md, "Conventions that bite
if you miss them"); this one cannot be checked because it cannot be read.

Fix: mirror the model's sentence, or drop the second clause — `defaultProgram`
does not need it.

### 3. `test/golden/manifest.json:18` — the `walk` row's purpose mangled into escapes

```json
"purpose": "The unaimed walk. It is where the ordinary labels come from — released, ... — without any of them being asked for."
```

The two em-dashes became `—` escapes. It is the only row in the file so
rewritten — every other `purpose`, including the one this change rewrote for
`finalization-succeeded`, still carries the characters — and nothing in the
change needs it: `emit-goldens.sh` does not write the manifest, and prettier
leaves the escapes alone, so it is committed as-is and stays. The field exists
for a human reading the corpus.

Fix: restore the characters.

## Notes

**The deadlock claim, which the brief asked about.** Nothing now states that a
Pending ticket behind a Revoked dependency is a state the machine accepts, and
nothing falsifies it either — it is simply outside both walks. I built the
chain (1 Revoked, 2 Pending behind 1, 3 Pending behind 2) and evaluated the
bundle on it: all thirteen members hold, `stuckSet` and `coveredSet` are both
empty, so `stuckSubsetCovered` is vacuously true. `stuckSet`'s base case is
`Escalated` and a Revoked ticket is never one, so its inductive arm never
admits the dependent. That is exactly what the rewritten `coveredSet` note at
`model/domain.qnt:1036-1040` and `src/domain/derived.ts:70-73` say, so the
prose and the predicate agree. With `noStructuralDeadlock` gone,
`allInvariants` holds no state theorem about a ticket having a continuation at
all, and `stuckSubsetCovered`'s own header (`model/domain.qnt:1052-1076`) still
says why it cannot supply one. That is GOAL's decision, not a finding — but it
is the thing a future reader will want stated, and it is stated honestly where
it is.

**`deskConsistent`'s new claim.** `(resumeAt != NoResume) iff (phase ==
Escalated)` is true of every `Reason` left. The three escalate sites stamp
`ResumeWorking`, `ResumeReworking` and — for the infrastructure reasons —
whichever of `ResumeWorking`/`ResumeEvaluating` the source phase names. The
`_ => NoResume` arm of `decideExecutionBlocked` (`model/domain.qnt:523-527`,
`src/domain/deciders.ts:342-347`) would produce a state this invariant now
refuses, but `taskPhaseIn` admits only Working and Evaluating, so it is
unreachable through the action roster and through `decisionEventEnabled`. That
arm was equally dead before the change (the old `modeledResumeExists` returned
true for those reasons too), so this is not a regression — but it is now the
only way to build a parked ticket the bundle rejects, and house rule 10 would
have it assert rather than return.

**`revokedDependencies` is well covered.** Direct edges only, id order (from
`visEdges`'s sort), empty when there are none — all three pinned at
`test/domain/derived.test.ts:147-166`, and reversing the sort in `visEdges`
goes red. A Revoked dependency of a *Done* ticket cannot happen: dispatch
needs every dep Done, Done is absorbing, and `revocableIn` refuses a terminal,
so a Done ticket's deps are all Done. The transitive question the brief raises
is answered correctly for the console: a stranded Pending's own parent is the
ticket whose author holds the decision, and the console's one exit (Revoke) is
offered on the ticket it is shown against. I would not change it.

**The refusal has no message.** `storedJournalLegalOn`
(`src/actor/journal.ts:90-114`) returns a bare boolean; there is no refusal
message naming the row, for the two new shapes or for the removed walls that
preceded them. That is the pre-existing shape of the function, not something
this change chose, so I am not raising it — but the brief asked, and the answer
is that nothing names the row.

**The AnyPass claim is true and unpinned.** The header's last paragraph says an
AnyPass stage that passed on a mixed set "carries a label this machine's
`combine` does not produce, and `storedJournalLegalOn` compares records." I
built that history (2-wide stage, one Pass one Fail, stored record
`eval-passed` into Finalizing, semantics 3) and `storedJournalLegalOn` returns
false; the labels are disjoint in both directions, so record equality catches
every divergence the dropped `combinator` could cause. Unlike the two new
refusals it has no fixture. Worth one if a later round wants it; not worth a
round of its own.

**One mutation the report does not name.** Dropping `reason: "NoReason"` from
`decideRevoke` (`src/domain/deciders.ts:129`) survives every unit suite:
nothing in `test/domain/` or `test/actor/` revokes an *Escalated* ticket any
more, because the only fixture that ever did was the cascade chain this change
deleted. It is not a hole — `check-random` and `check-conformance` both go red
on it through `deskConsistent`, and the model's `revokeFromEachPhaseTest`
covers it directly — but the unit tier no longer expresses it, and the report's
table does not say so.

**The two model mutations I ran.** `combine(tasks) = tasks.exists(...)` in
`model/ticket.qnt` reds `stageVerdictIsUnanimousTest` and
`evalFailureDispositionTest`. `decideRevoke` keeping the ticket's reason
instead of clearing it reds `revokeFromEachPhaseTest` *and* the randomized
ticket-instance run on `deskConsistent`. Both restored; the worktree is clean.

**`check-source`'s account.** The typecheck and lint stages name exactly the
seventeen files the report lists and nothing else. The unit stage additionally
fails 42 suites — all under `test/adapters/`, `test/contract/`,
`test/interpreter/` and `test/ui/` — but every one of them is collateral of a
single listed file: `src/interpreter/authoring.ts:15` imports
`finalizerChoices`, which `src/domain/config.ts` no longer exports, so the
module fails to instantiate and takes every suite that transitively imports it
down with it. Nothing A owns fails. B fixes one import and the 42 go with it;
worth knowing so the number is not read as a surprise.

**Things I looked at and chose not to flag.** `src/domain/witnesses.ts:10`
still opens "THEY LIVE IN THEIR OWN FILE" two paragraphs after the header was
retitled to the singular witness — the sentence is about the type rather than
the roster, so it survives the change, and rewording it is churn.
`model/domain.qnt:752` cites `holdingTickets`/`finalizerStartable`, neither of
which exists anywhere in the tree — but it is identical at `617675bb`, so it is
a pre-existing miss from an earlier round rather than this change's. Same for
the garbled `test/domain/deciders.test.ts:58` ("which every value on it is
drawn from a universe"), which is byte-identical at the base. `retryableIn`
keeping its resume conjunct, `dependableIn` keeping its Revoked refusal, and
the `evaluateBundle` roster parameter are all argued in the report and I agree
with all three: I red-proofed the guard by rethrowing inside `evaluateBundle`'s
catch and the injected-leaf test goes red, so the control is verified rather
than assumed. The six signatures that shed the config argument are mechanical
and the typecheck is what holds them.

**Practices invoked.** `comments-describe-the-code` — no provenance or
time-capsule comment survives anywhere in the diff; findings 2 and 3 are the
repo's own "a comment is a doc" bar rather than that skill's subject, and I
cite them that way.

**What I did not check.** Anything under `src/interpreter`, `src/adapters`,
`src/contract`, `ui/` or the migrations beyond the forced parameter drops, and
the `test/postgres` suites, which need a server. The worktree is clean; I
committed nothing and reverted every scratch edit.
