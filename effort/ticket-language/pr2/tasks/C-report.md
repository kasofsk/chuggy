# Task C report: the console loses the three

Branch `model/three-deletions`, worktree `~/claude/chuggy-wt/three-deletions`.
Starting tip `b55c95a4`. Final tip **`5abccfee04238a753aafe6662da1ce047f602578`**
(one commit, not pushed).

## Scope actually touched

Exactly `ui/chuggy-ui/` plus the two root oracle suites named in the brief:
`test/ui/resumePoint.test.ts` and `test/ui/ticketActions.test.ts`. 36 files
changed (35 modified, one new: `ui/chuggy-ui/test/ticketSituation.test.tsx`).
Nothing in `src/`, `model/`, or `.chug/` was touched.

## What changed, by the brief's four asks

**1. Finalizer → landing choice, with None.** `TicketCreation.tsx`'s Landing
picker (already existed for Managed tickets) is now unconditionally rendered;
the `form.finalizer === "ManagedFinalizer"` gate around it is gone, replaced by
hiding only the target-branch box when `form.landingMode === "None"`.
`TicketCreationAdvanced.tsx`'s `WorkAndFinalizer` component lost its finalizer
`ChoiceRow` and was renamed `WorkFanout` (it now draws only work fanout).
`codeLabels.ts` lost `finalizerLabel`; `landingLabel`/`landingEffect` gained a
`"None"` case ("None" / "Lands nothing"). `ticketCreation.ts`'s
`creationFinalizationOf` now always sends a `finalization` object — `{mode:
"None"}` when landing on nothing — rather than omitting it; `creationBodyFrom`
no longer sends `authoring.finalizer` at all. `TicketProvenance.tsx` dropped
its "finalizer" field row. Repository pages lost the whole "Finalizer" panel
(`RepositoryFinalizerSection` in `RepositoryPage.tsx`) since the sibling
"Landing" panel already shows the same choice via the wire's
`repositories[].landing.mode`; its only other caller,
`repositoryReadyConfiguration` in `repositoryConfigurations.ts`, was deleted
with it as dead code.

**2. Stage loses its combinator.** `ticketLedger.ts`'s `setVerdict`/`taskSetOf`
now combine unanimously unconditionally (no combinator lookup);
`ticketCreation.ts`'s `creationStageLabel` draws just the fanout (was
`"N × combinator"`); `TicketProvenance.tsx`'s stage label followed suit.

