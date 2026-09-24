# Spike: bringing chug-ticket-domain's ticket language into chuggy

Written 2026-09-20 against chuggy main 81e8093a (handoff phases gone) and
chug-ticket-domain 76c95a9 (v0.5.0; the 483b1f67 read was updated 2026-09-20 for
the two commits after it: execution requirements opaque, input bindings
dropped, evolve applies an event only to the state that still owes it). The earlier full swap is PR #670 (dc/chuggernaut-adoption, 926
files, +46k/-380k, unreviewed, parked). This spike is the opposite shape:
chuggy's model stays the model and moves toward the package one PR at a
time, each PR model-led with goldens re-emitted and a schema migration.

## The two vocabularies, layer by layer

Every row below lives in five places in chuggy: `model/measure.qnt` types,
`src/domain/generated` (from `model/api.qnt`), `src/contract/rosters.ts`
(the wire), the schema's CHECK literals (`ticket_projection`,
`native_action`, `project_continuation`, `journal_entry` command JSON,
`finalization_request`), and the console's `codeLabels.ts`/`tones.ts`.
A rename is a migration plus five edits plus a golden re-emit.

### Ticket state

| chuggy | package | note |
|---|---|---|
| `Phase` tag + stored `reason` + stored `resumeAt` | `TicketState` sum, each variant carries its own facts | package applies chuggy's own "derive, don't store" one step further |
| Pending | Pending | same |
| Working | Work(WorkExecution) | rename; payload = the input the cycle ran on |
| Evaluating | Evaluation(EvaluationInstance) | rename; payload = the embedded protocol state |
| Finalizing | Finalization(FinalizationOperation) | rename; payload pins workCycle, generation, input, source |
| Escalated + Reason + Resume | Escalated(Escalation) | resume is derived from the variant (decideResume) |
| Done, Revoked | Done, Revoked | same |
| `Core { tickets }` | `TicketGraph { tickets }` | rename |
| `Ticket { phase, deps, finalizer, artifact, workFanout, reworkPolicy, finalizationPricing, resumePricing, program, tasks, record, spawned, reworkLeft, finalizationLeft, gasLeft, resumeAt, reason, completions }` | `Ticket { definition: ReleasedTicket, revision, workCyclesStarted, state }` | package: authored data is one immutable record; live state is one sum; counters are two ints |

### Escalation

| chuggy `Reason` | package `Escalation` | note |
|---|---|---|
| WorkFailed | WorkFailureEscalated(WorkEscalation{resumeInput, source, evidence}) | 1:1 |
| ExecutionPolicyDenied, TicketConfigIncompatible, ExecutionProfileUnavailable, RuntimeVersionUnsupported, RequiredCapabilityUnavailable | WorkExecutionUnavailableEscalated(WorkEscalation) | five walls fold into one; which one becomes evidence |
| ReworkBudgetExhausted | EvaluationFailureEscalated({evidence, source}) | chuggy reaches it by budget; package by a policy callback (`EvaluationFailurePolicy`) |
| (folded into Failed: "the job pays" for evaluator crashes) | EvaluationBlockedEscalated(EvaluationInstance) | package keeps evaluator infra death distinct and resumable at a new generation without re-running passed evaluators |
| (none; a hold sits silently in Finalizing) | FinalizationUnavailableEscalated({finalization, evidence}) | the 2026-09-16 second half, still unstarted |
| FinalizationBudgetExhausted | none | package: NeedsWork reworks unboundedly |
| GasExhausted | none | package has no gas |
| DependencyRevoked | none | package strands dependents in Pending (scenario pins it) |

