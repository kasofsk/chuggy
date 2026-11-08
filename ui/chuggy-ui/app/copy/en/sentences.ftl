## The wire's codes in the console's older voice, as the sentences the pages
## not yet moved to the ledger's labels read.

## Which wall a ticket hit, and what an open native action asks.

sentences-escalation-work-failure = { -work-stage(case: "upper") } failed or did not finish
sentences-escalation-evaluation-failure = Out of { -rework }
# spells -run: to run is a verb here
sentences-escalation-work-unavailable = { -work-stage(case: "upper") } could not be run
# spells -run: to run is a verb here
sentences-escalation-evaluation-blocked = { -evaluation(case: "upper") } could not run or finish
# spells -run: to run is a verb here
sentences-escalation-landing-unavailable = { -landing(case: "upper") } could not run
sentences-native-escalation = { -escalation }
sentences-native-approval = awaiting your { -approval }

## What the actor did with a submission.

sentences-state-pending = Not decided yet
sentences-state-succeeded = Accepted
sentences-state-refused = Refused
sentences-state-answered = Closed without a decision
sentences-state-cancelled = Cancelled before a decision

## Why the machine declined a command, naming what it declined over.

sentences-tickets-none = no { -ticket }
sentences-tickets-one = { $last }
sentences-tickets-many = { $named } and { $last }
sentences-task-work = { -cycle } { $cycle } { -work-stage }
sentences-task-evaluation = { -cycle } { $cycle } { -stage } { $stage }
sentences-refusal-ticket-exists = { $ticket } already exists · Nothing to { -release }
sentences-refusal-dependencies-not-found = { $ticket } depends on missing { $dependencies }
sentences-refusal-dependencies-revoked = { $ticket } depends on { -revoke(form: "ed") } { $dependencies } · Pick open ones
# spells -cycle: a loop of dependencies, not a work cycle
sentences-refusal-dependency-cycle = { $ticket } cannot depend on { $dependencies } · Would form a cycle
sentences-refusal-self-dependency = { $ticket } depends on itself · Remove that { -dependency }
sentences-refusal-ticket-not-found = No { -ticket } { $ticket }
sentences-refusal-ticket-not-pending = { $ticket } is no longer pending
sentences-refusal-ticket-mismatch = Not the same { -ticket } as { $ticket }
sentences-refusal-revision-stale = { $ticket } moved from { -revision } { $expected } to { -revision } { $current }
sentences-refusal-dependencies-incomplete = { $ticket } waits on { $dependencies } · Not done yet
sentences-refusal-not-revocable = { $ticket } can no longer be { -revoke(form: "ed") }
sentences-refusal-not-resumable = { $ticket } has nothing to resume
sentences-refusal-task-not-current = Report for { $task } of { $ticket } · Not current
sentences-refusal-evaluation-not-current = { -evaluation(case: "upper") } of { -cycle } { $cycle } of { $ticket } · Not current
sentences-refusal-landing-not-current = { -landing(case: "upper") } result for { -cycle } { $cycle } of { $ticket } · Not current

## Why the actor declined a submitted mutation, and what to do about it.

sentences-refusal-authoring-changed = { -draft(case: "upper") } changed since submit
# spells -run: to run is a verb here
sentences-refusal-configuration-invalid = { -configuration(case: "upper") } or { -override(form: "plural") } cannot run
sentences-refusal-ticket-changed = { -ticket(case: "upper") } changed since submit
sentences-refusal-selection-changed = { -dispatch(case: "upper") } selection out of date
sentences-refusal-source-unreadable = Start branch or commit not on the remote
sentences-refusal-source-denied = Remote refused this { -project }'s credential
sentences-refusal-brief-no-repository = { -brief(case: "upper") } names no { -repository } · Name a bound one
sentences-refusal-brief-checks-uncommanded = No { -brief-check } { -stage } · Drop the { -brief }'s { -brief-check(form: "plural") }
sentences-refusal-configuration-elsewhere = { -configuration(case: "upper") } not from the { -brief }'s { -repository }
sentences-refusal-selection-unknown = { -workload(case: "upper") }, plan or { -landing } not in the { -catalog }
sentences-refusal-selection-unsupported = Selection needs a version 2 { -configuration }
sentences-refusal-program-exceeds-plan = Program goes past the plan's { -stage(form: "plural") }
sentences-refusal-program-skips-checks = Program skips the { -brief }'s { -brief-check(form: "plural") } · Restore them
sentences-refusal-overrides-unsupported = { -override(case: "upper", form: "plural") } do not fit this { -configuration }
sentences-refusal-overrides-unknown = { -override(case: "upper", form: "plural") } name an unknown { -workload } or prompt
sentences-refusal-capacity-reached = { -project(case: "upper") } full · Finish or { -revoke } { -ticket(form: "a") }
sentences-refusal-landing-request-closed = { -landing(case: "upper") } request closed · { -ticket(case: "upper") } still waiting
sentences-refusal-overrides-move-definition = Only start settings can change while { -escalation }

## Why a ticket following its configuration stays on the revision it holds.

sentences-following-held = Stays on this { -revision } · { $refusal }
sentences-following-trimmed = Stays on this { -revision } · Program skips part of its plan

## Why the boundary would not carry a request, or asked for it again.

sentences-mutation-key-used = Clashes with an earlier submit
sentences-mutation-invalid = Request not valid
sentences-mutation-not-admitted = { -project(case: "upper") } not taking this right now
sentences-mutation-decided = Already decided · Nothing to cancel
sentences-mutation-skips-evaluations = Partial plan needs an administrator · Use the whole plan
sentences-draft-changed = { -draft(case: "upper") } changed · Submit again
sentences-draft-not-editable = { -draft(case: "upper") } closed · { -ticket(case: "upper") } no longer pending
sentences-draft-deletion-changed = { -draft(case: "upper") } changed · Delete again
sentences-draft-deletion-not-editable = { -draft(case: "upper") } closed
sentences-deferral-dispatch-backlog = { -dispatch(case: "upper") } queue full
sentences-deferral-mailbox-full = { -project(case: "upper") } queue full
sentences-deferral-mailbox-unavailable = { -project(case: "upper") } unreachable
sentences-deferral-unknown = Unknown reason ({ $code })

## Why a submission did not get through.

sentences-failure-signed-out = Signed out · Sign in again
sentences-failure-absent = Not found, or not visible to you
sentences-failure-retryable = Try later · { $deferral }
# The word `failureWords.ts` gives a failed read, which it still spells.
sentences-failure-words = { $word }
sentences-failure-refused = Refused · Unknown reason ({ $code })
