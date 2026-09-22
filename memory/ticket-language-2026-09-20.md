---
name: ticket-language-2026-09-20
description: Converge chuggy's ticket model onto chug-ticket-domain until it can be imported; decisions Geoff made 2026-09-20 (accounts, NoFinalizer, cascade, AnyPass all go); plan in ~/claude/chuggy-effort/ticket-language/SPIKE.md
metadata:
  type: project
---

Effort started 2026-09-20 after the handoff removal ([[handoff-removal-2026-09-20]]).
Goal: chuggy's ticket model converges PR by PR until it is textually
`@kasofsk/chug-ticket-domain`'s three Quint modules (pinned 76c95a9,
v0.5.0: execution requirements opaque, no inputBindings, evolve applies
only to the state that owes the event; Geoff says this is the last change), then chuggy imports the package and deletes its copy. The earlier
full swap, PR #670 (dc/chuggernaut-adoption), is the anti-pattern: 926
files at once, unreviewed, parked.

Geoff's decisions (interview 2026-09-20): all four accounts go (gas,
rework budget, finalization pricing, retry pricing) and `measure.qnt` is
deleted; rework caps stay an implementation feature via the package's
EvaluationFailurePolicy over workCyclesStarted. NoFinalizer goes ("no
finalizer is just an opaque config"). The DependencyRevoked cascade goes,
derived in the read model. AnyPass goes. The end state is import, not
"same words in chuggy's own file".

**Why:** the package is the simpler, more agnostic model Geoff and Dave are
married to; chuggy's extras were modeled arbitrarily and belong in the
implementation.

**How to apply:** plan and PR table in
`~/claude/chuggy-effort/ticket-language/SPIKE.md`. PRs 1–5 are deletions
and renames (each handoff-removal sized); 6–9 change what fabric, schema
and console exchange and get their own goal dirs. Geoff: ignore #670's contents
entirely; no package policy hook for finalizer rework: the finalizer itself
bounds its NeedsWork cycles (Geoff 2026-09-20). No package changes agreed.

**PR 1 landed 2026-09-20:** kasofsk/chuggy#714 (main 617675bb), the accounts leave.
Reviews S/A/B/sweep under chuggy-effort/ticket-language/reviews/ledger.md. Decision
semantics v3; rework cap is ticket-service `rework.cyclesMax` counting only reworks a
failed evaluation bought (finalizer rework uncapped, Geoff); journal chain verifies
over stored row text. Fabric config change gdoteof/chuggy-fabric#275 rolls with the
release carrying migrations 002–004. Next: PR 2 (NoFinalizer, cascade, AnyPass).

**PR 2 landed and released 2026-09-21:** kasofsk/chuggy#719 (three deletions, semantics 4,
migration 005) plus fix #722 (main 55de9de6): the old machine's cascade rows are a
semantics ≤3 *correction* (dependents named in the extra transitions replay to
Escalated/NoReason/NoResume), not a refusal; 005's guard lost its cascade arm. First
release of ba0c5a68 failed at that guard and was rolled back (fabric #282); 55de9de6
released via fabric #283, ledger 5 on the rig. Lesson: a rig pre-check greps shape, not
names, and `pr2-fix/replay-rig.ts` replays the rig journal under `storedJournalLegalOn`
before any release that changes replay. Next: PR 3 (rename, semantics 5, migration 006)
on branch model/rename, effort dir pr3/.

**PR 3 landed 2026-09-21:** kasofsk/chuggy#723 (main e5f7b3d3): the rename to the
package's names; decision semantics 5 with `rowAtCurrentVocabulary` lifting stored
spellings before the codec; migration 006 rewrites projections/native actions/
continuations; fabric-facing task kind stays Work/Evaluation (adapter maps);
`execution.blocked_reason` keeps the five walls and `executionBlockedBy` carries one to
the reader. Frozen `test/actor/journalAtSemanticsFour.json` (written by main's deciders at
55de9de6) pins every lifted key. Trap found: gate *suites* (`check-conformance.test.sh`
golden name, `check-random.test.sh` mutant text and seed) hardcode model names and only
the full roster's shell suites catch them; a rename PR must run `CHUG_CI_FULL=1`.
006 rehearsed on a restored rig copy as `chuggy_owner` before release, then released to the rig 2026-09-21 (fabric #284, ledger 6; recipe in
pr3/GOAL.md). Next: PR 4 (Finalization Unavailable), PR 5 (Escalated as sum, regains the
continuation-path RemoteDenied evidence).

PR 3 shipped a regression: `draft_revision.authoring` was not lifted, so every stored draft read (Brief/Provenance panels, drafts page, ReleaseDraft) answered InvalidRequest on the rig. Fixed and released 2026-09-21 by #724 (main d126c09a). See [[stored-text-outside-the-journal]].

PR 4 (Finalization Unavailable escalates) landed as #725, main bd63df14, released to the rig with migration 007 on 2026-09-21. PR 5 (Escalated as a sum) is next; its survey is under pr5/ and it releases with a rig ticket wipe per [[rig-tickets-disposable]].

**PR 5 landed (2026-09-21):** #726 "Escalated is a sum" → main 62574ae8, released to the rig with the first ticket wipe (`deploy/rig/wipe-tickets.sql`; migration 008 refuses a non-empty journal). Decision semantics is 6 alone; the corrections for 1–5, the frozen fixtures and the vocabulary map are gone, so no lift for old rows exists anywhere any more. Effort dir `pr5/`. Next: PR 6 (import the task contract), the first step that changes what the worker reports.

**PR 6 split and 6a landed (2026-09-21):** PR 6 became 6a "Work fan-out goes" (#728 → main 1e986583; migration 009 with the wipe; work fan-out was N identical work tasks on one brief, never used on the rig, Geoff: "yes that can leave") and 6b "Structured task identity" (`task.qnt` copied verbatim, `TaskIdentity` replaces id+kind, cycle counter, placeholder evaluation identity until PR 7, identity columns on `execution_request_task`, migration 010 with the wipe). Decisions and 6b's four briefs in `pr6/GOAL.md` and `pr6/tasks/6b/`. Neither half moves the worker or the fabric: the worker never names a task and the wire kinds `Work`/`Evaluation` stay. The four opaque refs (`TaskDefinition`) moved to PR 8.

**PR 6b landed (2026-09-21):** #729 "Structured task identity" → main e9a6136e, migration 010 with the wipe. Decisions that moved during the build: `generation` is counted per stage run off the record (not a constant), the existing `execution_request_task.stage` became the package's positive key (no second column), and the explicit-task requirement source left the model with the interpreter. Console lesson: program runs are cut at the lowest stage, never grouped by generation, because generations count per stage. Next: PR 7 (evaluation protocol) per SPIKE.md.

**PR splitting (Geoff, 2026-09-22):** "we can definitely split up 7 if it makes
sense. but it was 8 that i was thinking might benefit from it". So PR 7's
survey carries a Split section and the cut is decided on its evidence; PR 8's
survey brief must carry a Split section as its deliverable (commands / refusals
/ events-with-wipe / Update-while-Pending / opaque ReleasedTicket / evolve
owes-it). Candidate cuts are listed in SPIKE.md "PR 8 split".

**PR 7 split (2026-09-22):** 7a "The program is a plan" (keyed evaluators,
migration 011 + wipe, branch `model/evaluator-keys`) then 7b "The evaluation
instance" (migration 012 + wipe, branch `model/evaluation-instance`). Decisions
and progress in `chuggy-effort/ticket-language/pr7/GOAL.md`; survey in
`pr7/survey.md`. Neither couples to the worker or the fabric; the manifest's
`Pass|Fail` stays and is mapped at the adapter.

**7a landed** #730 → main f8d6c8fd (2026-09-22), migration 011 with the wipe. Opus was overloaded (529/500) for hours that night; A and B were rebuilt on fable, C on sonnet, reviewers on opus once it returned. Facts for 7b's 012: `decision_event_is_valid` is reached only from the `Decide` command arm (a release travels as `ReleaseDraft`), so a `CreateTicket` arm's only coverage is the migration suite's literals; a `CreateTicket` omitting `prog` or `deps` is admitted at 010/011 (`jsonb_typeof` of an absent key is NULL, a NULL IF falls through; `nativeReads.test.ts:104` builds that shape) — fix with `IS DISTINCT FROM 'array'` in 012.

**7b landed (2026-09-22):** #731 → main aaaff1ec, migration 012 with the wipe, rig sanity ticket Done. The package's `evaluation.qnt` sits at `model/ticket-domain/evaluation/evaluation.qnt` with six divergences (four decided, two forced) listed in `model/AGENTS.md`; `TaskDone{ticket, task, report, onFailure}` is the one completion, the disposition stamped by the writer at serialization (the scheduler holds neither the cap nor the ticket, so it cannot cross the door as a parameter); `spawned` is a slot counter (generation × roster per run) so the mint bumps by the roster; an exhausted retry submits `ProcessFailed`, on the execution row's roster since 012's one DDL; a durable unreadable source at a rework spawn parks as `EvaluationFailureEscalated` carrying the git evidence (deferring it wedged the project's writer within the hour — round 1 machine). Rig: `ManualDispatch` takes the dispatch-view's `ticketVersion` (the released ticket's head sequence), not 1; the park/resume was seen live (deleting an evaluator pod on three attempts ~2 min apart exhausts the budget → `ProcessFailed` → `EvaluationBlockedEscalated`; `ResumeTicket` re-asks only it at generation 2; Done). Next: PR 8 survey with the Split section.

**PR 8 split (2026-09-22).** Survey `pr8/survey.md`; three PRs in a forced order: 8a "The released ticket" (`ReleasedTicket` on `Ticket.definition`, `Ticket.source` set by the dispatch and replaced by the accepted source, no spawn but the dispatch observes; every ref minted by the release from stored digests, none authored, so the wire and console hold; `ticket_definition` and `ticket_source` tables; the copy goes verbatim; migration 013 with the wipe), 8b "Events and obligations" (journal carries `TicketEvent`, `evolve`, `project_continuation` deleted, 014 with the wipe, zero worker pods before the wipe), 8c "Commands, refusals and Update" (no wipe). Decisions in `pr8/GOAL.md`. **8a landed #732 (+ #733 test-race fix, main 02bd9572) and released with the wipe 2026-09-22 (013 applied, sanity ticket Done; the wipe before a migration that creates a table the wipe names must use the previous release's script). **Paused 2026-09-22 ~16:45Z before 8b; resume from `pr8/HANDOFF-2026-09-22.md`, which holds the draft 8b decisions.**, 2026-09-22** (D sharpened decision 3: the accepted work result is the report's reference, never derived from the cycle; the reserved source path is near-unreachable since a release refuses a brief without a repository); release with the wipe in progress. Next: 8b brief (carry the transient-deferral wedge shape in).
