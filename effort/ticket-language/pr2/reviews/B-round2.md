# Review: PR 2 Task B round 2 — the fix round — CHANGES

**CHANGES**

One finding, and it is in the one artifact no gate can reach.

I read `git diff b55c95a4..34039c0c` in full, then read
`src/adapters/postgres/nativeReads.ts`, `src/domain/derived.ts`,
`src/interpreter/nativeWeb.ts`, `src/contract/responses.ts`,
`src/contract/document.ts`, `test/postgres/nativeReads.test.ts`,
`test/rig/stranding.spec.ts`, `test/rig/rig.ts`, `test/rig/README.md`,
`test/rig/playwright.config.ts`, `test/rig/verdict.ts`,
`test/rig/creation.spec.ts`, `ui/chuggy-ui/app/core/ticketSections.ts`,
`ui/chuggy-ui/app/core/projectTableRows.ts`,
`ui/chuggy-ui/app/browser/ProjectTable.tsx` and
`ui/chuggy-ui/app/browser/TicketPage.tsx` whole rather than as hunks, plus
`model/domain.qnt` and `model/ticket.qnt` at revoke and `hasOpenHumanTask`.
I then read `reviews/B-round1.md`, `tasks/B-fix1.md`, `tasks/B-fix1-report.md`,
`tasks/C.md` and `GOAL.md`, and checked the report's claims against the tree
rather than against the report.

I ran rather than assumed. `check-postgres` clean (75 suites, 4 workers),
`check-queries` clean, `check-conformance` clean (9 goldens, 180 steps),
`check-comments` clean (905 files), `check-figures` clean (102 files),
`check-paths` clean (1204 claims / 1155 files). `check-source` red in
typecheck, lint and unit, in **exactly** C's six files — the other paths in
that log are stack frames, and the only `src/` name in a finding is the module
`ticketLedger.ts` imports `EvaluationCombinator` from. I drove both mutations
the brief names and a third of my own; all three are below. Every mutation was
applied alone, run, and reverted with `git checkout --`; `git status --short`
is empty at `34039c0c`.

## Finding

### `test/rig/stranding.spec.ts:56-66` — the drill asserts the stranded line in a place nobody is building it, and `test/rig/README.md:46-48` repeats the claim

```ts
    const stranded = panel(watcher, "up next")
      .getByRole("row")
      .filter({ has: watcher.getByRole("link", { name: String(dependent), exact: true }) });
    await expect(
      stranded.getByText(/blocked by revoked dependenc/iu),
    ).toBeVisible({ timeout: frameTimeoutMs });
```

`panel(watcher, "up next")` (`test/rig/rig.ts:239-243`) is a panel of the
**project table**; `UpNext` is that screen's Pending section
(`ui/chuggy-ui/app/core/ticketSections.ts:36,50`). The line the drill waits for
is not going there. `tasks/C.md` says the ticket "shows one line, 'Blocked by
revoked dependency N' (or 'dependencies N, M'), **in the situation column**,
with Revoke as its exit" — and the situation column is the ticket page's
(`ui/chuggy-ui/app/browser/TicketPage.tsx:6-9,138-139`, rendered by
`TicketSituation`), not a column of the project table. `GOAL.md:35-36` says
only "the console shows" and settles nothing.

A project-table row has nowhere to put it either. `ProjectTableRow`
(`ui/chuggy-ui/app/core/projectTableRows.ts:53-64`) carries one text-bearing
per-row field, `badge`, and `ticketBadgeLabel`
(`ui/chuggy-ui/app/core/ticketSections.ts:86-92`) derives it from the
escalation reason and the Escalated phase alone — it is not given the ticket's
`revokedDependencies` and takes no argument that could carry them. And "with
Revoke as its exit" is a button, which a table row does not have. So C
implementing exactly its brief leaves this drill red at its first assertion,
and the last one — `toHaveCount(0)` after the dependent is revoked — would pass
for the wrong reason, because a Revoked ticket leaves `UpNext` for `Stopped`
whatever the row says.