**3. `DependencyRevoked` removed everywhere.** Deleted from
`escalationReasonLabel`/`escalationDetailLine` (`codeLabels.ts`),
`escalationReasonSentence` (`codeSentences.ts`), `escalationBadgeLabel`
(`ticketSections.ts`), and `walledPoint` (`resumePoint.ts`, whose module
doc comment's "three different reasons" became "two").

**4. The blocked-Pending banner.** New `revokedDependencyLine` in
`codeLabels.ts` renders "Blocked by revoked dependency N" / "...dependencies
N, M". `TicketSituation.tsx`'s `SituationNotice` draws it ahead of the
phase/wall notice, tone `"parked"`, heading `"Blocked"`. No project-table
badge was added — the brief scopes this to the situation column only, and no
desk task or wall exists for it, which required no changes: `ticketActions.ts`
already offers `Revoke` for every phase but `Done`/`Revoked`/`Finalizing`, so a
Pending ticket already had it; `Resume` is Escalated-only and was already
absent. I did fix `ticketActionSentence("Revoke")`, which said "...and park
every ticket that depends on it" — no longer true now that revoke touches only
the named ticket — to plain "revoke this ticket".

## The mid-task contract clarification (phase-gating)

The coordinator relayed, mid-task, that `revokedDependencies` is meant to
answer non-empty *only* for a Pending ticket (empty in every other phase,
including a since-revoked one), but that this is being fixed on a sibling
branch and the console should not take the invariant on faith against its own
read. I gated the banner in `SituationNotice` on `props.ticket.phase ===
"Pending"` in addition to the list being non-empty, with a doc comment
explaining why the phase is re-checked rather than trusted. I added a
dedicated test (`ticketSituation.test.tsx`) for exactly this: a read naming a
settled phase (`"Done"`) alongside a non-empty `revokedDependencies` list
draws the phase, not the banner.

A second coordinator message (relayed after a sibling spec renamed itself
`test/rig/stranding.spec.ts` and pinned the copy via
`/blocked by revoked dependenc/iu`) asked me to confirm my wording matches;
it already did ("Blocked by revoked dependency 3" / "...dependencies 1, 2"),
so no wording change was needed.

## Test changes — deleted vs. rewritten

Deleted outright (no surviving vocabulary; the mechanism itself is gone):
- `ticketLedger.test.ts`: "a stage's combinator decides its set, so any pass
  carries an AnyPass stage" — `AnyPass` doesn't exist; sets are unanimous only.
- `ticketPageLedger.test.tsx`: "a wall whose only exit is revoke offers no
  resume to press" — drove a synthetic `DependencyRevoked` ticket through the
  full page; that reason no longer exists. (The underlying mechanic — a wall
  with a `NoPoint` resume offering only Revoke — still has unit coverage in
  `codeLabels.test.ts`.)
- `test/ui/resumePoint.test.ts`: "a ticket parked by a revoked dependency is
  offered no resume" — `decideRevoke` no longer parks the dependent, so the
  premise is gone. Its now-unused `decideRevoke`/`Config`/`fleetOfTwo` imports
  went with it.
- `ticketCreationForm.test.tsx`: "the advanced finalizer reads as a noun, and
  Managed is what asks for a landing" — the Advanced-disclosure finalizer
  `<select>` doesn't exist any more; the None/landing choice is on the main
  form now, not gated behind a second control.
- `repositoryPage.test.tsx`: "the finalizer is the newest ready revision's,
  and says when it runs" — the panel it tested is deleted.
- `repositoryConfigurations.test.ts`: "the ready revision is this repository's
  own newest" — tested the now-deleted `repositoryReadyConfiguration`.
- `codeLabels.test.ts`: "a finalizer and an approval each read as one noun"
  narrowed to "an approval reads as one noun" (its `finalizerLabel` half is
  gone; its `approvalLabel` half survives as its own test).

Rewritten to the surviving vocabulary (same property, new mechanism):
- `ticketCreationForm.test.tsx`'s "a form running no finalizer asks for
  neither a landing nor a target" → "a form landing on None still asks for a
  landing, and asks for no target" (Landing is now always drawn; only the
  target box is conditional on `landingMode === "None"`).
- `ticketCreationForm.test.tsx`'s "changing the finalizer to None releases a
  ticket the target box would have refused" → same property, driven through
  the top-level Landing radio group instead of the deleted Advanced finalizer
  select.