Resume: chuggy stores `ResumeWorking | ResumeReworking | ResumeEvaluating |
ResumeFinalizing`; package derives it: WorkFailure/WorkExecutionUnavailable
→ TicketWorkResumed (new cycle, same input), EvaluationFailure →
TicketWorkResumed (rework input with the failed evaluators' result refs),
EvaluationBlocked → TicketEvaluationResumed (same stage, generation+1),
FinalizationUnavailable → TicketFinalizationResumed (generation+1, same
pinned input). `ResumeReworking` is the EvaluationFailure resume by another
name.

### Finalization

| chuggy | package |
|---|---|
| `Finalizer = NoFinalizer \| ManagedFinalizer` | none; every ticket finalizes; `finalizationConfiguration` is an opaque ref |
| `FinalizationOutcome = FinalizationSucceeded \| FinalizationFailed` | `FinalizationResult = FinalizationSucceeded(ev) \| FinalizationNeedsWork(ev) \| FinalizationResultUnavailable(ev)` |
| FinalizationFailed re-enters Working, priced | NeedsWork re-enters Work with evidence, unpriced; Unavailable escalates |
| `FinalizationPricing = Budgeted(n) \| DeadlineOnly` | none |

### Tasks and evaluation

| chuggy | package |
|---|---|
| `Task { id (ticket-sequential), kind: Work \| Evaluation(stage), state: Outstanding \| Resolved(Passed \| Failed \| Cancelled) }` | `TaskIdentity = WorkTask{ticket, cycle} \| EvaluationTask{ticket, workCycle, stage, generation, evaluator}`; no stored task set, the live obligation is derived from state |
| `Stage { fanout, combinator: UnanimousPass \| AnyPass }` | `StageDefinition { key, evaluators: [{ key, task: TaskDefinition }] }`; unanimous only |
| `Verdict = Pass \| Fail` | `EvaluationVerdict = EvaluatorPass \| EvaluatorFail` |
| `record: List[Task]` retained history | `EvaluationState` keeps `completedStages: List[StageRun]` with per-evaluator status |
| duplicate completion absorbed by id | report refused unless its whole obligation equals the current one (`TaskNotCurrent`); v0.5.0: `evolve` too applies an evaluation or finalization event only when the state still owes it (`reportAdmissible`, `finalizationCurrent`), so a mispaired event leaves the graph unchanged |
| `TaskDefinition` is not in the model (execution_requirement.qnt, runner.qnt, capacity.qnt model the fabric side) | `TaskDefinition { workload, inputs, executionRequirements, resultContract }`, four opaque refs (v0.5.0: the requirements reference names whatever the scheduler needs; the contract never reads it) |

### Commands, events, decisions

| chuggy | package |
|---|---|
| `DecisionEvent`: ReleaseTicket, Revoke, Dispatch, TaskDone, WorkReduce, EvalReduce, FinalizationResult, ExecutionBlocked, ResumeTicket | `TicketCommand`: CreateTicket, UpdateTicket, DispatchTicket, RevokeTicket, ResumeTicket, ReportTaskTerminal(WorkResultReport \| EvaluationResultReport \| TerminalFailureReport), ReportFinalizationResult |
| one event → `Decision { rec: StepRecord{label, transitions, effects: List[str]}, post }`; an ill-timed event is not enabled | one command → `TicketRefused(TicketRefusal)` (13 named refusals) or `TicketDecided({ event: TicketEvent (18 variants), obligations })` |
| effects are strings: SpawnWorkTasks, SpawnEvalTasks, RunFinalizer, CancelTicketWork, OpenHumanTask | `Obligation = ExecuteTask \| FinalizeTicket \| CancelTask`; the desk is implied by Escalated |
| reduce is a separate step (TaskDone then WorkReduce/EvalReduce) | the terminal report's decision reduces |
| release only; deps immutable | Create, then Update with `expectedRevision` while Pending; deps immutable across updates |

## What is language, what is machine

Three tiers, cheapest first. Each tier is a PR (or two) in the shape of
the handoff removal: model first, goldens re-emitted, generated types,
domain, rosters, migration, console, fresh review, mutation sweep.

### Tier 1: renames (no semantic change, one migration each)

- Phases: Working→Work, Evaluating→Evaluation, Finalizing→Finalization.
- FinalizationFailed→FinalizationNeedsWork; Core→TicketGraph;
  ReleaseTicket→CreateTicket; Verdict Pass/Fail→EvaluatorPass/EvaluatorFail;
  Stage→StageDefinition; Combinator stays until tier 3 decides AnyPass.
- Reason literals → package escalation names where 1:1: WorkFailed→
  WorkFailureEscalated, ReworkBudgetExhausted→EvaluationFailureEscalated,
  the five execution walls→WorkExecutionUnavailableEscalated (the old name
  survives as evidence, not as a reason). GasExhausted,
  FinalizationBudgetExhausted, DependencyRevoked keep chuggy names until
  tier 3 decides their fate.
- Effect strings → obligation names: SpawnWorkTasks/SpawnEvalTasks→
  ExecuteTask, RunFinalizer→FinalizeTicket, CancelTicketWork→CancelTask,
  OpenHumanTask dropped (derived from Escalated, which chuggy already
  proves via hasOpenHumanTask).

Cost: the phase rename alone touches ~11 src files, the console, three
CHECKs plus the journal's command JSON and `native_action`, every golden,
and the rig's rows (a data rewrite in the migration, fine at the rig's
volume). Wire clients break; the console is the only one.

