## The wire's codes as the short labels a ledger page draws them in: a label is
## a noun, a status one or two words.

## Which wall a ticket hit, by its escalation's kind.

codes-escalation-work-failure = { -work-stage(case: "upper") } failed
codes-escalation-evaluation-failure = { -rework-budget(case: "upper") } exhausted
codes-escalation-work-unavailable = { -run(case: "upper") } unavailable
codes-escalation-evaluation-blocked = { -evaluation(case: "upper") } blocked
codes-escalation-landing-unavailable = { -landing(case: "upper") } unavailable
codes-escalation-lost = Lost on { -runner }

## Which wall the fabric hit.

codes-blocked-policy-denied = { -run(case: "upper") } denied by policy
codes-blocked-configuration-incompatible = { -configuration(case: "upper") } incompatible
codes-blocked-profile-unavailable = No matching { -run } profile
codes-blocked-runtime-unsupported = Runtime version unsupported
# spells -run: to run is a verb here
# spells -work-stage: the work in general
codes-blocked-capability-unavailable = Nowhere to run this work
codes-blocked-memory-unavailable = Too large for every { -runner }
# spells -work-stage: the work in general
codes-blocked-tree-unexpected = Evaluated a different tree than the work produced

## Which git act failed.

codes-git-remote-unreachable = Remote unreachable
codes-git-remote-denied = Remote denied
codes-git-ref-unreadable = Ref unreadable
codes-git-object-missing = Object missing
codes-git-integration-failed = Integration failed
codes-git-promotion-timed-out = Promotion timed out
codes-git-remote-declined = Remote declined
codes-git-workflows-refused = Workflows refused

## Which hold a landing is stuck on.

codes-hold-repository-unbound = { -repository(case: "upper") } unbound
codes-hold-target-unreadable = Target unreadable
codes-hold-base-unreadable = { -pull-request(case: "upper") } base unreadable
codes-hold-base-is-head = { -pull-request(case: "upper") } base at head
codes-hold-denied = { -pull-request(case: "upper") } denied
codes-hold-reconciliation-unreadable = Reconciliation unreadable
codes-hold-evidence-unstorable = { -pull-request(case: "upper") } evidence unstorable
codes-hold-absent = { -pull-request(case: "upper") } absent
codes-hold-unaddressed = { -pull-request(case: "upper") } unaddressed
codes-hold-unavailable = { -pull-request(case: "upper") } unavailable
codes-hold-preparation-restarts-exhausted = Preparation restarts exhausted
codes-hold-creations-exhausted = { -pull-request(case: "upper") } creations exhausted
codes-hold-merges-exhausted = { -pull-request(case: "upper") } merges exhausted
codes-hold-push-declined = Push declined
codes-hold-workflows-refused = Workflow files refused
# spells -brief-check: the forge's checks
codes-hold-queue-checks-failed = Merge queue checks failed again
# spells -brief-check: the forge's checks
codes-hold-queue-timed-out = Merge queue checks timed out again
codes-hold-dequeued = Removed from merge queue
# spells -brief-check: to re-check is to evaluate again
codes-hold-rechecks-exhausted = Re-checks exhausted

## Why a project holds no lead.

codes-lead-absence-not-needed = Opens when { -ticket(form: "a") } is { -release(form: "ed") }
codes-lead-absence-paused = { -lead(case: "upper") } paused
codes-lead-absence-not-granted = { -lead(case: "upper") } not granted this { -project }
codes-lead-absence-awaiting = Opens at the { -lead }'s next pass
codes-lead-absence-unnamed = No { -lead } named for this { -site }
codes-lead-absence-hosted-runs = { -hosted-runs(case: "upper") } not granted
codes-lead-absence-runner-offline = No live { -runner }
codes-lead-absence-usage-paused = Paused for usage

## Where one landing stands.

codes-landing-running = Running
codes-landing-held = Held
codes-landing-waiting = Waiting
codes-landing-failed = Failed
codes-landing-escalated = { -escalation(case: "upper") }
codes-landing-landed = { -landing(case: "upper", form: "ed") }
codes-landing-proposed = Proposed
codes-landing-invalidated = Invalidated

## Why one landing attempt failed.

codes-landing-failure-conflict = Merge conflict
codes-landing-failure-preparation = Preparation failed
# spells -brief-check: the forge's checks
codes-landing-failure-queue-checks = Merge queue checks failed
# spells -brief-check: to re-check is to evaluate again
codes-landing-failure-recheck = Target moved, re-check required

## What a landing's pull request came to, and what the forge says of it.