- `ticketCreation.test.ts`'s two "form with no finalizer" tests → "a form
  landing on None sends its mode and no target" / "...is not refused for a
  target it neither draws nor sends", asserting `finalization: {mode:
  "None"}` is sent (previously asserted no `finalization` key at all — that
  was the old wire shape, not the new one).
- `codeLabels.test.ts`'s "a landing is named as a noun and explained as what
  it does" gained the 4th (`"None"`) entries in both expected arrays — this
  was a **runtime, not compile-time, risk**: `briefFinalizationModes` gaining
  a member doesn't fail typecheck on a `.toStrictEqual` against a literal
  array, only the test run.
- `resumePoint.test.ts` (both copies) and `ticketActions.test.ts` (both
  copies): stripped `finalizer`/`combinator` fields from hand-built `Ticket`/
  `Stage` fixtures; `test/ui/resumePoint.test.ts`'s `closedVerdict` helper
  dropped its combinator lookup (`combine()` is unary now); `ticketSections
  .test.ts` dropped the `DependencyRevoked` row from its total-record fixture.

Fixture/plumbing-only (no behavior change, just following the schema):
`ticketInstants.ts`, `ticketCreationFixture.ts`, `ticketLedgerFixture.ts`,
`ticketPageFixture.ts`, `ticketLabels.test.tsx`, `conversationMention(s)
.test.ts(x)` — stripped `combinator`/`finalizer`/`finalizers` fields, added
`revokedDependencies: []` where a `TicketResponse` fixture needed it (the
field went from optional to required this PR).

New: `ticketSituation.test.tsx` — four cases for `SituationNotice`'s new
branch: singular banner, plural banner, no banner when the list is empty, and
the phase-gate defense (settled phase + non-empty list still draws the
phase). Not explicitly asked for by the brief, but the phase-gating behavior
introduced by the mid-task clarification had no coverage anywhere else, and
I judged it warranted a direct test given the coordinator flagged it as a
live contract concern.

## Judgment calls

1. **Deleting the Repository "Finalizer" panel outright** rather than
   reworking it to show landing info, since `RepositoryLandingSection.tsx`
   already renders the identical choice from `repositories[].landing.mode` —
   keeping both would have been a duplicate, not a rename.
2. **`repositoryReadyConfiguration` deleted** rather than kept unused, since
   its only caller was the deleted panel and its only other reference was its
   own dedicated test (also deleted).
3. **`revokedDependencyLine` phrasing**: "Blocked by revoked dependency N" /
   "...dependencies N, M" (ascending, comma-joined) — matches the "Nothing to
   resume · only Revoke exits this wall" register already used for wall
   details in this file, and independently satisfies the rig spec's regex.
4. **`LandingWithTarget` type-narrowing**: rather than fabricate a "None"
   branch for `landingTargetName`/`landingDefaultTarget` (functions that only
   make sense for a mode with a target), I narrowed their parameter type via
   `Exclude<BriefFinalizationMode, "None">` and added one guard in
   `briefLandingLine` before either is called. This keeps the switch
   statements exhaustive without a meaningless case.
5. **`creationFaultSentence("landing")` reworded** from "a ticket with no
   finalizer lands nothing" (stated a fact, not a fault) to "this landing is
   not one the API will accept" (the actual refusal condition —
   `draftCreationSchema` rejecting the mode).
6. **No project-table badge for a blocked-Pending ticket** — the brief scopes
   the new line to "the situation column" only, and I found no existing badge
   slot in the tickets table that models phase-adjacent detail this way.
7. **Comment fixes beyond the brief's four asks**, caught by a manual pass and
   the `comments-describe-the-code` skill: `creationFinalizationOf`'s doc
   comment claimed finalization is "sent explicitly whenever a target is on
   screen to read", which doesn't match the code (it's sent on every
   submission unconditionally; only the `target` *key inside it* is
   conditional) — reworded. A parallel doc-comment drift in
   `ticketCreation.test.ts` ("so the finalization is sent whenever the form
   runs one") had the same issue and was fixed alongside it.

## Gates run

- `npm run lint` in `ui/chuggy-ui` — clean.
- `npm run test` in `ui/chuggy-ui` — 118 files, 1283 tests, all passing.
- `node --test` directly on both root oracle suites — 9/9 passing (verified
  the model deciders still agree with the console's restatement).
- `.chug/tasks/check-source.sh` — clean (typecheck, browser tsconfig, lint,
  format, unit all clean; format needed one `prettier --write` pass over 6
  files after my edits, then re-verified clean).
- `CHUG_CI_FULL=1 .chug/tasks/ci.sh` — **1 gate failed: `check-model.test.sh`**
  (rc=1), everything else clean (`check-boundaries`, `check-source`,
  `check-console`, `check-conformance`, `check-random`, `check-postgres`,
  `check-queries`, `check-keto`, `check-model` itself, `check-model-api`, and
  every other listed shell suite).

### The one CI red is pre-existing and out of scope

`check-model.test.sh` (the self-test *for* `check-model.sh`, not the model
gate itself — that ran clean: "0 failure(s), 111 test(s) run" against the real
`model/` corpus) failed two of its own cases, both expecting its fixture run
to report **"15 test(s) run"** but getting **13**. I traced this to commit
`05547b54` ("the machine loses NoFinalizer, the revoke cascade and AnyPass" —
the model-layer sibling task's work), which reduced the model's unit-test
count without updating this self-test's hardcoded expectation. I confirmed
`05547b54` is an ancestor of **both** my final tip and my branch's starting
tip `b55c95a4` — this was already broken before I made a single edit, and
`model/`, `.chug/tasks/check-model.sh`, and `check-model.test.sh` are all
outside my brief's stated scope (`ui/chuggy-ui/` and the two oracle suites),
owned by the model-layer tasks. I left it untouched rather than risk
conflicting with whoever owns that fixture.

## Commit

One commit, `5abccfee04238a753aafe6662da1ce047f602578`, message carries the
why (landing/fanout/revoked-dependency rationale, the phase-gating fix, and
the Finalizer-panel deletion), ends with the required
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer. Not pushed.
The pre-commit hook's `check-comments` gate caught one `//`-style comment I'd
written in `TicketSituation.tsx` (this repo requires `/** */` for all prose);
converted to a block doc comment and the hook passed clean on retry.
