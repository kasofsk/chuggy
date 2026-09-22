# PR 8 survey — Commands, refusals, events, obligations (chuggy main aaaff1ec, 2026-09-22)

Read-only, against the plan table's PR 8 row, the SPIKE's "PR 8 split", and the package's
`ticket.qnt` at the pin 76c95a9. Paths are repo-relative under `/home/geoff/claude/chuggy`;
package paths under `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/`.

## Surprises

1. **chuggy has no `evolve`, and replay RE-DECIDES.** `storedReplayGraph` folds
   `execDecisionEvent(graph, row.entry.event).post` (`src/actor/journal.ts:66-71`); `storedJournalLegalOn`
   re-checks enablement at every prefix and compares the recorded `rec` (`:84-104`). So "`evolve` applies
   an event only to the state that still owes it" (package `ticket.qnt:337-342,409-415`) **is not a cut**:
   chuggy has the property free today — `decideTaskDone` absorbs by identity through `liveTasks`
   (`model/domain.qnt:432-441`) — and it becomes *mandatory* the moment the journal carries events. A
   conjunct of the events piece, not a piece beside it.
2. **`WorkReduce` maps onto neither a command nor an event, and it owns a table.** A work completion takes
   two entries, `TaskDone` then `WorkReduce` (`model/refinement.qnt:280-287`, `domain.qnt:538-551`), the
   second driven by a `project_continuation` row whose only surviving kind is `ReduceWork`
   (`relations.ts:718-732`, minted `decisionPlan.ts:395-405`, read `readiness.ts:455-475`). The package
   reduces inside the report's own decision (`ticket.qnt:625-656`). Folding it deletes the table, its fence
   (`projectWriter.ts:273-290`), the `Continuation` input class and its aging term — 7b's `EvalReduce`
   fold, one table larger.
3. **The execution source is observed AFTER the decision, by running the decider twice.**
   `projectWriterExecutionSource` calls `execDecisionEvent(...).rec` speculatively, finds a spawn label,
   reads the ticket off `rec.transitions[rec.effects.indexOf(spawn)]`, then probes the remote
   (`projectWriter.ts:503-536`). The package makes the source a **command field** —
   `DispatchTicket({ticket, source})` (`ticket.qnt:102`) — carried into `WorkExecution.source`,
   `WorkEscalation.source` and `EvaluationInput.acceptedSourceRef`. Moving it deletes the speculative
   re-decide and rewrites the unreadable-source landing task E built yesterday
   (`pr7/tasks/7b/E-report.md` §1b): a source nobody can read stops being a park on a re-taken edge and
   becomes a refusal before any decision exists.
4. **Both names PR 8 needs are taken, by different things.** `src/interpreter/ticketCommand.ts:121-154`
   declares `TicketCommand` as the *boundary envelope* (`Decide | ResolveNativeAction | ReleaseDraft |
   ManualDispatch | ProposeDispatch` plus two boundary-only arms), carrying fences the package has no
   counterpart for; `src/actor/obligations.ts:33-40` declares `Obligation` as a refinement predicate over
   `ActorState`.
5. **Today's `Decide` already carries the EVENT, and the adapter does the command→event mapping the package
   puts inside `decide`.** `src/adapters/postgres/readiness.ts` builds a `resolvedEvent` per command:
   `ReleaseDraft` → `CreateTicket` from `draft_revision.authoring` (`:192`), `ManualDispatch` and
   `ProposeDispatch` → the same `{type:"Dispatch"}` (`:449`), a native-action answer → its event (`:388`),
   the finalizer's submission → `FinalizationResult` (`:318`). That map lives in the postgres adapter,
   below the layer rule that says a decider decides.
6. **Nine conditions collapse into one word, and no refusal carries evidence.** `NotEnabled` is the whole
   domain refusal vocabulary (`projectWriter.ts:449,462-467`); `RefusalCode` is a bare string union
   (`projectDecision.ts:71-79`) whose row adds only a position (`relations.ts:91-93`), with **no CHECK
   enumerating the codes** (`:97-102`). `DependenciesNotFound`'s missing set and `DependenciesIncomplete`'s
   are each computed and thrown away (`src/actor/decisionEvent.ts:171,177`). `SelfDependency` and
   `TicketDependenciesChanged` have no site anywhere.
