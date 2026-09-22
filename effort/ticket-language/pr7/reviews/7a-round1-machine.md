# PR 7a — review round 1, machine half (tip e3b7570c)

**CHANGES** — two findings, both one line. Nothing about the shape of the
change: types, identity, mint, wire and 011's arm are all as decided, and every
gate the brief names is 0 at the tip.

## Findings

**1. `src/domain/invariants.ts:107-110` — `sameKeys` is weaker than the model's
`tasksWellFormed`, and fails open.** It holds `left.length === new Set(right).size`
and `left.every(k => named.has(k))` — cardinality plus containment, never
injectivity of `left`. Input: program `[{key: 1, evaluators: [{key: 1}, {key: 3}]}]`
and a live set of two Outstanding tasks *both* keyed 1 (two `evalOutstanding(1,1,1,1)`
objects, so a JS Set holds both). The mirror returns **true**; I ran it. The model
refuses the same state — `tasks.map(taskRetirementKey) == evaluatorKeys(program[s])`
is `{1} == {1,3}` (`model/domain.qnt:971-972`), and Quint's value-Set collapses the
duplicate so the width conjunct fails too — and so did the invariant this diff
replaced (`live.every((task, index) => taskOrdinal(...) === index + 1)`). No live
defect: `spawnEvalStage` maps a roster and `resolveTask` maps 1:1. The failure that
happens is that the guard `check-random` runs over 80 000 steps, and the actor runs
per decision, no longer refutes a state the model refutes — at exactly the seam
where reference-Set semantics diverge from value-Set. Fix:
`new Set(left).size === left.length &&` inside `sameKeys`.

**2. `model/domain.qnt:185` — a stale claim about a field that is gone.** "an empty
program, a zero/oversized fan-out, or an overlong program is REFUSED at authoring
time". There is no fan-out to be zero or oversized; the refusals are an empty
roster, a key past `N_TASKS`, a repeated key, an off-position stage key. A reader
sent here to find where a zero fan-out is refused finds nothing. The sibling
sentence in the mirror (`src/domain/config.ts:69-72`) was updated; this one was
missed, and `check-comments` cannot see it.

## What I checked and found right

**Types (1).** The two types are the package's spelling minus `task` and
`evaluatorKeys` is its definition verbatim, so 7b's copy replaces all three with no
rename. `programsWellFormed` is `planValid` minus `taskDefinitionValid` plus
`MAX_STAGES`, the `N_TASKS` key bound and `key == i + 1` (which subsumes the
package's `stageKeysUnique`). The positional rule is argued once, at
`programsWellFormed`, truthfully as chuggy's and not the contract's;
`StageDefinition`, `evalStage`, `evaluationTaskOf`, `schedulerRows.ts` and 011's
header point at it rather than restate it.

**The model on a sparse stage (2).** I drove `[{key: 1, evaluators: [{key: 1},
{key: 3}]}]` through release → dispatch → work pass → reduce (spawns `{1,3}` g1,
`spawned` 3) → both resolve → rework (record `[W1, e1, e3]`, `spawned` 4) → work
pass → reduce (cycle 2 g1, `spawned` 6) → `ExecutionBlocked` (record 6) →
`ResumeEvaluation` (g2 `{1,3}`, `spawned` 8). `allInvariants`, `idsAccounted`
included, held after every step, and a `TaskDone` at a retired identity — either
key, either generation — left phase, record, live set and `spawned` untouched. On
the brief's wording: such a completion *is* enabled, because `deliverableTasksIn`
deliberately spans the whole history and staleness is absorbed by identity
(`domain.qnt:774-782`); "no-op" is the property, not "not enabled". `retireLive`'s
order is nothing's input — the finalizer reads `retired.spawned`, which retirement
does not move, and `evaluationFailureReworksStarted` folds order-free. A roster
whose first listed key is not its lowest (`[{key: 3}, {key: 1}]`) is admitted by
`programsWellFormed` and `isValidProgram` and refused by `validPrograms`; I ran it
anyway, and both runs' identities stay distinct because `stageGeneration` counts at
the first *listed* key.

**Goldens (3).** `emit-goldens.sh` reproduces all eleven byte for byte (clean tree
after). `draws.ts` reaches sparse stages at the reference instance (`[2]` alone is
one of its three rosters). `check-conformance` 0, `check-random` 0.

**The mint (4).** Reverting `taskPositionInSet` to `taskRetirementKey` reddens
exactly i3's two new cases and nothing else, so they are informative. I added a
resume leg: the sparse history mints 1,2,3,4,5 across `W1, g1 e1, g1 e3, g2 e1,
g2 e3` — injective and monotone. `decision.ts:372` writes the identity's
`evaluator` straight into the column; `purposeBlock` carries decision 5 in one
sentence.

**The wire (5).** `programStageSchema` is strict at both depths and a request is
refused for the field a read drops, at both. `evaluatorsMax` is `config.nTasks`.
The refusal is `releasableAuthoring → isValidProgram`
(`src/actor/decisionEvent.ts:195`), not restated. `contractDocument.json` follows
at both occurrences; it carries no draft-initialization `choices`, so the
`stages`→`evaluatorsMax` swap has nothing to follow there.

**011 (6).** Guard byte-identical to 008's (compared programmatically). The arm is
`planValid` minus `taskDefinitionValid` plus the positional key, with the floors
stated in the arm because `command_integer` admits 0 and negatives. Three of S's
red-proofs re-proved, each reddening exactly its own case: `item ? 'fanout'`
deleted, the positional check deleted, uniqueness replaced by density. 001–010 are
byte-identical between `e9a6136e` and the tip and none interpolates a constant this
PR moved, so the render-diff is empty by construction.

**Gates at the tip.** `check-figures`, `check-comments`, `check-paths`,
`check-boundaries`, `check-source`, `check-model-api`, `check-conformance`,
`check-random`, `check-queries`, `check-postgres` — all 0. `check-queries` needs a
database of its own; against the shared `postgres` it exits 2 on an incompatible
ledger, the known false red.

## One correction to B's report, not a finding

B-report claims "my diff put the first keyed program through the arm; it is green
on my tip". It did not. Mutating 011's `prog` arm to refuse every stage carrying an
`evaluators` array reddens exactly one case — `migration.test.ts`'s own table —
while the other 75 suites stay green. `decision_event_is_valid` is reached only
from the `Decide` operation-command arm (`003-no-handoff.ts:232`); a release
travels as `ReleaseDraft`, whose validator never reads `prog`. So S's vacuity
stands: the arm is covered by hand-written literals alone, which is what 011's
header says it is for — a foreign writer at the mailbox. Worth recording so 012
does not assume broader coverage.
