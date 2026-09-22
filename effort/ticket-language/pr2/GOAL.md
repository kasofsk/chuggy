# PR 2: three small deletions — NoFinalizer, the revoke cascade, AnyPass

Decided by Geoff 2026-09-20 (SPIKE.md Decisions 2–4). Second step of the
convergence onto chug-ticket-domain (pin 76c95a9). Base: main 617675bb (PR 1
merged and rolled). Branch `model/three-deletions`, worktree
`~/claude/chuggy-wt/three-deletions`; schema on `schema/three-deletions`,
worktree `~/claude/chuggy-wt/three-deletions-schema`, merged into the code
branch as in PR 1. Read `../GOAL.md` (PR 1) for the shape this repeats and
`../reviews/ledger.md` for what its reviewers caught.

## What goes

**NoFinalizer.** `Finalizer` leaves `model/ticket.qnt`; the `finalizer` field
leaves `Ticket`, `ReleaseTicket` and `refinement.qnt`'s `DecisionEvent`; a
passing final stage always moves to Finalizing with `RunFinalizer`;
`finalizerChoices`, `noFinalizationWithoutAKind`, the `wrapup_none` witness
and the `nofinalizer-completion` golden leave. In the application, "no
finalizer" is one finalization configuration the finalizer service
interprets by reporting `FinalizationSucceeded` at once: `briefFinalizationModes`
gains `"None"` (lands nothing, touches no forge), `finalizers` and
`FinalizerChoice` leave the wire, the ticket view and the authoring options
lose `finalizer`, `checkedDraftLanding` leaves, `dispatch_candidate.finalizer`
is dropped, the console's finalizer picker becomes the landing choice with
None among the modes.

**The cascade.** `decideRevoke` parks nothing: the revoked ticket alone
transitions, one `CancelTicketWork`, no `OpenHumanTask`. `DependencyRevoked`
leaves `Reason`; `modeledResumeExists` (now always true) leaves;
`revokeDoomed`, `cascadeSafety`, `noStructuralDeadlock` and the `cascade`
witness leave the model and `src/domain/derived.ts`/`invariants.ts`. A
Pending ticket with a Revoked dependency stays Pending: `depsDoneIn` never
admits it and revoke stays offered (`revocableIn` admits Pending). The read
model derives it: a pure `revokedDependencies(core, id)` in `src/domain/`,
carried on the ticket read as `revokedDependencies: readonly number[]`
(empty for every other ticket), and the console shows "Blocked by revoked
dependency N" with Revoke as the one exit. `ticket_projection` and
`native_action` reason CHECKs narrow; the journal validity function stops
admitting the literal.

**AnyPass.** `Combinator` leaves; `Stage = { fanout: int }`; `combine` is
unanimous and loses its argument; `stageChoices` ranges over fanout alone;
the authoring roster, the dispatch view, `dispatch_candidate.program` JSON
and the console ledger lose `combinator`.

## Decision semantics 4

Stored rows keep replaying (`src/actor/decisionSemantics.ts`, same pattern
as 3). Read off the row: a `ReleaseTicket` at ≤3 carries `finalizer` and
each stage carries `combinator`; `ManagedFinalizer` and `UnanimousPass` are
the surviving meaning and the decoder drops the keys; `NoFinalizer` or
`AnyPass` name a machine this one is not and are refused by
`storedJournalLegalOn`, as a removed wall is; a `Revoke` row whose record
transitions more than one ticket is the cascade and is refused the same way.
The journal's stored text is digest-chained (PR 1, B) so no row is
rewritten; `decision_event_is_valid` at 005 admits `finalizer` absent or
`ManagedFinalizer` and `combinator` absent or `UnanimousPass`, with the
header saying why the legacy spellings stay admissible.

## Rig facts (2026-09-21, ledger at 4)