### Tier 2: shape convergence (semantics preserved or already decided)

- Finalization Unavailable → Escalated with a generation (decided
  2026-09-16). Adds `FinalizationResultUnavailable`, the escalation
  variant, `ResumeFinalizing` becomes generation+1.
- Escalated as a sum: `reason` + `resumeAt` columns become one
  `escalation` value; resume derived. Removes `Resume` from the wire
  (the console asks "what does resume do" from the escalation).
- Evaluation keyed by evaluator with generation: `Stage{fanout}` becomes
  `StageDefinition{key, evaluators}`; a blocked stage resumes without
  re-running passes. Evaluator infra death stops being "Failed, the job
  pays" and becomes EvaluationBlocked. This is the one that changes what
  the rework account is charged for.
- Structured task identity and exact-obligation refusal: replaces
  ticket-sequential ids and duplicate absorption. Touches
  `execution_request_task` and what the fabric reports back.
- Refusals as decision results instead of "not enabled": the interpreter
  already has `operationRefusalCodes`; the model gains `TicketRefusal`.
- Opaque refs: `ReleasedTicket{content, workConfiguration, evaluationPlan,
  finalizationConfiguration}` replaces the inline program/pricing fields
  (v0.5.0 dropped inputBindings); execution requirements leave the model
  (execution_requirement.qnt, runner.qnt, capacity.qnt become
  implementation) and `TaskDefinition.executionRequirements` is one opaque
  reference the scheduler resolves.
- Update while Pending with a revision token.

### Tier 3: the forks (things the package does not have)

These are the "stuff we don't really care about" candidates. Each is a
yes/no that changes tier 1's rename list and the measure.

1. Gas (`gasLeft`, GasExhausted). Dropping it drops the termination
   measure's outermost digit; termination becomes "every resume is a human
   act", which is the package's position.
