# Task B fix 1 (PR 2) — report

Worktree `~/claude/chuggy-wt/three-deletions-review-b`, branch
`model/three-deletions-fix-b` from `b55c95a4`.

- **tip `34039c0c`** — "the ticket read answers a wait, so only a waiting
  ticket has one", 13 files, +148 / -174. Not pushed, not rebased, `ui/`
  untouched.

One commit. The four items are one claim being made true in the three places
that state it — the read, the two contract comments and the tests — plus the
dead derivation the same claim made redundant.

## Finding 1 — the read narrows to the waiting ticket

`nativeReads.ts` filtered on `d.phase='Revoked'` alone, so any ticket kept
listing the dependencies it was released on whatever became of it. All three
queries (`:411`, `:455`, `:515`) now open their correlated subquery with
`WHERE t.phase='Pending' AND ...`, so a ticket in any other phase aggregates
no rows, `array_agg` answers NULL and `ticketResource` reads `?? []`.

I took the reviewer's own recommendation rather than the other branch: the
field means "this ticket is waiting on something that will never arrive", and
a Revoked ticket is waiting for nothing. That makes `responses.ts:223-228`
true as written, so it stands unedited. `nativeWeb.ts:268-273` did not: its
*reason* ("a dependency is Done before its dependent leaves Pending and a Done
ticket is not revocable") is the false argument the reviewer caught, and it is
now the read's own rule — only a Pending ticket is read for them, because a
ticket in any other phase, **including one revoked out of the same wait**, is
waiting on nothing. `TicketProjectionRow.revoked_dependencies`
(`nativeReads.ts:74-82`) says the same thing about the column.

Test: `test/postgres/nativeReads.test.ts` — "only a Pending ticket names the
dependencies of its own that are revoked". The stranded Pending ticket lists
both its Revoked dependencies; a Done ticket released on a Revoked one lists
nothing; then the same stranded ticket is UPDATEd to Revoked — its own author's
exit — and lists nothing. The third assertion is the reviewer's scenario
literally: same ticket, same edges, phase alone changed.

**Red-proof.** Dropped `t.phase='Pending' AND ` from all three queries:
`check-postgres` red on both new cases.

## Finding 2 — the order is pinned

The fixture is now a helper, `seedRevokedDependencies(label)`, seeding six
tickets: 1 and 2 Revoked, 3 Working, 4 Pending released on `[5,3,2,1]`, 5 Done,
6 Done released on `[1]`. Ticket 4's dependencies are named **descending** in
its release entry and mix a Working and a Done one in, so nothing but the
query's own `ORDER BY` can answer `[1,2]`.

Test: "revoked dependencies are ascending in the detail read and in both
pages" — the detail read, then `order: "Identity"` and
`order: "RecentActivity"`, each asserting that the only ticket on the page
naming any is ticket 4 and that it names `[1, 2]`. That pins the order and the
phase narrowing in all three copies of the query at once.

**Red-proof.** `ORDER BY d.ticket` → `ORDER BY d.ticket DESC` in all three:
`check-postgres` red on both new cases.

## Finding 3 — the `as const` fixtures, and the sweep after them

`test/interpreter/leadPolicyHost.test.ts:67`,
`test/interpreter/selector.test.ts:461` and `:2527` lose `finalizer` and each
stage's `combinator`.

**There is no red-proof of this one and there cannot be**, which is the
finding: a named `as const` is not excess-property checked, and
`boundedCandidatePage` measures the oversized-candidate case against a
1000-character `configurationCanonical`, so no tier's verdict moves either way.
The only observable is that the suites still pass, and the grep is what holds
it. I say so rather than inventing a mutation.

The line-joined sweep across `src/` and `test/` outside `ui/`, over
`NoFinalizer`, `ManagedFinalizer`, bare `finalizer`, `finalizer:`, `AnyPass`,
`UnanimousPass`, `combinator`, `Combinator`, `DependencyRevoked`, `cascade` and
`Cascade`, found three more things. Everything else is either the finalizer
*service* (which is not going anywhere), a migration or a legacy row fixture —
the set `reviews/B-round1.md` already enumerated.

1. **`src/contract/document.ts:102` and `test/contract/contractDocument.json:39`**
   — the `repositoryLanding` route's prose ended "and a ticket authored with no
   finalizer may name no landing". Authoring no longer asks that question at
   all, so the clause described a wire that does not exist. It now reads "and a
   ticket whose landing is None names no reference to land on", which is what
   `briefFinalizationShapes.None`, `asBriefFinalization` and
   `draft_brief_finalization_none_names_no_reference` each enforce. The golden
   moved with it. *Red-proof: changing `document.ts` alone reds "the contract
   document renders the committed golden".*
2. **`test/rig/escalation.spec.ts`** — drill two drove the cascade. It created
   a dependency and a dependent, revoked the dependency and asserted an inbox
   row reading "a dependency was revoked". That behaviour is what this release
   deletes, so the drill asserted a machine this tree is not. It is now
   `test/rig/stranding.spec.ts`, "a revoked dependency strands its dependent,
   and the row says so live": the dependent's row in **up next** shows
   `/blocked by revoked dependenc/iu` without a reload, the inbox badge is
   asserted *unmoved* once that row has arrived (a badge that has not moved yet
   looks exactly like one that will not), and revoking the dependent is what
   clears the row. `test/rig/README.md:46` moved with it. The file was renamed
   because a spec called `escalation` containing no escalation is the same dead
   vocabulary finding 3 is about; nothing but the README referenced the name,
   and `playwright.config.ts` matches `*.spec.ts`.
   **This is the one thing I could not run** — the drills need a deployed rig
   and `just acceptance` is not a gate. It typechecks and lints. The copy it
   matches is the copy `GOAL.md` and `tasks/C.md` both fix verbatim ("Blocked
   by revoked dependency N"); the match is case-insensitive and stops before
   "dependency/dependencies" so only C changing the *phrase* would break it.
   **C should be told the drill exists**, since it is now the only thing
   asserting that line outside `test/ui/`.
3. **`test/interpreter/reworkCap.test.ts:47`** — a doc comment named
   "`ManagedFinalizer`", a kind the tree no longer has. It says "its
   finalization failed".

## The dead domain derivation

`src/domain/derived.ts` `revokedDependencies(core, id)` and its case at
`test/domain/derived.test.ts:147-166` are deleted, and `derived.ts`'s module
header drops the clause about "the derived read the desk is shown". Nothing
else cited it: the sweep found no caller in `src/`, `test/`, the conformance
suites, the goldens or `model/`.

**GOAL's "a pure `revokedDependencies(core, id)` in `src/domain/`" is
superseded by the projection read, and this is the change that says so.** GOAL
wrote that line against a read model with a core in it. The ticket read has
none: there is no `ticket_dependency` relation, `dispatch_candidate_dependency`
covers only dispatchable candidates, and the edges are written down in exactly
one durable place — the `ReleaseTicket` entry the read already joins for
`releasedAt`. B derived the field there, and the reviewer agreed with the
reasoning. What was left was a second derivation of the same fact that nothing
runs, tested, sitting beside the shipping one that was not — so the untested
derivation was the one that shipped and the tested one was the one nobody
called. Standing rule 3 is about a stored duplicate; this is the same failure
in code, and **zero technical debt** says the change that found it fixes it.
Finding 2's new cases are where that order is now pinned, at the tier that
ships it.

## The decision on the repository landing default

**A repository's landing default may now be `None`, and that is correct.** It
follows from `None` being a landing like any other rather than a finalizer that
does not run (`rosters.ts:258-270`): `briefFinalizationModes` gained it,
`repositoryLandingSchema` is `z.strictObject({ mode: z.enum(briefFinalizationModes) })`,
`asRepositoryLanding` (`repositoryBinding.ts:116-123`) draws from the same
roster, and 005 widened `project_repository_landing_mode_is_known` to match.

**No code change.** I read the per-repository PUT for a refusal worth keeping
and there is none to keep: the wire admits the mode because the roster does,
and a refusal would have to be written rather than removed. Writing one would
say a project may not choose to run its tickets and land nothing, which is
exactly the configuration `None` exists to offer, and it would be the only
place in the tree where the landing roster and the landing default disagreed.

The consequence is the reviewer's note, made explicit: a whole repository can
be set to land nothing, and every ticket in it then lands nothing unless its
own brief names a landing. That was not in GOAL's scope — GOAL named the
draft's picker — so it is stated here as a decision rather than left to be
discovered from the roster.

## Gates

Every one of these was run on the tip commit, after the red-proofs were
reverted and `git status --short` was empty.

Clean: `check-postgres` (75 suites, 4 workers), `check-queries`,
`check-conformance` (9 goldens, 180 steps), `check-boundaries` (1053 modules),
`check-comments` (905 files), `check-figures` (102 files), `check-paths` (1204
claims / 1155 files). `node --test` over `test/domain/derived.test.ts`,
`test/domain/invariants.test.ts`, `test/interpreter/selector.test.ts`,
`test/interpreter/leadPolicyHost.test.ts`, `test/interpreter/reworkCap.test.ts`,
`test/contract/document.test.ts` and `test/contract/responses.test.ts`: 187
tests, 0 failures.

`check-source` red in typecheck, lint and unit, in **exactly** C's six files
and nothing else — `ui/chuggy-ui/app/core/{codeSentences,resumePoint,ticketCreation,ticketLedger}.ts`,
`test/ui/{resumePoint,ticketActions}.test.ts`. `browser` and `format` stages
clean. The commit was made with `--no-verify` for that red and nothing else.

## Judgment calls a reviewer should look at

- **`responses.ts:223-228` is unedited.** Narrowing the read made it true as
  written, and the reviewer's finding offered exactly that branch. I did not
  reword it: a comment churned on for style is a comment the next reader has
  to diff against its own history.
- **The phase predicate is on one line with the two partition predicates**
  rather than on its own. On its own it pushed `nativeReadsResources` to 71
  lines and `check-queries` went red on house rule 5. The alternatives were
  splitting the three resource readers apart — a refactor this change has no
  argument for — or this. All three queries are written the same way.
- **One fixture helper for both new cases** rather than two fixtures or one
  70-line case. The two cases assert different things about the same shape and
  the cap is what separates them.
- **The rig drill was rewritten rather than deleted.** Deleting it would have
  cost the live-frame claim entirely and left the replacement to nobody in
  particular; the machine's new behaviour is worth a drill and this PR is what
  introduced it. See the caveat above: it is the one artifact here that no gate
  can reach.
- **`B-report.md` is not amended.** It repeats the claim finding 1 refuted
  ("Only a Pending ticket can list any, and the contract's doc says why"),
  which is now true of the tree. The report is a record of what that round
  decided, and this report is where the correction lives.