7. **There is no post-release authoring path, and no ticket revision.** `revise_draft` answers `NotDraft`
   once `draft.state='Released'` (`baseline/functions.ts:3245`) and release is what sets it;
   `ticket_projection.seq` and `expectedTicketVersion` are journal positions, not author revisions
   (`relations.ts:280`, `ticketCommand.ts:141-154`). `UpdateTicket` renames nothing — it is a new surface.
   The console has no drafts page, no draft page, and `apiReviseDraft`
   (`ui/chuggy-ui/app/core/apiRoutes.ts:927`) has **no call site in the app** (`browser/routes.tsx:165-188`).
8. **A draft's authoring IS an encoded `CreateTicket` event in a column.** `encodeDraftAuthoring` wraps
   `releaseTicketEvent(asTicketId(1), authoring)` through the journal's own codec
   (`src/interpreter/authoring.ts:215-217`) into `draft_revision.authoring`, read back at
   `readiness.ts:194`. Every piece that changes the `CreateTicket` payload changes that text — the
   #723/#724 trap. The wipe empties the table, so no lift is owed; what is owed is the release ordering.
9. **Obligations are per task; chuggy's requests are per spawn.** `ExecuteTask`/`CancelTask` are one
   obligation per task (`ticket.qnt:412-418,461-467`), while chuggy mints ONE `execution_request` naming N
   `execution_request_task` rows under one bundle, one capacity account and one configuration pin
   (`decision.ts:321-343`), keyed `UNIQUE (tenant, project, authorizing_seq, effect_position, kind)`
   (`constraints.ts:111`). Either the position becomes per-task and that unique changes, or the writer
   groups a run's obligations back into one request.
10. **The desk has an effect today and an obligation never.** `OpenHumanTask` is a fifth effect whose
    *position* mints `native_action.action` and fills `native_action.effect_position`, unique per
    `(authorizing_seq, effect_position)` (`decisionPlan.ts:206-215`, `constraints.ts:335`). The package
    emits no obligation for the desk — it is implied by `Escalated` — so the action loses the number its
    unique index is built on.
11. **Five durable identities are `"<seq>:<position>:<effect word>"`, and one leaves the database.**
    `identity()` (`decisionPlan.ts:52-54`) composes `execution_request.request`, `input_bundle.bundle`,
    `finalization_request.request`, `native_action.action` and `project_continuation.continuation`. None is
    ever parsed back, so a new kind word is a format change and not a parse change — but
    `"6:0:SpawnEvaluation"` also travels as a pod annotation and inside `CHUG_WORKER_TASK`
    (`workerPod.ts:260,300-302,408`).
12. **The `effects[i]` ↔ `transitions[i]` pairing is load-bearing and stated nowhere.** `subject()` reads
    the ticket off `rec.transitions[effectPosition]` (`decisionPlan.ts:56-64`) and `projectWriter.ts:521`
    off `rec.effects.indexOf(spawn)`. An obligation carries its own ticket, so both reads go — and with
    them the only reason `StepRecord` carries transitions outside the golden traces.
13. **Two dead literals are already standing, from PRs 1, 2 and 7b.**
    `operation_completion_authority_is_its_boundary` still switches on `'ExecutionBlocked'`
    (`constraints.ts:187-193`), a tag 7b deleted and no migration dropped; 012's `CreateTicket` arm still
    spends three conditions refusing `workFanout`, a non-`ManagedFinalizer` `finalizer` and a
    non-`UnanimousPass` `combinator` (`012-task-report.ts:203-227`) for shapes PRs 1 and 2 removed.
    (`journal_entry_release_ticket` is *not* dead — 006 rebuilt it over both tags,
    `006-rename.ts:409-418`.)