codes-creation-created = Opened
codes-creation-exists = Already open
codes-creation-contradictory = Contradictory
codes-creation-unstorable = Unstorable
codes-creation-adopted = Adopted
codes-merge-merged = Merged
codes-merge-head-moved = Head moved
codes-merge-not-mergeable = Not mergeable
codes-merge-reason-conflict = Conflict
codes-status-open = Open
codes-status-closed = Closed
codes-status-merged = Merged
codes-status-superseded = Superseded
codes-merge-wait-blocked = Blocked
codes-merge-wait-head-moved = Head moved
codes-merge-wait-queued = In merge queue
codes-mergeability-mergeable = Mergeable
codes-mergeability-conflicting = Conflicting
codes-mergeability-blocked = Blocked
codes-mergeability-behind = Behind its base
codes-mergeability-unknown = Unknown

## The lines beside an escalation.

codes-runner-lost-pool = Lost on { $pool }
codes-runner-lost-owner = Lost on { $owner }'s { -runner }
codes-runner-losses = { $losses ->
    [one] { $losses } loss
   *[other] { $losses } losses
} · { $resumed ->
    [0] none
   *[other] { $resumed }
} resumed automatically
codes-usage-resumes = Resumes automatically
codes-usage-resumes-at = Resumes automatically · { $until }
codes-step-clone-failed = Clone failed
codes-step-setup-failed = Setup failed
codes-step-commit-failed = Commit failed
codes-step-push-failed = Push failed
codes-step-timed-out = Timed out
codes-step-disk-low = Disk low
codes-step-setup-line = Fix it under { -override(case: "upper", form: "plural") } · Setup, then Resume
codes-step-disk-line = Free space on its { -runner }, then Resume
# spells -turn: to turn on is a verb here
codes-evidence-workflows-line = Turn on Workflow files and the App's Workflows, then Resume
# spells -brief-check: to check is a verb here
codes-evidence-declined-line = Check the branch's rules and hooks, then Resume
codes-evidence-unreadable-line = Restore the branch or the App's access, then Resume
codes-stage-failed = { $stage } failed
codes-detail-work-failure = Failed { -work-stage } is not reworked
codes-detail-work-unavailable = { -work-stage(case: "upper") } cancelled
codes-detail-evaluation-blocked = Resume asks it again

## What an open native action asks, and what a revoked dependency leaves.

codes-native-escalation = { -escalation(case: "upper") }
codes-native-approval = Awaiting { -approval }
codes-revoked-dependencies = Blocked by { -revoke(form: "ed") } { $count ->
    [one] { -dependency }
   *[other] { -dependency(form: "plural") }
} { $tickets }

## How a finished ticket lands, and what each choice does.

codes-landing-kind-git-merge = Git merge
codes-landing-kind-pull-request = { -pull-request(case: "upper") }
codes-landing-kind-none = None
# spells -work-stage: the work in general
codes-landing-kind-git-merge-effect = Merges the work into the target branch
codes-landing-kind-pull-request-effect = Opens { -pull-request(form: "a") } a person merges
codes-landing-kind-none-effect = { -landing(case: "upper", form: "s") } nothing
codes-merge-mode-push = Push
codes-merge-mode-pull-request = { -pull-request(case: "upper") }, then merge
codes-merge-mode-push-effect = Commits straight onto the target branch
codes-merge-mode-pull-request-effect = Opens { -pull-request(form: "a") } into the target branch and merges it
codes-merge-policy-direct = Direct
codes-merge-policy-serialized = Serialized
codes-merge-policy-direct-effect = { -landing(case: "upper", form: "s") } as soon as it is accepted
codes-merge-policy-serialized-effect = { -landing(case: "upper", form: "s") } alone on its reference, evaluated on what it { -landing(form: "s") }
codes-landing-onto = { $method } · { -landing(form: "s") } on { $target }
codes-landing-into = { $method } · into { $target }
codes-landing-default-branch = the default branch
codes-approval-required = Required
codes-approval-not-required = Not required

## The answers a ticket offers, and what each does.

codes-action-dispatch = { -dispatch(case: "upper") }
codes-action-resume = Resume
codes-action-revoke = { -revoke(case: "upper") }
codes-action-approve = Approve
codes-action-decline = Decline
codes-action-release = { -release(case: "upper") }
# spells -run: to re-run is a verb here
# spells -work-stage: the work in general
codes-resume-work = Re-runs the work · new { -artifact }
# spells -rework: to rework is a verb here
codes-resume-rework = Reworks · new { -artifact }
# spells -run: to re-run is a verb here
codes-resume-evaluation = Re-runs { -evaluation } from { -stage } 1
# spells -run: to re-run is a verb here
codes-resume-landing = Re-runs { -landing }
codes-resume-nothing = Nothing to resume
codes-wall-exit-one = only { $action } exits this wall
codes-wall-exit-two = only { $action } or { $other } exit this wall
codes-edit-effect = Revises the { -draft } · { -release(form: "s") } a new { -revision }
codes-action-dispatch-effect = { -dispatch(case: "upper", form: "s") } the observed version
codes-action-revoke-effect = { -revoke(case: "upper", form: "ing") } blocks its { -dependent(form: "plural") }
codes-action-approve-effect = Lets { -landing } proceed
codes-action-decline-effect = Holds { -landing } back
codes-action-release-effect = Makes the { -draft } { -ticket(form: "a") }