The report defends the *phrase* ("the copy it matches is the copy `GOAL.md` and
`tasks/C.md` both fix verbatim") and never the *place*. It is right that no
gate can reach this: `just acceptance` is not in `ci.sh`, so nothing finds out
until a rig run, which is exactly when a wrong drill is most expensive.

Fix: decide where the line lives and make the drill and the README say it. I
would point the drill at the ticket page — open the dependent's page in the
`watcher` tab with `openTicket` before the dependency is revoked, and assert
the situation column grows the line there. That keeps the whole point of the
drill, which is a live frame in a tab that never navigates again, and it
asserts the screen C is actually building. The alternative — telling C to draw
a stranded line on the project-table row as well — is new console scope nobody
has asked for, and it collides with the UI copy standard for badges.

## Notes

**The three subqueries all carry the predicate, and it is the dependent's own
phase.** `nativeReads.ts:411`, `:455`, `:515` each open with
`WHERE t.phase='Pending' AND ...`, where `t` is the outer `ticket_projection`
row in all three — the two page readers and the detail read. Nothing else in
the diff touches the SQL.

**Both mutations red-proof, and only the two new cases move.**
Dropping `t.phase='Pending' AND ` from all three queries: `check-postgres`
red, exactly two failures, "only a Pending ticket names the dependencies of its
own that are revoked" and "revoked dependencies are ascending in the detail
read and in both pages". `ORDER BY d.ticket` → `ORDER BY d.ticket DESC` in all
three: red, the same two and nothing else. The report's account of both is
accurate.

**A third mutation, which the brief did not ask for and which I think the
author should know about.** I deleted `ORDER BY d.ticket` outright — no
replacement — from all three queries and ran `check-postgres`: **clean**. So
the fixture pins ascending against *reversal* and not against *absence*, and
the fixture header at `test/postgres/nativeReads.test.ts:674-678` overstates
what it does: "Its release names them descending, beside a Working dependency
and a Done one, so only the query's own order can answer them ascending." The
aggregate walks `ticket_projection d`; `coalesce(r.deps,'[]') @> to_jsonb(d.ticket)`
is containment, so the order the release names its deps in has no bearing on
the order `array_agg` emits, and the index order already answers ascending.
The sentence is true of an implementation that enumerates `r.deps` — the
`jsonb_array_elements` rewrite round 1's performance note points at — and false
of the one in the tree. I am not making it a finding, because no fixture can
distinguish "ascending" from "unordered and ascending today", so there is no
test to ask for; and the same commit message paragraph carries the same claim.
One clause would fix both. Take it or leave it. (`comments-describe-the-code`
invoked: the comment is about the code and carries no provenance; this is an
accuracy point, not that skill's subject.)

**Both comments are now true, and true for every phase.** `responses.ts:223-228`
is unedited and says "empty for every ticket but a Pending one waiting on such
a dependency", which is what the three queries now do. `nativeWeb.ts:268-274`
replaces the false argument with the read's own rule. I checked the "any other
phase is waiting on nothing" half against the model rather than against the
code: the phases are `Pending | Working | Evaluating | Finalizing | Done |
Escalated | Revoked` (`model/ticket.qnt:51`), a ticket leaves Pending only by
dispatch, which needs `depsDoneIn` (`model/domain.qnt:317`), and a Revoked
dependency is never Done (`model/domain.qnt:204-206`) — so the only non-Pending
ticket that can hold a Revoked edge is one revoked out of its own wait, which
is the clause the comment adds. `TicketProjectionRow.revoked_dependencies`
(`nativeReads.ts:74-82`) says the same about the column. Not rewording
`responses.ts` was the right call.

**The dead derivation is gone and nothing cites it.** Line-joined grep for
`revokedDependencies`, `revoked_dependencies` and `revokedDeps` across `src/`,
`test/`, `model/`, `ui/` and `scripts/`: every hit is the projection column,
the wire field, or a fixture asserting it. `derived.ts` still uses `ticketAt`
and `visEdges` below the deletion, so no import is stranded, and the module
header's remaining sentence is true of what is left. The report's argument for
superseding GOAL's "pure derivation in `src/domain/`" is the right one and is
in the right place.

**The contract document and its golden agree.** I regenerated it:
`JSON.stringify(nativeHttpContractDocument(), null, 2)` is byte-identical to
the golden re-serialised the same way, which is what
`test/contract/document.test.ts:24-26` compares; the raw file differs only in
the formatter's whitespace, and `npx prettier --check` on it is clean. The new
clause — "a ticket whose landing is None names no reference to land on" — is
what `briefFinalizationShapes.None`, `asBriefFinalization` and
`draft_brief_finalization_none_names_no_reference` each enforce, and it is
relevant to that route now that a repository's default may be `None`.

**The rest of the drill reads correctly.** The inbox badge is asserted unmoved
*after* the row has arrived rather than on a timer, which is the right shape
for a negative, and it is true of the machine after this release — `Revoked` is
not `hasOpenHumanTask` (`model/ticket.qnt:246-252`) and `decideRevoke` parks
nothing. Revoking from the ticket page is a move the console already offers a
Pending ticket (`creation.spec.ts:59` does it on a freshly created one).
Nothing in the file drives a deleted feature: no `DependencyRevoked`, no inbox
row, no "a dependency was revoked". The rename is safe —
`playwright.config.ts:23` matches `*.spec.ts`, `verdict.ts` reads the report
rather than any file list, and the README was the only reference. The README's
"three drills need the journalled actor up" is still true after it.

**The `as const` fixtures and the sweep.** The three are clean. I ran the
line-joined grep myself over `src/`, `test/` and `model/` for `NoFinalizer`,
`ManagedFinalizer`, `AnyPass`, `UnanimousPass`, `combinator`, `Combinator`,
`DependencyRevoked`, `cascade`, `Cascade`, `finalizer:` and bare `Finalizer`.
Everything left is the finalizer *service*, a migration, a legacy row fixture
or `decisionSemantics.ts` naming the spellings it drops — the set round 1
enumerated — plus two I checked that round 1 did not call out and that are
correct: `test/contract/responses.test.ts:965` asserts a hand-assembled read
**drops** a stage's `combinator`, and `:992` asserts the request body is
**refused** for it. `test/postgres/readiness.test.ts:263` is the stored
`ExecutionBlocked{DependencyRevoked}` the decode must refuse. The
`reworkCap.test.ts:46` reword is accurate about `finalizationResultEvent`.

**The shared-line judgment is honest.** `nativeReadsResources` spans
`nativeReads.ts:484-553`, which is exactly 70 lines against
`max-lines-per-function: { max: 70 }` (`eslint.config.js:242-245`) — so the
report's account is right that the predicate on its own line pushes it over,
and it would be red under `check-source`'s lint as well as under
`check-queries`. Nothing is hidden by it: all three queries are written the
same way, the predicate is the leading conjunct where a reader looks for it,
and the line is no denser than the `recentActivityAfter` line four lines down.
There is no line-length rule and `.prettierrc.json` does not reach inside a
template literal. What it does mean is that the next line anyone adds anywhere
in that function forces the refactor the report declined; that is a fact about
the file rather than a finding against this change.

**What I did not check.** Anything under `ui/` and `test/ui/` beyond
confirming `check-source`'s reds are confined to C's six files and reading the
three console modules this review's finding rests on; migration 005, which
`reviews/S-round1.md` covers; `src/domain/`, `src/actor/` and the goldens
beyond the deletion and the model reading above; and `check-random`,
`check-boundaries`, `check-keto`, `check-console` and `check-model`, which the
brief did not ask for and which this diff does not reach.

**The decision in the report I am not reopening.** That a repository's landing
default may be `None` follows from `None` being a landing, and the report
states it as a decision with the chain checked. It is S's and the orchestrator's
to accept, not this review's to reject.

**The worktree.** Three mutations, each applied alone, run, and reverted; no
file written inside the tree; the gates dropped their own scratch databases.
`git status --short` is empty at `34039c0c`.