journal_entry: 603 rows; 0 name NoFinalizer, AnyPass or DependencyRevoked;
0 revoke rows transition more than one ticket. ticket_projection: 0 rows at
DependencyRevoked. dispatch_candidate: empty. native_action: 18 rows with
reason DependencyRevoked, all settled (13 Resolved on vteng/chuggy, 4
Resolved + 1 Withdrawn on vteng/rehearsal). Only Open rows are read
(`nativeReads.ts` ~530, `readiness.ts` ~331), so 005's guard refuses an
Open row at the removed reason and the narrowed `native_action` CHECK keeps
a settled-row arm admitting the literal as history, stated in the header.
Guard refuses on: ticket_projection reason, Open native_action reason,
journal rows naming NoFinalizer/AnyPass/DependencyRevoked, journal revoke
records with more than one transition.

## Sequence

A (opus): model, goldens, generated, domain, actor semantics 4, conformance.
S (opus, parallel): migration 005 + migration.test.ts.
B (opus, after A): interpreter, adapters, contract, finalizer None mode,
   ticket read's revokedDependencies, dispatch view.
C (sonnet, after B): console.
Fresh reviewer per round; whole-branch mutation sweep second; full ci.sh;
PR; merge; release to the rig; pause for Geoff.

## Not in scope

PR 3 renames. The Finalization Unavailable escalation (PR 4). Any package
change.

## Progress

- 2026-09-21: S APPROVE; A CHANGES→fixed; B CHANGES→fix→round 2 CHANGES (drill)→fixed 597f1e0c; C 5abccfee + orchestrator fix; integration tip dd7e1423; sweep running.
- 2026-09-21: full ci exit 0 on d3a66d0f (main a7bca1ed merged in); PR #719 open; merge held until Geoff's rig chain 82→84 releases (83 builds whatever main is).
- 2026-09-21 08:2x UTC: #719 merged, main ba0c5a68. Release goes through Geoff's rollout ticket 84: it escalated (WorkFailed) because my #721 merge moved main past 83's request (ac99fb06); filed the request for ba0c5a68 via scripts/request-build (fabric #280), dumped the DB to /home/geoff/backups/chuggy-pre-ba0c5a68.dump, minted Hydra client convergence-admin (node file, admins tuple on 5:vtengchuggy), resumed 84 (operation cf8abaa7). Undo: DELETE the tuple, hydra delete oauth2-client a01fa804-…, rm /home/geoff/convergence-admin.json api-call.sh resume-84.json.
- 2026-09-21 08:5x UTC: RELEASE FAILED. Ticket 84 rolled ba0c5a68 (fabric #281); migrate job refused: 005's guard found nine old-machine cascade-revoke rows (chuggy seq 203, 267, 310, 561; rehearsal 5, 14, 17, 23, 29; semantics 1–2). PR 2's rig check looked for the three names, not the cascade shape. Fabric rolled back by #282 (revert of #281); rig on the previous images, ledger 4, all deployments 1/1. Fix forward in pr2-fix/ (branch fix/cascade-rows-replay).
- 2026-09-21 09:3x UTC: fix #722 merged (main 55de9de6): cascade rows are a semantics ≤3 correction; 005's guard arm removed in place. Rig journal replayed legal through the fix (probe: pr2-fix/replay-rig.ts). Release of 55de9de6 by runbook started.

- 2026-09-21 ~09:50Z: re-release of main 55de9de6 (fabric #283) landed on the rig. `chuggy-migrate-55de9de6-registry` applied 005 (ledger 5); all seven deployments rolled to api@6f6e2b3d / web@9cf1759c; no CrashLoop; console 200; api reads ticket 84 (Done) and the project list; projection holds Done and Revoked rows only, all NoReason; importer failures at 08:46–08:50 were the failed-release window, 09:46 run succeeded. Dump before: `/home/geoff/backups/chuggy-pre-55de9de6.dump`. Temporary identity (Hydra a01fa804…, Keto admins tuple, `/home/geoff/{convergence-admin.json,api-call.sh,resume-84.json}`) kept for PR 3's release, then removed.
