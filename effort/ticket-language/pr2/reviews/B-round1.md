# Review: three-deletions round 1 (Task B) + A's fix — CHANGES

**CHANGES**

The machine is right and the `None` landing is the shape I would have chosen.
I read `git diff 27d510e3..b55c95a4` in full, then read `src/contract/`,
`src/interpreter/finalizer.ts`, `finalizerRun.ts`, `ticketBrief.ts`,
`authoring.ts`, `dispatchView.ts`, `nativeWeb.ts`, `wire.ts`,
`src/adapters/postgres/nativeReads.ts`, `readiness.ts`, `selector.ts`,
`ticketBrief.ts` and `005-three-deletions.ts` whole rather than as hunks, and
checked every claim in `tasks/B-report.md` against the tree rather than
against the report.

I ran rather than assumed: `check-postgres` (75 suites clean, 6 workers),
`check-queries`, `check-conformance` (9 goldens, 180 steps), `check-random`
(2000 runs), `check-boundaries` (1053 modules), `check-comments` (905 files),
`check-figures`, `check-paths` (1204 claims) — all clean; `check-source` red in
typecheck, lint and unit, every finding in `ui/` or `test/ui/` and in exactly
the six files the report lists. I drove three of the report's red-proofs myself
against a real PostgreSQL and a fourth against the pure tier, and I drove two
probes of my own against a real server to settle the questions the brief asks
about `revokedDependencies`.

Three findings. One is a contract statement that is false about the read it
describes, and Task C is being written against it right now. One is an ordering
claim stated three times and pinned nowhere — I reversed it and the suite stayed
green. One is the same dead-vocabulary miss A's review caught, in three more
fixtures.

## Findings

### 1. `src/contract/responses.ts:223-228` and `src/interpreter/nativeWeb.ts:268-275` — "empty for every ticket but a Pending one" is false, and it is false for the ticket the feature produces

```ts
  /**
   * Which of this ticket's dependencies their own authors revoked, ascending.
   * It is empty for every ticket but a Pending one waiting on such a
   * dependency: ...
   */
  revokedDependencies: page(ticketNumberSchema),
```

and, at `nativeWeb.ts:271-273`, "every other ticket lists none, because a
dependency is Done before its dependent leaves Pending and a Done ticket is not
revocable."

The argument is sound about leaving Pending *forward* and wrong about the one
exit this whole feature exists to offer. `revocableIn` admits Pending — GOAL
says so, and `decideRevoke` moves the ticket its author named — so a stranded
Pending ticket goes **Pending → Revoked with its dependencies untouched**. The
read filters on nothing but `d.phase='Revoked'` (`nativeReads.ts:408`, `:452`,
`:512`), so the dependent keeps listing it forever.