## 1. The model today against the package's command surface

`DecisionEvent` has seven arms after 7b (`model/refinement.qnt:280-287`): `CreateTicket{ticket, deps,
prog}`, `Revoke(int)`, `Dispatch(int)`, `TaskDone{ticket, task, report, onFailure}`, `WorkReduce(int)`,
`FinalizationResult{ticket, out}`, `ResumeTicket(int)`. `execDecisionEvent` routes them onto the deciders,
`decisionEventEnabled` returns a bare bool (`:312-353`; TS mirror `src/actor/decisionEvent.ts:125-206`),
and a decider returns `Decision = {rec: StepRecord{label, transitions, effects: List[str]}, post}`
(`model/ticket.qnt:398-410`) — it decides *and* evolves in one step.

**One to one onto a command:** `CreateTicket`→`CreateTicket` (payload grows, §5), `Revoke`→`RevokeTicket`,
`Dispatch`→`DispatchTicket` (gains `source`, surprise 3), `ResumeTicket`→`ResumeTicket`,
`TaskDone`→`ReportTaskTerminal` (loses `onFailure`), `FinalizationResult`→`ReportFinalizationResult`. Six
of seven; `UpdateTicket` is new (§4).

**One to one onto an event: none**, because chuggy's arms *are* commands. Its events are `StepRecord.label`
strings (`src/domain/deciders.ts:143,176,201,236,314,318,364,378,453,480,488`), and the mapping is not a
rename in either direction: `task-done` + `work-passed` → **one** `TicketWorkResultAccepted`, `task-done` +
`ticket-escalated work_failure_escalated` → **one** `TicketWorkProcessFailed` (surprise 2);
`ticket-resumed` splits **three** ways by the resume its wall implies (`model/ticket.qnt:262-273`, package
`:558-595`); `TicketUpdated` has no counterpart. **No counterpart either way:** `WorkReduce`, and
`ResumeTicket`'s four resume kinds, which the package derives from the escalation variant.

**`onFailure` leaves the command and reappears in the event.** It rides every completion today because
replay must not re-draw it (`refinement.qnt:265-279`), the writer stamping it at serialization
(`projectWriter.ts:396-416`). The package puts the pick in `decide`'s `EvaluationFailurePolicy` and records
the edge taken in the *event* — `TicketEvaluationReworkStarted` versus `TicketEvaluationFailureEscalated`
(`ticket.qnt:699-721`). So the events piece is what lets `onFailure` stop riding every completion; the
commands piece cannot drop it alone.

## 2. Refusals