## What the actor did with a submission, and why it declined one.

codes-state-pending = Pending
codes-state-succeeded = Accepted
codes-state-refused = Refused
codes-state-answered = Answered
codes-state-cancelled = Cancelled
codes-refusal-ticket-exists = { -ticket(case: "upper") } already exists
codes-refusal-dependencies-not-found = { -dependency(case: "upper", form: "plural") } not found
codes-refusal-dependencies-revoked = { -dependency(case: "upper", form: "plural") } { -revoke(form: "ed") }
# spells -cycle: a loop of dependencies, not a work cycle
codes-refusal-dependency-cycle = { -dependency(case: "upper") } cycle
codes-refusal-self-dependency = Depends on itself
codes-refusal-ticket-not-found = { -ticket(case: "upper") } not found
codes-refusal-ticket-not-pending = No longer pending
codes-refusal-ticket-mismatch = Different { -ticket }
codes-refusal-revision-stale = { -revision(case: "upper") } out of date
codes-refusal-dependencies-incomplete = { -dependency(case: "upper", form: "plural") } not done
codes-refusal-not-revocable = Not revocable
codes-refusal-not-resumable = Nothing to resume
codes-refusal-run-not-current = { -run(case: "upper") } not current
codes-refusal-evaluation-not-current = { -evaluation(case: "upper") } not current
codes-refusal-landing-not-current = { -landing(case: "upper") } not current
codes-refusal-authoring-changed = Authoring changed
codes-refusal-configuration-invalid = { -configuration(case: "upper") } not runnable
codes-refusal-ticket-changed = { -ticket(case: "upper") } changed
codes-refusal-selection-changed = { -dispatch(case: "upper") } selection changed
codes-refusal-source-unreadable = Source ref not on remote
codes-refusal-source-denied = Remote refused credentials
codes-refusal-brief-no-repository = { -brief(case: "upper") } names no { -repository }
codes-refusal-brief-checks-uncommanded = No { -brief-check } { -stage } for { -brief } { -brief-check(form: "plural") }
codes-refusal-configuration-elsewhere = { -configuration(case: "upper") } from another { -repository }
codes-refusal-selection-unknown = Selection names no { -catalog } entry
codes-refusal-selection-unsupported = { -configuration(case: "upper") } cannot take this selection
codes-refusal-program-exceeds-plan = Program exceeds the { -evaluation-plan }
codes-refusal-program-skips-checks = Program skips the { -brief }'s { -brief-check(form: "plural") }
codes-refusal-overrides-unsupported = { -configuration(case: "upper") } cannot take these { -override(form: "plural") }
codes-refusal-overrides-unknown = { -override(case: "upper", form: "plural") } name no { -catalog } { -workload }
codes-refusal-capacity-reached = { -ticket(case: "upper") } capacity reached
codes-refusal-landing-request-closed = { -landing(case: "upper") } request closed
codes-refusal-overrides-move-definition = { -override(case: "upper", form: "plural") } would change the definition

## Why the boundary would not carry a request, or asked for it again.

codes-mutation-key-used = Key already used
codes-mutation-invalid = Invalid mutation
codes-mutation-not-admitted = Not admitted right now
codes-mutation-decided = Already decided
codes-mutation-skips-evaluations = Program skips planned { -evaluation(form: "plural") }
codes-deferral-dispatch-backlog = { -dispatch(case: "upper") } backlog
codes-deferral-mailbox-full = Server busy
codes-deferral-mailbox-unavailable = Server unreachable
codes-deferral-unknown = Deferred ({ $code })

## What went wrong with a submission, and how far one has got.

codes-failure-signed-out = Not signed in
codes-failure-absent = Operation not found
codes-failure-deferring = Kept deferring · { $deferral }
codes-failure-unreachable = API unreachable · { $reason }
codes-failure-unreadable = Unreadable response · { $reason }
codes-failure-refused = Refused ({ $code })
codes-abandon-deferred = Busy
codes-abandon-pending = Still pending
codes-abandon-unaccepted = Not accepted
codes-abandon-behind = Still updating
codes-abandon-unknown = Status unknown
# The word `failureWords.ts` gives a failed read, which it still spells.
codes-abandon-failed = { $word }
codes-abandon-thrown = Failed
codes-step-submitting = Submitting…
codes-step-backlogged = { $deferral } · retry in { $seconds }s
codes-step-following = Submitting…
codes-step-confirming = Updating…
codes-step-settled-pending = { $action } pending
codes-step-settled-succeeded = { $action } accepted
codes-step-settled-refused = { $action } refused
codes-step-settled-answered = { $action } answered
codes-step-settled-cancelled = { $action } cancelled
codes-step-settled-refusal = { $settled } · { $refusal }