2. Rework budget (`reworkLeft`, ReworkPolicy, ReworkBudgetExhausted,
   ResumeReworking's refill). Package: rework-or-escalate is a per-ticket
   policy callback with no counter.
3. Finalization pricing (`finalizationLeft`, Budgeted/DeadlineOnly,
   FinalizationBudgetExhausted). Package: NeedsWork always reworks.
4. Retry pricing (RetryCharged/RetryFree). Meaningless without gas.
5. NoFinalizer. Package: every ticket finalizes. Keeping it means a
   chuggy-only variant; dropping it means a deploy/report ticket needs a
   trivial finalizer.
6. AnyPass. Package: unanimous only.
7. DependencyRevoked cascade. Package strands dependents Pending; chuggy's
   no-structural-deadlock invariant calls that a defect. Keeping it means
   a chuggy-only Escalation variant `DependencyRevokedEscalated`.
8. The measure itself (`measure.qnt`, 845 lines) and the refinement proof
   (`refinement.qnt`, 764 lines). The measure needs 1–3; the refinement
   needs whatever action vocabulary survives and would be rewritten
   against commands/events either way.

If 1–4 all go, `Ticket` collapses to the package's four fields, the
accounts leave the wire and the console's budget UI, and `measure.qnt`
is deleted rather than rewritten. If any stays, it is a chuggy extension
the package would need to grow to become the shared copy.

## Recommended order

1. Tier 1 rename PR (phases, outcomes, events, obligations, 1:1 reasons)
   with migration 004. Visible everywhere, no semantic risk, and it makes
   every later diff read in the package's words.
2. Finalization Unavailable escalation (already decided).
3. Escalated-as-sum with derived resume.
4. The tier 3 decisions, as one design conversation, then the PRs they
   imply (accounts removal is one PR; NoFinalizer and cascade are each a
   PR; AnyPass is a line).
5. Evaluator-keyed evaluation with generations.
6. Task identity and exact-obligation refusal (needs fabric agreement on
   what a report carries).
7. Opaque refs and the execution-requirement modules leaving the model.
8. Refusals and Update-while-Pending.

Steps 5–8 are where the earlier swap died: they change what the fabric,
the schema and the console exchange, not just what they call it. Each
gets its own goal dir.

## What this spike did not read

Geoff's most recent claude.ai conversation with Dave: no tool here reads
claude.ai chats, so its context is missing. PR #670's branch was read
for layout only (model/application/project-decision-processing/,
src/domain/chuggernaut/ compiled from the package), not for reuse.

## Decisions (interview, 2026-09-20)

1. **Accounts: all four go** (gas, rework budget, finalization pricing,
   retry pricing). Geoff: simplify the model; rework caps stay an
   implementation feature. Where they land: the rework cap is the
   application's `EvaluationFailurePolicy` reading the package's
   `Ticket.workCyclesStarted`; gas and retry pricing have nothing to keep.
   The package's `FinalizationNeedsWork` always reworks; Geoff: no policy
   hook needed, the finalizer itself is responsible for bounding its
   NeedsWork cycles. `measure.qnt` is deleted, not rewritten.
2. **NoFinalizer goes.** Every ticket enters Finalization; "no finalizer"
   is one opaque `finalizationConfiguration` the application interprets by
   reporting Succeeded at once. `Finalizer` leaves the model, the wire,
   the schema and the console's finalizer picker becomes a configuration
   choice.
3. **The DependencyRevoked cascade goes.** A Pending ticket with a Revoked
   dependency is derived in the read model (a predicate over its
   dependencies' states), shown by the console with revoke as the exit.
   `DependencyRevoked` leaves `Reason`; `cascadeSafety` and the
   no-structural-deadlock invariant leave the model.
4. **AnyPass goes.** A stage is its evaluators, unanimous; an advisory
   evaluator is one left out of the stage. `Combinator` leaves the model,
   the authoring roster and the console ledger. No fabric configuration
   authored it.
5. **End state: import the package.** Chuggy's ticket model converges
   until it is textually the package's three modules, then chuggy points
   quint at `@kasofsk/chug-ticket-domain` and deletes its copy. Only the
   runtime proof (`refinement.qnt`, or its successor) stays chuggy's own,
   which the package's README already assigns to the consumer.

## The plan (supersedes "Recommended order" above)

Package pinned at 76c95a9 (v0.5.0) for the effort; package changes go
through Dave. Each PR is the handoff-removal shape: model first, goldens
re-emitted, generated types, domain, interpreter, rosters, migration,
console; fresh reviewer; mutation sweep second; full ci.sh at merge.

Because the end state is an import, the target of every PR is a diff
against the package's text. Its three modules import in order of size,
which is also the dependency order: task_contract (92 lines), then
evaluation_protocol (480), then ticket_domain (1309).

| PR | What | Migration | Notes |
|---|---|---|---|
| 1 | **Accounts go.** gasLeft/reworkLeft/finalizationLeft, ReworkPolicy, FinalizationPricing, RetryPricing, GasExhausted, FinalizationBudgetExhausted, ResumeReworking's refill; `measure.qnt` deleted (its type declarations move into domain.qnt); the rework wall stays but is reached by a nondet policy pick on evaluation failure, which the interpreter realizes as a policy over the cycle count | 004: drop three columns, narrow reason/resume CHECKs | wire loses the accounts; console loses the budget UI and the authoring pickers |
| 2 | **Three small deletions.** NoFinalizer (every ticket enters Finalization; the interpreter's "no finalizer" configuration reports Succeeded at once), DependencyRevoked cascade (read model derives "blocked by a revoked dependency"; console offers revoke), AnyPass | 005: narrow reason CHECK; finalizer column if any | `cascadeSafety`, no-structural-deadlock, `hasOpenHumanTask`'s revoke note leave the model |
| 3 | **Rename.** Working/Evaluating/Finalizing → Work/Evaluation/Finalization; TaskKind Work/Evaluation → WorkTask/EvaluationTask (constructor collision, found 2026-09-21); Resume names follow the phases; FinalizationFailed → FinalizationNeedsWork; Core → TicketGraph; ReleaseTicket → CreateTicket; Stage → StageDefinition; reasons WorkFailed → WorkFailureEscalated, ReworkBudgetExhausted → EvaluationFailureEscalated, the five execution walls → WorkExecutionUnavailableEscalated with `execution.blocked_reason` as the evidence, surfaced on the ticket read. Effect strings and Verdict are NOT here: effects are embedded in durable keys and positions and die in PR 8; Verdict is the worker's attested manifest and changes in PR 7 | 006: rewrite the projection, native_action and continuation rows; validators admit both spellings; journal bytes untouched; decision semantics 5 normalises on read | breaks the wire; the console is the only client; fabric-facing task kinds stay `Work`/`Evaluation` |
| 4 | **Finalization Unavailable escalates** with a generation; ResumeFinalizing becomes generation+1 on the same pinned input | 007: outcome literal, finalization_request generation | decided 2026-09-16; the package's shape |
| 5 | **Escalated is a sum.** `reason` + `resume_at` become one escalation value carrying its facts; resume derived by variant; the unreadable-continuation escalation regains its GitEvidence (RemoteDenied vs the rest), which PR 3 left durable nowhere | 008: replace two columns with one JSON-typed column | `Resume` leaves the wire; console asks the escalation what resume does |
| 6 | **Import task_contract.** TaskIdentity (WorkTask{ticket,cycle}, EvaluationTask{...,generation,evaluator}), TaskDefinition with four opaque refs (executionRequirements included), TaskObligation/ValidatedTaskResult/TaskTerminal; a produced report is refused unless its whole obligation equals the current one | 009: execution_request_task carries the structured identity | needs the fabric to report the obligation back; first PR that changes what the worker sends |
| 7 | **Import evaluation_protocol.** Keyed evaluators, StageRun with generation, per-evaluator status, EvaluationBlocked resumes at generation+1 keeping passes; evaluator infra death stops being "Failed, the job pays" | 010 | replaces `program`/`tasks`/`record` on the ticket |
| 8 | **Commands, refusals, events, obligations.** TicketCommand in, DecisionEvent out; TicketRefused(13 refusals) replaces "not enabled"; TicketEvent (18) replaces StepRecord labels; Update while Pending with expectedRevision; ReleasedTicket with opaque content/finalizationConfiguration (no inputBindings since v0.5.0); `evolve` applies an event only to the state that still owes it | 011: journal rows carry commands and events | the interpreter's `operationRefusalCodes` map onto the model's refusals |
| 9 | **Import ticket_domain.** Delete chuggy's copy; quint points at node_modules; `refinement.qnt` rewritten as chuggy's own against the package's decide/evolve; goldens re-aimed at chuggy's remaining invariants plus the package's traces replayed | none | the adoption PR #670 closes |

PRs 1–5 are language and deletion: mechanical, each the size of the
handoff removal or smaller. PRs 6–9 change what the fabric, schema and
console exchange and each gets its own goal dir; #670 is the record of
what goes wrong when they are done at once.

## Package changes

None agreed. A finalizer-rework cap is the finalizer's responsibility
(Geoff 2026-09-20), not a model policy. Package pin 76c95a9 (v0.5.0, updated 2026-09-20; Geoff: the last change);
`codex/opaque-task-boundary` is in flight there.

## Not consulted

PR #670's contents (Geoff: ignore them). The refinement at PR 9 is
chuggy's own rewrite, not that branch's runtime model.

## Out of scope

`execution_requirement.qnt`, `runner.qnt`, `capacity.qnt`: fabric-side
modules the package leaves opaque (`executionRequirements` is one opaque
reference since v0.5.0).
They stay chuggy's own unless a PR above finds one importing ticket
vocabulary.

## Landed

- PR 1 — kasofsk/chuggy#714 (2026-09-20), main 617675bb, migrations 002–004.
- PR 2 — #719 + fix #722 (2026-09-21), main 55de9de6, migration 005; the old cascade rows are a semantics ≤3 correction (`pr2-fix/GOAL.md`).
- PR 3 — #723 (2026-09-21), main e5f7b3d3, migration 006, decision semantics 5; details and rehearsal in `pr3/GOAL.md`.
- PR 3 fix — #724 (2026-09-21), main d126c09a: a retained draft's stored event text is lifted to the current vocabulary (`draft_revision.authoring` was missed; Brief/Provenance and the drafts page answered InvalidRequest on the rig).
- PR 4 — #725 (2026-09-21), main bd63df14, migration 007: a finalization nothing can carry out escalates after a dwell recorded on the request; details in `pr4/GOAL.md`.
- PR 5 #726 "Escalated is a sum" → main 62574ae8 (2026-09-21); released with the first ticket wipe (`deploy/rig/wipe-tickets.sql`, migration 008 on an empty journal). Decision semantics 6 alone; corrections 1–5, fixtures and the vocabulary map deleted. Effort dir `pr5/`.
- PR 6a #728 "Work fan-out goes" → main 1e986583 (2026-09-21); migration 009 with the wipe; the work set is one task, evaluation fan-out untouched. Effort dir `pr6/`; 6b's briefs in `pr6/tasks/6b/`.
- PR 6b #729 "Structured task identity" → main e9a6136e (2026-09-21); migration 010 with the wipe; `task.qnt` copied verbatim, `TaskIdentity` replaces id+kind, cycle counter, generation counted per stage run, identity columns beside the wire integer, the explicit-task requirement source gone. Effort dir `pr6/`.
- PR 7a #730 "The program is a plan" → main f8d6c8fd (2026-09-22); migration 011 with the wipe; `StageDefinition = {key, evaluators: [{key}]}`, the identity's evaluator is the authored key, the wire integer minted by position, stage keys positional by chuggy's rule until 7b. Effort dir `pr7/`.
- PR 7b #731 "The evaluation instance" → main aaaff1ec (2026-09-22); migration 012 with the wipe; `evaluation.qnt` copied at the package's path with six divergences named in `model/AGENTS.md`, `Ticket.evaluations` replaces the record and the live evaluation tasks, one `TaskDone{ticket, task, report, onFailure}`, a stopped evaluator parks and its resume re-asks it alone, `ProcessFailed` on the execution row, the console draws cycle → stage → generation. Effort dir `pr7/`.

## PR 6 split (2026-09-21, after `pr6/survey.md`)

PR 6 lands as two: **6a Work fan-out goes** (deletion; migration 009 with the wipe) and **6b Structured task identity** (the `task.qnt` copy, `TaskIdentity`, cycle counter, placeholder evaluation identity until PR 7, exact-obligation refusal reconstructed at the boundary; migration 010 with the wipe). The four opaque refs move to PR 8 with `ReleasedTicket`. No fabric or worker release: the worker never names a task and the wire task kinds stay. Decisions in `pr6/GOAL.md`.

## PR 8 split (Geoff, 2026-09-22)

PR 8 is the one Geoff expects to benefit from splitting: "it was 8 that i was
thinking might benefit from it". PR 7 may split too if its survey says so. The
PR 8 survey brief must carry a Split section as its deliverable, over at least
these candidate cuts, each with its own migration or none: commands in
(`TicketCommand` at the boundary, interpreter unchanged behind it); refusals
(`TicketRefused`, the interpreter's `operationRefusalCodes` mapped onto the
model's thirteen); events (`TicketEvent` replacing `StepRecord` labels, journal
rows carrying events — the one that needs the wipe); `Update` while Pending
with `expectedRevision`; `ReleasedTicket` with opaque content; `evolve`
applying an event only to the state that still owes it.

## PR 8 split (orchestrator, 2026-09-22)

Survey `pr8/survey.md` (thirteen surprises; `evolve`-owes-it is a conjunct of
the events piece, not a cut). Three PRs, the survey's cut, in its order: **8a
"The released ticket"** (`ReleasedTicket` with `content`, `workConfiguration`,
`evaluationPlan` carrying a task per evaluator, `finalizationConfiguration`;
`source` on the dispatch and `acceptedSourceRef` on the work result; every ref
minted by the release from stored digests, none authored, so the wire holds;
the definition materialized at release and stored, not re-resolved per request;
the copy's six divergences close; migration 013 with the wipe; no console
change), **8b "Events and obligations"** (`TicketEvent` and `evolve`, the
journal row carries the event, `StepRecord`/effect strings/positional pairing
go, `WorkReduce` folds and `project_continuation` is deleted, `onFailure`
leaves the completion; migration 014 with the wipe; zero worker pods before the
wipe), **8c "Commands, refusals and Update"** (`TicketCommand` at the boundary,
`TicketRefused` with the thirteen refusals on the wire and in the console,
`readiness.ts`'s command→event map deleted, `UpdateTicket` with
`expectedRevision`; migration, no wipe). (a) before (b) is forced (an
obligation carries a definition); (c) last needs no wipe. Decisions in
`pr8/GOAL.md`.

**Landed: PR 8a #732 (main 5c15a8b7, migration 013, 2026-09-22)** — A/S/B/D build, round 1 machine + boundary (two equality conjuncts, the door's stage conjunct), sweep APPROVE with six gaps pinned by E; released to the rig with the wipe 2026-09-22 (with the #733 test-race fix, main 02bd9572; sanity ticket Done).
- PR 8b #734 "Events and obligations" → main e78a93ce (2026-09-23); migration 014 with the wipe; `TicketEvent` and `evolve`, the journal row carries the event, the reduce steps gone. Effort dir `pr8/`.
- PR 8c-1 #735 "Commands and refusals" → main b6e5b4fb (2026-09-24); migration 015 with the wipe; `TicketCommand` in, the thirteen refusals on the wire and in the console, reports verbatim.
- PR 8c-2 #736 "Update" → main ccbf0c38 (2026-09-24); migration 016, no wipe; `UpdateTicket`/`TicketUpdated`/`Ticket.revision`, the draft reopens while Pending, a ticket runs and reads what was released. The release wedged the partition on the first update (016 missed the writer's re-pin grant); hotfixed on the rig, then #737 → main f8998a22, migration 017, and the durable suites now decide as the writer's role.

## PR 7 split (orchestrator, 2026-09-22)

Survey `pr7/survey.md`. Two PRs, the survey's cut: **7a "The program is a
plan"** (`StageDefinition = {key, evaluators: [{key}]}`, the identity's
`evaluator` is the authored key, dense-key assumptions fixed, migration 011 with
the wipe, configuration untouched, no release coupling) and **7b "The
evaluation instance"** (`evaluation.qnt` copied with the key-only
`EvaluatorDefinition` and artifact-only `EvaluationInput` divergence named for
PR 8; per-evaluator status; verdict vocabulary mapped at the adapter with the
worker's manifest unchanged; `EvalReduce` folded; `ExecutionBlocked` names a
task; resume at generation+1; the console's run layer collapses; migration 012
with the wipe). Decisions in `pr7/GOAL.md`.