`operationRefusalCodes` is nine (`src/contract/rosters.ts:232-242`); the writer's `RefusalCode` is eight
(`projectDecision.ts:71-79`), `CommandUnreadable` having no producer left. **No refusal is decided before
the writer**: the door's rejections are a disjoint roster (`Accepted | Original | IdempotencyConflict |
InvalidCommand | Backpressure | Unavailable | NotAdmitted`, `operationInbox.ts:279-289`, HTTP
`outcomes.ts:262-284`), and every stored refusal is post-replay — `NotEnabled`, `TicketChanged`,
`SelectionChanged` and the two source codes in `projectWriter.ts`; `AuthoringChanged`,
`ConfigurationInvalid`, `BriefNamesNoRepository` inside the settling transaction
(`decision.ts:525,556-564`).

Ten of the thirteen conditions are decided somewhere, nine arriving as `NotEnabled` (`canReleaseIn`,
`dependableIn`, `revocablesIn`, `readiesIn`→`depsDoneIn`, `retryablesIn`,
`completableIn`+`outstandingTaskIn`, `finalizableIn`+`finalizationOutcomeEnabled`, `reportMatchesTask` —
`src/domain/enablement.ts:29,38,60,72,86,90,94,105,122,135,139,161`). `TicketRevisionStale` is split across
three codes carrying no numbers; `TicketNotPending` exists only as the draft door's `NotDraft`;
`FinalizationNotCurrent` checks the phase alone and never the cycle or generation
(`enablement.ts:135-150`), the real fence being `submit_finalization_result`'s `BindingMismatch`
(`baseline/functions.ts:3717-3737`).

**The door loses nothing by the move, and must keep four classes of check.** `decision_event_is_valid`
(head `012-task-report.ts:145-250`) reads no rows — shape and typing only, so every check survives.
`public_ticket_command_is_valid` (`006-rename.ts:192-216`) and `ticket_command_is_valid`
(`007-finalization-unavailable.ts:162-191`) hold two *authorization-by-shape* exclusions (no public
`Decide` may carry `CreateTicket` or `FinalizationResult`), which are not refusals and must not become
ones. `accept_operation` (`003-no-handoff.ts:70-220`) holds idempotency (`Original` vs
`IdempotencyConflict`), row-existence authorization for `ResolveNativeAction` and `ReleaseDraft`, mailbox
depth and lifecycle admission — none expressible over a `TicketGraph`. The move is additive.

## 3. Events and the journal

`journal_entry.entry` is the text of `{seq, event, rec}` (`src/interpreter/wire.ts:51-53`), digest-chained
by `journalEnvelopeDigest` (`digest.ts:59-130`) over a row carrying cause, configuration pin,
`event_schema_version` and `decision_semantics_version` (`relations.ts:614-637`), written only by
`postgresJournalWrite` (`journal.ts:242-283`). Semantics is 6 (`src/actor/decisionSemantics.ts:24-34`) and
gates **replay, not normalisation**: semantics 5's `rowAtCurrentVocabulary` died with the first wipe, and
`wire.ts:16-20` says "Nothing is lifted here".

Carrying an event changes the `entry` text and every digest; `decision_event_is_valid`, which becomes an
*event* validator with eighteen arms where it has five; `postgresJournalDispatchContracts`, which opens the
event JSON for `CreateTicket` (`journal.ts:170-221`); the `journal_entry_release_ticket` predicate
(`006-rename.ts:410-418`); `accept_operation`'s priority classification, which reads the event tag
(`003:122-127`); and `operation.command_tag` with its authority CHECK (`constraints.ts:187-193`). It does
**not** change `ticket_projection`, written from the post graph (`decision.ts:202-213`),
`execution_request_task`'s identity columns, or `execution_result.verdict`. It **deletes**
`project_continuation` whole, `StepRecord`/`Transition`, the five effect strings
(`src/domain/effect.ts:26-44`), and the meaning of `effect_position` on four tables.

**Which pieces need the wipe: two, not one.** Any piece changing the `entry` text does, the chain being
digest-linked and the guard (`012:134-141`) refusing a non-empty journal — the events piece and the
released-ticket piece. Refusals need none (a refused command journals nothing). Commands need none *once
events have landed*, because a command lives in `operation.command`, outside the journal
(`relations.ts:678`, parsed `wire.ts:319-338`). `Update` needs one only if the revision becomes journaled
state. Stored text a vocabulary change must lift, all emptied by `deploy/rig/wipe-tickets.sql`:
`draft_revision.authoring` (surprise 8), `operation.command` and its `payload_digest`,
`selector_proposal_delivery.command` (`relations.ts:1007`), `dispatch_candidate.program` (`:116`, encoded
`dispatchView.ts:90-94`), `execution.requirement_value`, `draft_brief_check.command`.

## 4. Update while Pending

Today: `draft` (state `Draft|Released|Deleted`), append-only `draft_revision`, upserted unversioned
`draft_brief` (`relations.ts:142,189,152`). `revise_draft` bumps `authoring_version` and refuses
`NotDraft`/`Stale` (`functions.ts:3237-3293`); release is `release_draft_fenced` under `FOR UPDATE`
matching state, authoring version, configuration revision **and** digest (`functions.ts:3010-3025`, driven
`decision.ts:511-577`). `authoringVersion` *is* `expectedRevision` — for a draft. Against `UpdateTicket`
the ticket gains `revision: int` bumped by `TicketUpdated`; `TicketNotPending`, `TicketIdentityMismatch`,
`TicketRevisionStale{expected, current}` and `TicketDependenciesChanged` become model refusals; the fence
moves from a row lock over `draft` to a value on the replayed ticket.

**The drafts table survives**, because the package has no state before `CreateTicket` and chuggy's draft
holds a brief, links, checks, a repository binding and a configuration pin the domain never sees (§5). The
honest shape is `draft` keeping *authoring before release* and `UpdateTicket` taking *after* — two editors
of one thing, which is the design question this piece asks. The console makes it cheap: no draft page
exists (surprise 7), the flow is `TicketCreation.tsx` plus `createAndReleaseTicket`
(`core/ticketCreationRun.ts:232-245`) creating and releasing in one submit, and the ticket page reads
authoring off the *draft* (`browser/ticket/ticketPageFacts.ts:68-85`,
`core/ticketLedger.ts:70,245,322,399`).

## 5. ReleasedTicket and the opaque refs

`ReleasedTicket = {id, content, dependencies, workConfiguration: TaskDefinition, evaluationPlan,
finalizationConfiguration}` (`ticket.qnt:56-63`), every ref positive (`releasedTicketValid`, `:256-263`).
chuggy's `CreateTicket` carries `{ticket, deps, prog}`.

| package ref | where its material lives | minted | door check |
|---|---|---|---|
| `content` | `draft_brief.intent` + links/checks; the prompt is *composed* per request (`taskBriefing.ts:899`) and pinned as `input_bundle`/`_digest` (`relations.ts:284-285`) | `decisionPlan.ts:124` | digest re-verified, bundle content-addressed |
| `workConfiguration` | resolved **per request at dispatch** from the configuration pin (`decision.ts:321-334`) into `execution.requirement_*` (`relations.ts:212-215`) | `materializeExecutionRequirement` (`executionRequirement.ts:410`) | `executionRequirementConfigurationIsValid` at release (`authoring.ts:136`) |
| `evaluationPlan` | `Ticket.program`, on the ticket since 7a | release | `decision_event_is_valid`'s `prog` arm |
| `finalizationConfiguration` | `draft_brief.finalization_mode/_target` + the configuration document | draft | `draftReleaseReadiness` |
| `acceptedSourceRef` | `ExecutionSourceObservation` (`executionSource.ts:9-14`) → `execution_result_source` (`relations.ts:346`) | after the decision (surprise 3) | `ExecutionSourceUnreadable`/`Denied` |

The gap is not that the refs are missing — `result_digest_fold` (`functions.ts:3176-3184`) already folds a
digest to a model int — but that **four of the five are resolved after the decision and pinned per request,
where the package freezes them on the ticket at create** (`pr6/survey.md:273-277` said the same and moved
it here). Freezing `workConfiguration` is the one behaviour change: every cycle runs the revision the
release pinned, and the only re-pin becomes `UpdateTicket` — so §5 without §4 leaves a released ticket
unre-pinnable.

The six `model/AGENTS.md` divergences close here: `EvaluatorDefinition.task` and `planValid`'s
`taskDefinitionValid` return with `workConfiguration`'s sibling per evaluator;
`EvaluationInput.acceptedSourceRef` and the `invariant`'s positivity return with the source on the command;
and `currentTaskObligations` yielding identities and `applyProduced` taking a reference revert
**automatically**, both having been forced by the missing definition.

## 6. Obligations and the effects

`SpawnWorkTasks`/`SpawnEvalTasks` → `ExecuteTask(TicketTaskObligation{ticket, task: TaskObligation{task,
definition, contextRef}})`; `RunFinalizer` → `FinalizeTicket({ticket, finalization, configuration})`;
`CancelTicketWork` → `CancelTask({ticket, task})`; `OpenHumanTask` → nothing (surprise 10). Note
`TaskObligation` **carries a `TaskDefinition`**, so an honest `ExecuteTask` is not expressible before §5 —
the wall 7b hit at `currentTaskObligations`.

Every durable key embedding an effect string is in surprise 11; the positions are
`execution_request.effect_position`, `finalization_request.effect_position`,
`project_continuation.effect_position` and `native_action.effect_position`, three inside UNIQUE constraints
(`constraints.ts:111,161,205,335`) and one a **binding coordinate across the door**:
`submit_task_completion` refuses a completion whose `bound.effect_position <> in_source_effect`
(`012:289`). An obligation list is still a list, so the position survives as the obligation's index — but
the kind word changes in five identities, the desk's obligation disappears (so `native_action` needs a
position from elsewhere, or its unique becomes `(authorizing_seq, ticket)`), and surprise 9 decides whether
`execution_request`'s unique still holds. `execution_request.kind`'s CHECK (`relations.ts:291`),
`spawnRequestKinds` (`projectDecision.ts:159-162`) and the four scheduler filters naming
`'SpawnWork','SpawnEvaluation'` (`executionSchedulerRun.ts:225`, `scheduler.ts:191-193,592`,
`evaluationReports.ts:90`, `executionSourceHistory.ts:27`) follow.

## 7. Wire, console and sizing

Exposed: `publicMutationSchema` (`src/contract/requests.ts:41-79`) — six mutations, of which
`RevokeTicket` and `ResumeTicket` carry a domain event today and would carry a command; the operation
response's `code: z.enum(operationRefusalCodes)` (`responses.ts:669-675`), **strict**, so a refusal with a
payload is a schema change; `ticketResponseSchema` (`:220-252`), carrying no authoring, program,
dependencies or revision; `draftResponseSchema` (`:812`), carrying all of them.

Per piece: **refusals** change the roster and force `operationRefusalLabel`/`operationRefusalSentence`
(`ui/chuggy-ui/app/core/codeLabels.ts:453-473`, `codeSentences.ts:69-91`) — exhaustive switches, so the
roster is a compile error until the console answers; a reader stops being told "the machine does not accept
that here" and is told which dependency is not done. **Events** change nothing a reader sees: the console
reads projections and executions, never the journal. **The released ticket** changes what a release body
carries and what a draft read shows. **Update** gives the ticket page an edit offer it has never had
(`core/ticketActions.ts:59`, `core/ticketOffers.ts:27`) and moves `TicketProvenance.tsx:85-140` off the
draft read.

48 files name `DecisionEvent` (model 4 · src 18 · test 26 · ui 0); 77 name `StepRecord` or an effect string
(model 6 · src 28 · test 41 · ui 2); 22 name `WorkReduce` or `ReduceWork`. Twelve goldens re-emitted per
piece that moves the model; `src/generated/model-api.ts` gains a codec per new `Api*` alias
(`model/api.qnt:15-53`).

## Split

Six changes wear this hat. Surprise 1 removes one of Geoff's six candidates (`evolve`-owes-it is a
conjunct, not a cut), and surprise 9 plus §5's last paragraph order the rest.

**(a) The released ticket.** `ReleasedTicket` with `content`, `workConfiguration`, `evaluationPlan`,
`finalizationConfiguration`; `source` on `DispatchTicket` and `acceptedSourceRef` on the work result; the
definition stops being resolved per request; the six `model/AGENTS.md` divergences close. **Migration +
wipe. Worker/fabric:** no — the briefing is still composed server-side and the manifest is untouched.

**(b) Events and obligations.** `TicketEvent` and `evolve`; the journal row carries the event;
`reportAdmissible`/`finalizationCurrent` arrive with it; `StepRecord`, the effect strings and the
positional pairing go; `WorkReduce` folds and `project_continuation` is deleted; `onFailure` leaves the
completion. Needs (a), because `ExecuteTask` carries a `TaskDefinition`. **Migration + wipe.
Worker/fabric:** no, but the request-identity kind words change (surprise 11).

**(c) Commands, refusals and Update.** `TicketCommand` at the boundary (the interpreter's own type
renamed), `decide` returning `TicketRefused`, the thirteen refusals on the wire and in the console,
`readiness.ts`'s command→event map deleted, `UpdateTicket` with `expectedRevision`, and the draft/ticket
authoring split §4 names. Needs (b), because a command's answer is an event. **Migration, no wipe** if the
revision rides the projection; wipe if it becomes journaled state. **Worker/fabric:** no.

**Recommended cut: three PRs — (a), then (b), then (c).** They fail differently. (a) fails by a task
running on the wrong material, and its reviewer reads authoring, the configuration pin and dispatch. (b)
fails by a decision's durable consequences landing wrong, twice, or not at all, and its reviewer reads the
journal, replay and the materialization. (c) fails by a principal being refused wrongly or told nothing
useful, and its reviewer reads the door, the wire and the console's words. Each is roughly 7b's size; none
is two of those failure modes in one sweep.

The order is forced in one place and chosen in the other. **(a) before (b) is forced**: obligations cannot
take the package's shape without a definition to put in them, and taking (b) first would invent a seventh
divergence and delete it a PR later — what PR 7's survey refused to do. **(c) last is a choice**, because
it is the only piece needing no wipe once (b) has landed (§3): the journal already carries events, a
command lives in `operation.command`, and a revision on the projection is one nullable column. Two wipes,
three releases.

**What one PR would cost.** The whole `CreateTicket` payload, the eighteen events, `evolve`, the obligation
vocabulary, five durable identity formats, four `effect_position` meanings, a deleted table, thirteen
refusals, a new authoring surface and the console's copy, in one diff across ~120 files with two
vocabularies live at once. It saves one wipe and two release cycles. It costs the sweep its grain — the
same argument PR 7's survey made and the same one #670 records: a sweep cannot red-proof one term at a time
over a diff where the journal's contents, the journal's *meaning* and the door's answers all moved, and a
guard that still passes because what it guards was renamed underneath it is the guards-fail-open signature
exactly.

**If two is the budget**, fold (c) into (b): both are the writer's vocabulary and (c) adds no wipe to (b)'s.
Do **not** fold (a) into (b) — that is the pair whose failure modes are furthest apart and whose ordering
is forced.

## Release coupling

**(a) has one coupling, and it is the sharp one.** The configuration is where `workConfiguration` and
`finalizationConfiguration` come from, so freezing them at release means the released commit's
configuration must already hold what the release reads. The wipe keeps `configuration_revision` rows and
the importer re-imports after the migration, so a configuration read between the two answers on the old
shape — the #724 trap `pr7/survey.md`'s 7a paragraph describes. Make every new ref **optional at the wire
and defaulted at release** (7a's treatment of `evaluators`) and the kept revisions stay parseable and the
drafts page readable; required instead, the release grows a re-import before the sanity ticket. No worker
or fabric move: the pod is handed a server-composed briefing (`workerPod.ts:295-299`) and names no
configuration.

**(b) has one coupling nothing else has: a pod outlives the migration.** `"6:0:SpawnEvaluation"` is in the
annotations and `CHUG_WORKER_TASK` of every running pod (surprise 11), and `submit_task_completion` binds
on `effect_position` (`012:289`). Nothing parses the string, so a new pod under the new format is fine —
but a pod placed before the migration completes against rows the wipe removed. The existing order handles
this (importer suspended, seven deployments to 0, wipe, migrate, roll, per `pr7/GOAL.md`'s release log);
the one addition is confirming zero running worker *pods* before the wipe, not only zero deployments.

**(c) has none.** The door's signatures do not move (`submit_task_completion` and
`submit_finalization_result` keep their argument lists; a refusal is a column value and `decision_input`
has no CHECK on `outcome_code`, `relations.ts:97-102`), the console is the only wire client, and no worker
or fabric object names a refusal. It releases as PRs 1–7 did, minus the wipe.

**The one way to force lockstep across all three** is putting a ticket-language word in the worker's
manifest or in `submit_worker_result`'s arguments. No piece here needs it, as none did in 7a or 7b. Keep it
out.
