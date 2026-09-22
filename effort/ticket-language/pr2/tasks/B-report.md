# Task B (PR 2) — report

Branch `model/three-deletions` in `~/claude/chuggy-wt/three-deletions`, one
commit on top of the merge S and A produced.

- base `27d510e3` (A's `c64bb04c` with `schema/three-deletions` merged)
- **tip `9a1f7151`** — "the wire, the authoring and the finalizer lose the
  three", 60 files, +929 / -590. Not pushed.

One commit rather than two. The ticket read's `revokedDependencies` is not a
separable change: it exists *because* the cascade left, and a commit that
deleted the cascade without it would ship a machine that strands a Pending
ticket with nothing on the wire that says so.

## Decisions the brief asked for

**`dispatchViewSchemaVersion` stays at 1.** Bumping it buys nothing a failure
can be named for. A cached view written at the old version says strictly
*more* than the new decoder reads — `finalizer` and each stage's `combinator`
are now unknown keys that `z.object` strips — and no key was repurposed, so
no old view decodes to a different meaning. The version is only ever compared
for equality (`wire.ts:197`, `projectWriter.ts:295`, the literal `'1'` in
`submit_ticket_command`), so a bump would force a fourth statement into 005
to rewrite stored rows whose only sin is being readable.

**A brief with no `finalization` takes the repository's landing default, not
`None`.** `briefFinalizationDefault` is `{ mode: "Push" }`,
`project_repository.landing_mode` is `NOT NULL DEFAULT 'Push'`, and
`create_draft`/`revise_draft` resolve
`coalesce(in_finalization_mode, repository.landing_mode, 'Push')`. The
per-repository default from `landing-default-2026-09-12` is what "no
finalization" already meant for every draft that carries a repository; `None`
was only ever reachable through the NoFinalizer arm, which 005 rewrote. So B
never reads NULL as "default": post-005 no draft row carries one, and
`draftBriefFinalizationOf` says so in its doc.

**`revokedDependencies` comes from the projection and the journal's release
entry, not from a core.** The read holds no core and no dependency relation:
there is no `ticket_dependency` table, and `dispatch_candidate_dependency`
covers only candidates that are dispatchable. The edges exist in exactly one
durable place the ticket read already joins — the `ReleaseTicket` entry it
reads `releasedAt` from — so the derivation reads `deps` off that entry and
joins `ticket_projection` for `phase='Revoked'`, ascending. All three queries
in `nativeReads.ts` extend the existing release-entry LATERAL with `deps` and
a correlated `array_agg`.

Only a Pending ticket can list any, and the contract's doc says why: to leave
Pending, every dependency is Done, and `revocableIn` excludes Done, so a
dependency a ticket has already passed can never become Revoked.

## The two additions from the migration reviewer

**A stored `ExecutionBlocked{reason:"DependencyRevoked"}` operation is refused
at decode, by name.** `operationSource` in `postgres/readiness.ts` now throws
`stored operation <input_id> is unreadable: <why>` rather than coercing the
reason or dropping the row. This is the semantics-4 rule GOAL states: a row
this image cannot read is a refusal the operator sees, not a silent
reinterpretation. Pinned by `test/postgres/readiness.test.ts` — "an operation
carrying a wall this machine lost is refused by name", which accepts a real
submission, UPDATEs its `operation.command` to the blocked shape, and asserts
`discovery.next` rejects with the operation id in the message.

**`schema/README.md:198` fixed.** The line claimed
`public_ticket_command_is_valid` was "the grammar migration 5 wrote" — about a
pre-baseline migration 5 that no longer exists and now collides with the real
005. It now says the function carries the public grammar under its own name,
which is what the baseline's body actually shows.

## What B added to 005

S's migration was approved unchanged; B appended to it rather than editing
S's statements.

- `CREATE OR REPLACE FUNCTION ticket_command_is_valid` — admits a
  `FinalizationSubmission` with no `attempt`.
- `CREATE OR REPLACE FUNCTION submit_finalization_result` — one new arm, the
  narrowest that admits the landless conclusion: a success, on a
  `RunFinalizer` bound whose landing `IS NOT DISTINCT FROM 'None'`, with no
  failure kind and no attempt. Every other absent attempt is still a
  `BindingMismatch`. A fabricated `finalization_attempt` row was the
  alternative and was rejected: its `repository`, `input_bundle`,
  `target_ref`, `target_commit` and `configuration_revision` are all NOT NULL
  facts about a remote that was never asked.
- `ALTER TABLE draft_brief ADD CONSTRAINT
  draft_brief_finalization_none_names_no_reference` — a landing that lands
  nothing lands on no reference. Added inside S's existing guard.
- **The mailbox bound re-render.** Dropping `finalizer` from
  `candidateOwnMembers` shortens the longest observation a lead can be given:
  `sessionTurnInputCharsMax` fell, so 005 exports
  `leadObservationTokensPerDecisionAt005`, guards `session_turn` at the new
  figure in the first DO block, re-renders `session_turn_text_is_bounded`, and
  re-seeds `selector_runtime_settings` and its history — exactly the shape 004
  used. This was found the hard way: relaxing
  `test/adapters/leadTokenBudget.test.ts` to `>=` passed, then
  `check-postgres` went red on "the installed session constraints match the
  runtime", which is the tree saying the rule is exact rendering. The
  relaxation was reverted.

## Red-proofs

Each mutation was applied alone, the named suite was run, and the file was
restored.

| # | mutation | red |
|---|---|---|
| 1 | drop `revokedDependencies` from `ticketResponseSchema` | "a ticket read emits exactly the keys the contract names", plus the project and ticket parses |
| 2 | drop the `finalizationMode === "None"` arm in `finalizationNext` | "a brief that lands nothing succeeds before anything is prepared" |
| 3 | drop the `None` short-circuit in `finalizerGather` | "a pass over a ticket that lands nothing concludes it and asks no remote" |
| 4 | rename the `None` literal in `briefFinalizationShapes` to `"Nowhere"` | three contract suites |
| 5 | drop the target refusal in `asBriefFinalization` | `ticketBriefRows.test.ts` `/lands on no reference/` |
| 6 | delete `AND d.phase='Revoked'` from all three queries | "a ticket behind a revoked dependency names it, and a Done one names none" |
| 7 | drop the operation id from `operationSource`'s message | "an operation carrying a wall this machine lost is refused by name" |
| 8 | delete the `None` arm from `submit_finalization_result` | "a request whose brief lands nothing concludes on no attempt at all" |
| 9 | delete the `draft_brief_finalization_none_names_no_reference` CHECK | "a landing that lands nothing is refused a reference to land on" |
| 10 | delete 005's `session_turn` guard arm | "a session turn wider than threedeletions's bound refuses the migration untouched" |
| 11 | delete 005's `session_turn_text_is_bounded` re-render | "the installed session constraints match the runtime" |
| 12 | delete 005's `selector_runtime_settings` re-seed | "fresh selector settings carry current controls and only their initial history" |
| 13 | delete 005's `dispatch_candidate` program rewrite | "a stored dispatch program is rewritten as the encoder without the combinator writes it" |

Two fixtures were rebuilt because the deletion would otherwise have made them
vacuous, which is the same failure in the other direction:

- `migration.test.ts`'s program-rewrite fixture encoded *both* sides with
  `encodeDispatchProgram`, so after the deletion it would have compared
  `{fanout}` to `{fanout}`. The stored side is now a hand-written legacy JSON
  literal.
- `projection.test.ts`'s "dependency eligibility distinguishes the escalated
  reasons" became vacuous — dependability is phase-only now — and was deleted.
  `test/domain/enablement.test.ts:111` already covers `dependableIn`.

`nativeActionAdmits.test.ts` was rewritten rather than deleted: it drove the
cascade and expected `Escalated`/`DependencyRevoked`; it now pins the
stranding, with the dependent staying Pending/NoReason/NoResume and
`admitsOffered` returning `[]`.

## Gates

Clean: `check-paths` (0 findings / 1204 claims), `check-figures`,
`check-comments` (905 files), `check-boundaries` (1053 modules),
`check-queries`, `check-conformance` (9 goldens, 180 steps), `check-random`
(2000 runs), `check-postgres` (75 suites). The pre-commit hook ran clean on
the commit — no `--no-verify` was needed.

`check-source` is red in three stages (typecheck, lint, unit), every finding
in a file the console task owns:

- `ui/chuggy-ui/app/core/codeSentences.ts` — `DependencyRevoked` case
- `ui/chuggy-ui/app/core/resumePoint.ts` — `DependencyRevoked` case
- `ui/chuggy-ui/app/core/ticketCreation.ts` — `finalizer` field, stage
  `combinator`
- `ui/chuggy-ui/app/core/ticketLedger.ts` — `EvaluationCombinator` import,
  stage `combinator`
- `test/ui/resumePoint.test.ts` — 4 failing cases and 2 lint errors
- `test/ui/ticketActions.test.ts` — `finalizer` fixture, a ticket fixture
  missing `revokedDependencies`

Nothing outside `ui/` and `test/ui/` is red.

## Notes for the reviewer

- `finalizerBranchesOf(brief)` replaced `finalizerGatherBranches`: the brief
  is read before the binding now, because a landing that lands nothing needs
  no binding. The argument is in the module headers of `finalizer.ts` and
  `finalizerRun.ts`, not in a doc block — `check-comments` caps a non-header
  block at two sentences, and it caught both attempts to put it elsewhere.
- `selector.ts` carried a `finalizer` enum in its stored-observation schema
  that nothing read; it is gone, and stored observations decode with the key
  stripped.
- `test/postgres/nativeReads.test.ts`'s "project reads filter before paging
  and expose one ticket detail" was split in two: the added expectations
  pushed it past the 70-line function cap, and it was pinning two claims.
- `readProjectTickets` in `nativeReads.ts` became `readTicketsByActivity` and
  `readTicketsByIdentity` for the same cap.
- `digest.test.ts`'s pinned wire text and digests were recomputed: the release
  entry's program is now `[{"fanout":1}]` and it carries no finalizer.