I drove it against PostgreSQL 18 on a clone of the gate's own template: two
tickets, 1 Revoked, 2 Revoked with `deps:[1]`, seeded through the real chain.
`reads.ticket(partition, id(2))` answers `phase: "Revoked", revokedDependencies:
[1]`. The report repeats the claim ("Only a Pending ticket can list any, and the
contract's doc says why").

It matters because it is the contract, not an internal note, and the console
task is reading it now. A client that does what the contract permits — key the
"Blocked by revoked dependency N" banner and its Revoke offer off a non-empty
`revokedDependencies` — puts a blocked banner and a Revoke button on a settled
ticket, and the contract told it that could not happen.

Fix: decide which one is true and make both say it. Either the read narrows to
`t.phase='Pending'` in all three queries and the comments stand, or the
comments (and the report) say what the read does — that a ticket lists the
dependencies of its own that are Revoked, which after the exit includes its own.
I would narrow the read: the field's whole meaning is "this ticket is waiting on
something that will never arrive", and a Revoked ticket is waiting for nothing.

### 2. `src/adapters/postgres/nativeReads.ts:408`, `:452`, `:512` — "ascending" is stated three times and refuted by nothing

```sql
(SELECT array_agg(d.ticket::text ORDER BY d.ticket)
   FROM ticket_projection d
  WHERE ... AND d.phase='Revoked' AND coalesce(r.deps,'[]'::jsonb) @> to_jsonb(d.ticket))
```

The order is claimed at `nativeReads.ts:75`, at `nativeWeb.ts:269` and on the
wire at `responses.ts:224`. I replaced `ORDER BY d.ticket` with `ORDER BY
d.ticket DESC` in all three queries and ran
`test/postgres/nativeReads.test.ts` against a fresh clone: 16 cases, all green.
The fixture at `test/postgres/nativeReads.test.ts:678-700` seeds exactly one
Revoked dependency anywhere in the tree, so no case can tell the two orders
apart. House rule 13 — new behaviour lands with a test at the lowest tier that
can express it; this tier can express it and does not.

The irony sharpens it: `test/domain/derived.test.ts:154` *does* pin the order,
for `src/domain/revokedDependencies`, which nothing in `src/` calls (see note
below). The derivation that ships is the unpinned one.

Fix: give ticket 2 in that fixture a second Revoked dependency and assert the
pair. I confirmed the behaviour is correct before asking for the test — a probe
with deps `[3,2,1]` where 1 and 2 are Revoked and 3 is Working answers `[1,2]`
from the detail read, the identity page and the recent-activity page alike, so
all three copies of the query agree and the Working dependency is excluded.

### 3. `test/interpreter/leadPolicyHost.test.ts:67-68`, `test/interpreter/selector.test.ts:461-462`, `test/interpreter/selector.test.ts:2527-2528` — three candidate fixtures still carry the deleted keys

```ts
const candidate = {
  ...
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
  finalizer: "NoFinalizer",
  ...
} as const;
```

`DispatchCandidate` (`src/interpreter/dispatchView.ts:25-35`) has neither field
after this change. The diff fixed the two fixtures that were *annotated*
`: DispatchCandidate` — `leadTurn.test.ts:47` and `selector.test.ts:524` — and
left every `as const` one, because excess-property checking applies to a literal
at the argument position and not to a named const. That is the exact blind spot
A's round-1 finding 1 named at `test/domain/deciders.test.ts:63`, in a review
`tasks/B.md` points the author at.

It is not only dead vocabulary. `boundedCandidatePage`
(`src/interpreter/selector.ts:1824-1826`) sizes a page with
`JSON.stringify(page.candidates)` over the whole object, so
`selector.test.ts:454`, "an oversized final candidate advances the scan to
Exhausted", measures a candidate this tree can no longer produce. The verdict
does not flip — that case passes `100` as the bound against a 1000-character
`configurationCanonical` — so this is a correctness-of-the-fixture finding, not
a live bug. Fix: drop both keys from all three.

## Notes

**`None` lands nothing, and I could not make it land anything.** The mode is
read at `finalizerRun.ts:549` — `service.ticketBriefs.brief(...)` — before
`durable.repository === undefined` is consulted, so an unbound repository still
concludes; `finalizationNext` (`finalizer.ts:834`) answers `Conclude
FinalizationSucceeded` after the settled-claim arm and before everything else.
`finalizerConclude` omits `attempt` rather than nulling it
(`finalizerRun.ts:1649-1657`), `postgres/finalizer.ts:651` passes `offer.attempt
?? null`, and 005's new `submit_finalization_result` arm admits exactly
`Succeeded ∧ RunFinalizer ∧ no failure kind ∧ in_attempt IS NULL ∧ landing IS
NOT DISTINCT FROM 'None'`, with the `bound.attempt IS NULL` guard widened by the
same conjunction and nothing else. I diffed both `CREATE OR REPLACE` bodies
mechanically against the ones they replace (003's): both are additions only,
and `ticket_command_is_valid`'s change is confined to the attempt clause. The
key-order change in `command_value` is invisible — `jsonb` normalizes, so the
digest over `command_value::text` is unchanged for the same key set. A
*present but null* `attempt` is still refused: `command->'attempt' IS NULL` is
false for jsonb `null`, and `jsonb_typeof` then fails the string test.

**A brief with mode `None` and a reference cannot reach the finalizer, by three
independent refusals.** I probed the wire: `briefFinalizationSchema.safeParse({
mode:"None", target:"main" })` fails, because `briefFinalizationShapes.None` is
a `strictObject` with only `mode`. `asBriefFinalization`
(`ticketBrief.ts:265-271`) throws on the same shape, and
`draft_brief_finalization_none_names_no_reference` refuses the row. The CHECK is
not the only line. The store path cannot carry one either: `authoring.ts:560`
and `:587` pass `briefFinalizationTarget(...)` which is `undefined` for `None`,
so `create_draft` can only receive a target alongside a non-null mode.

**The default is the repository's landing, never `None`, and I checked the
whole chain.** `briefFinalizationDefault` is `{ mode: "Push" }`;
`project_repository.landing_mode` is `NOT NULL DEFAULT 'Push'`;
`create_draft`/`revise_draft` resolve `coalesce(in_finalization_mode,
repository.landing_mode, 'Push')` and store what they resolved; 005 rewrote
every NULL to `'None'`, so `draftBriefFinalizationOf` reading NULL as "no
finalization" is total over what the column now admits. `asBriefFinalization`
throws on a mode outside the roster, which is why roster and migration must ship
together — they do.

**A consequence worth naming, which is S's rather than B's.**
`asRepositoryLanding` (`interpreter/repositoryBinding.ts:116-123`) draws from
`briefFinalizationModes`, and 005 widened
`project_repository_landing_mode_is_known` to match, so a *repository* can now
be given `None` as its per-project default and every ticket in it lands nothing
unless its brief says otherwise. The contract document carries it
(`contractDocument.json:737,748`). That follows from "None is a landing like any
other" and I would not undo it, but GOAL's scope named the draft's picker, not
the binding's default, and nobody has said out loud that a whole repository may
be set to land nothing.

**A lifecycle asymmetry I chose not to flag.** The `None` arm sits above
`finalizationNextBeforePermit`, so a `None` ticket in a **Deleting** project
concludes Succeeded where every other ticket Aborts (`finalizer.ts:788-793`). In
**Retention** the store answers `NotAdmitted` and the request is invalidated, so
only Deleting differs, and the difference is one journal entry in a project that
is being deleted. I cannot name a failure.

**`dispatchViewSchemaVersion` staying at 1 is right, and I verified the strip
empirically rather than reading it off the schema.**
`postgres/selector.ts:151-162` is `z.object(...).readonly()` and
`generated/model-api.ts:158-160`'s `stageSchema` is `z.object` too, so I parsed
a legacy stored observation carrying `finalizer: "NoFinalizer"` and `program:
[{fanout:1, combinator:"UnanimousPass"}]` through the same shape: it succeeds
with both keys gone. The version is only ever compared for equality
(`wire.ts:197`, `projectWriter.ts:295`), and the fence at
`projectWriter.ts:285-298` compares tenant, project, epoch, schema version and
ticket version — never the digest — so a token minted before the upgrade still
passes. Bumping would buy a rewrite of rows whose only sin is being readable.

**`revokedDependencies` off the projection is the right call and costs one
correlated subquery per row.** The release entry was already joined for
`releasedAt`; B widened that LATERAL to carry `deps` rather than adding a join,
which is the cheap half. The new cost is a correlated `array_agg` over
`ticket_projection` per ticket on the page, and `ticket_projection` has one
index — the `(tenant, project, ticket)` primary key — so each one is an index
scan of the project's tickets filtered by phase and containment. On a fifty-row
page in a ten-thousand-ticket project that is real work. **Simplicity over
performance** says take the simple shape until a measurement says otherwise, so
this is a note and not a finding; it is the thing to measure first if the ticket
list ever gets slow.

**A missing release entry is handled and is already exercised.** The LATERAL
selects nothing when `j.entry` is not a JSON object or names no `ReleaseTicket`,
`r.deps` is then NULL, `coalesce(r.deps,'[]')` contains nothing, `array_agg`
returns NULL and `ticketResource` reads `?? []`. Every fixture in
`nativeReads.test.ts` that seeds the default `"{}"` entry is that case, and they
all assert `revokedDependencies: []`.

**The stored-operation refusal is real and red-proofs.** I removed
`${row.input_id}` from `readiness.ts:378` and ran
`test/postgres/readiness.test.ts` against a fresh clone: red, on the regex
naming the operation. The case UPDATEs a real accepted submission's
`operation.command` to `ExecutionBlocked{DependencyRevoked}` and asserts
`discovery.next` rejects, so the decode refusal itself is what the case stands
on.

**A's fix, all four lines.** `config.ts:51` now parses and says what
`model/domain.qnt:107-109` says. `deciders.test.ts:60-63` lost the dead
`finalizer` key. `manifest.json:18`'s em-dashes are characters again — I diffed
the row and nothing else in the file moved. The new revoke-from-Escalated case
(`deciders.test.ts:254-265`) red-proofs: I changed `decideRevoke`
(`src/domain/deciders.ts:138`) to keep `ticketAt(core, id).reason` instead of
`"NoReason"` and the case fails at line 260 with `actual:
'ReworkBudgetExhausted'`. Restored.

**005's own additions check out.** I derived `sessionTurnInputCharsMax` from
`src/contract/http.ts` myself — 17,363,763 — and it is
`leadObservationTokensPerDecisionAt005`, the guard literal at 005:113, the
re-rendered `session_turn_text_is_bounded` and the `replace` target, with
17,403,663 (004's exported figure) as the source. The guard arm for
`session_turn` is present and is the same shape 004 used. `check-postgres`
covers both directions of the render — the fresh install and the migrate path —
through "the installed session constraints match the runtime", which is what
caught the author's attempt to relax `leadTokenBudget.test.ts` to `>=`.

**The contract document and the key set.** `test/contract/document.test.ts:23`
compares `JSON.stringify(nativeHttpContractDocument(), null, 2)` against the
same rendering of the committed golden, and it passes; the document is request
schemas only, so `revokedDependencies` is correctly absent from it while the
`None` variant and the `{fanout}`-only stage are both in it. The new case "a
ticket read emits exactly the keys the contract names"
(`responses.test.ts:230-249`) compares `Object.keys(body).sort()` against
`Object.keys(ticketResponseSchema.shape).sort()`, which pins both directions —
a field the interpreter adds and a field the contract names that no read
carries. A stage with an extra `combinator` is **refused**, not stripped:
`programStageSchema` is a `strictObject` and I parsed one to confirm. That is
the right way round for an inbound body, and it means a console still sending
`combinator` gets a 400 rather than silent acceptance — which is what Task C
has to fix and what `check-source` is red about.

**Nothing shows the lead a finalizer or a combinator any more.** I grepped
`leadTools.ts`, `leadTurn.ts`, `leadMailbox.ts`, `leadPolicyHost.ts`,
`taskBriefing.ts` and `selectorAdmin.ts`: no prompt or sheet names either, and
no Markdown in the tree outside the four READMEs mentions them. The candidate
reaches the lead as the JSON of the row, so dropping the columns is the whole
change.

**The line-joined grep for the twelve names.** Clean across `src/` and `test/`
except finding 3 and the places the deletion is *about*: the migrations
(baseline, 004, 005) which are history, `actor/decisionSemantics.ts:38-43` which
names the legacy spellings it drops, and the legacy row fixtures in
`test/postgres/migration.test.ts`, `test/postgres/journal.test.ts:224`,
`test/actor/decisionSemantics.test.ts:206-208` and
`test/actor/journalAtSemanticsOneWalls.json`. Every one of those is a stored
shape this image must still read.

**`src/domain/derived.ts:90` has no caller.** `revokedDependencies(core, id)` is
what GOAL routed the read model through; B chose the projection instead, for a
reason I agree with and which the report states well. What is left is a domain
export nothing in `src/` or `ui/` calls, tested at
`test/domain/derived.test.ts:147-166`, sitting beside the shipping derivation
that finding 2 says is untested. It was added in A's commit, so it is outside
this diff and I am not making it a finding — but **zero technical debt** says it
is fixed in the change that found it or filed as work, and this is the change
that found it. Deleting it and its case is a two-line commit.

**Prose I read against its code and let stand.** `finalizer.ts:16-21` (the
attempt is where the ref lives, so the repository is not in the frozen
contract); `finalizerRun.ts:43-46` — "with its mode and nothing else" is loose,
since the view is `{...durable}` and can carry an attempt or a permit, as its
own test deliberately varies, but the three clauses that elaborate it are each
true; `rosters.ts:44-49` (every surviving wall has a resume, which
`deskConsistent` now asserts); `readiness.ts:195-199` (a success is the only
submission naming no attempt, and the SQL's failure arm requires
`attempt_outcome='Failed'`, so a failure always prepared one);
`postgres/ticketBrief.ts:47-53` (total over what the column admits post-005);
`ticketCommand.ts:162-168`; `finalizer.ts:1125-1129`. `http.ts:538` still bounds
a stage at 128 characters after the stage shrank — a max that is now generous
rather than wrong, and `check-figures` is clean on it.

**One thing about `finalizerGather` I decided not to raise.** The brief is now
fetched before the `durable.repository === undefined` early return
(`finalizerRun.ts:549-556`), so an unbound ticket costs one brief read per pass
that it did not cost before. It is one indexed read on a path that already holds
a claim, and reading the mode before the binding is the whole point of the
change.

**Practices invoked.** `comments-describe-the-code` — no provenance,
time-capsule or operator-bound comment survives anywhere in the diff, and no
long justifying block papers over code I would otherwise want changed. Findings
1 and 2 are the repo's own "a comment is a doc, same bar" rule and house rule
13, and I cite them that way rather than as that skill's subject.

**What I did not check.** Anything under `ui/` and `test/ui/` beyond confirming
`check-source`'s reds are confined to the six files the report names; the
model, the goldens and `src/domain/`/`src/actor/` beyond A's fix, which
`reviews/A-round1.md` covers; and migration 005's statements 0 through 5, which
`reviews/S-round1.md` covers — I read B's appended statements and the two
function bodies he replaced, and nothing else of S's.

**The worktree.** Every mutation was applied alone, run, and reverted with `git
checkout --`; the two probe suites were written under the scratchpad and import
the tree rather than living in it; the five scratch databases and the template
were dropped. `git status --short` is empty at `b55c95a4`.
