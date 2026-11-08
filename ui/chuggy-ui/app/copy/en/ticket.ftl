## The ticket page and its sections.

## Shared one-word statuses, reused wherever the same word is drawn.

ticket-verdict-passed = Passed
ticket-verdict-failed = Failed
ticket-verdict-starting = Starting
ticket-verdict-running = Running
ticket-verdict-cancelled = Cancelled
ticket-verdict-blocked = Blocked
ticket-verdict-killed = Killed
ticket-cycle-current = Current
ticket-standing-ready = Ready
ticket-value-none = None
ticket-value-unknown = Unknown
ticket-value-default = Default
ticket-cancel = Cancel
ticket-edit = Edit
ticket-duplicate = Duplicate
ticket-copy-link = Copy link
ticket-copy-link-copied = Copied
ticket-cant-be-undone = Can't be undone.
ticket-all-runs = All { -run(form: "plural") }
ticket-waiting = Waiting
ticket-ran-lower = ran
ticket-waited-lower = waited

## Shared field and column names.

ticket-field-cost = Cost
ticket-field-run-time = { -run(case: "upper") } time
ticket-field-waited = Waited
ticket-field-tokens = Tokens
ticket-field-model = Model
ticket-field-turns = { -turn(case: "upper", form: "plural") }
ticket-field-api-time = API time
ticket-field-attempts = { -attempt(case: "upper", form: "plural") }

## Counts a few sections share.

ticket-run-count = { $count ->
    [one] { $count } { -run }
   *[other] { $count } { -run(form: "plural") }
}
ticket-turn-count = { $count ->
    [one] { $count } { -turn }
   *[other] { $count } { -turn(form: "plural") }
}
ticket-file-count = { $count ->
    [one] { $count } file
   *[other] { $count } files
}

## The ticket page's tabs and header: `TicketHeader.tsx`.

ticket-tab-overview = Overview
ticket-tab-runs = { -run(case: "upper", form: "plural") }
ticket-tab-configuration = { -configuration(case: "upper") }
ticket-tab-usage = Usage
ticket-tabs-nav-label = { -ticket(case: "upper") }

## A ticket's cycles and stages by number: `app/core/ticketLedger.ts`.

ticket-cycle-number = { -cycle(case: "upper") } { $cycle }
ticket-stage-number = { -stage(case: "upper") } { $stage }

## The page itself: `app/browser/TicketPage.tsx`.

ticket-page-untitled = { -ticket(case: "upper") }
ticket-page-not-found = No such { -ticket }
ticket-page-no-configuration = No { -configuration }

## The header's actions and menu: `app/browser/TicketActions.tsx`,
## `TicketHeaderMenu.tsx`, `TicketRevoke.tsx`.

ticket-dispatch-confirm-title = { -dispatch(case: "upper") } { -ticket } #{ $number }?
ticket-cancel-refused = Cancel refused · { $reason }
ticket-no-lead-dispatched-by-hand = No { -lead } · { -dispatch(case: "upper", form: "ed") } by hand
ticket-header-menu-label = More actions
ticket-revoke-menu-item = { -revoke(case: "upper") }…
ticket-draft-delete = Delete { -draft }
ticket-draft-delete-menu-item = { ticket-draft-delete }…
ticket-revoke-confirm-title = { -revoke(case: "upper") } this { -ticket }?
ticket-revoke-confirm = { -revoke(case: "upper") } { -ticket }
ticket-draft-delete-confirm-title = Delete this { -draft }?
ticket-revoke-warning = Ends this { -ticket } and blocks its { -dependent(form: "plural") }. { ticket-cant-be-undone }
ticket-actions-request-failed = the request failed
# spells -attempt: one try at an action, not at a run
ticket-actions-attempt-cancelled = this attempt was cancelled

## What a resume, a dispatch or any other action does, as the line a reader
## hovers the button for: `app/core/ticketActions.ts`.

ticket-actions-sentence-dispatch = { -dispatch } this { -ticket } from the version the console observed
ticket-actions-sentence-resume-default = continue this { -ticket } from where it was { -escalation }
ticket-actions-sentence-resume-rework = { -rework } this { -ticket } with a fresh { -cycle }
ticket-actions-sentence-revoke = { -revoke } this { -ticket }
ticket-actions-sentence-approve = let this { -ticket }'s { -landing } go ahead
ticket-actions-sentence-decline = hold this { -ticket }'s { -landing } back
ticket-actions-sentence-release = { -release } this { -draft } as a { -ticket }

## A never-released draft, drawn in the ticket's place: `TicketDraft.tsx`.

ticket-draft-not-released = Not { -release(form: "ed") }
ticket-draft-untitled = { -draft(case: "upper") }

## What the ticket's overrides card offers: `app/core/parkedOverrides.ts`,
## `app/browser/ticket/ParkedOverrides.tsx`.

ticket-overrides-not-saved = Not saved
ticket-overrides-not-saved-because = Not saved · { $reason }
ticket-overrides-save-failed = the save failed
ticket-overrides-invalid = Not saved · these are not { -override(form: "plural") } a { -ticket } may hold
ticket-overrides-saving = Saving…
ticket-overrides-saved = { -override(case: "upper", form: "plural") } saved
ticket-overrides-save = Save { -override(form: "plural") }
ticket-overrides-discard = Discard
ticket-overrides-title = { -override(case: "upper", form: "plural") }

## What the ticket asks for: `TicketInstructions.tsx`.

ticket-instructions-show-less = Show less
ticket-instructions-show-all = Show all
ticket-instructions-title = Instructions

## The ticket's configuration and provenance: `app/browser/TicketProvenance.tsx`.

ticket-provenance-brief-image-alt = { -brief(case: "upper") } image { $number }
ticket-provenance-overridden = Overridden
ticket-provenance-method = Method
ticket-provenance-policy = Policy
ticket-provenance-digest = Digest
ticket-provenance-canonical-json = Canonical JSON
ticket-provenance-catalog-link = { -catalog(case: "upper") }

## The Overview tab: `app/browser/ticket/TicketOverview.tsx`.

ticket-overview-so-far = so far
ticket-overview-properties = Properties
ticket-overview-repository = { -repository(case: "upper") }
ticket-overview-branch = Branch
ticket-overview-branch-target = → { $target }
ticket-overview-filed-by = Filed by
ticket-overview-depends-on = Depends on
ticket-overview-configuration = { -configuration(case: "upper") }
ticket-overview-revision = { -revision(case: "upper") } { $revision }
ticket-overview-unreleased-changes = Unreleased changes
ticket-overview-open-draft = Open { -draft }
ticket-overview-draft-badge = { -draft(case: "upper") }

## Steps and the Now card: `TicketSteps.tsx`, `TicketNow.tsx`, `TicketSlot.tsx`,
## `TicketRunTime.tsx`.

ticket-steps-in-order = in order
# spells -run: "run" is the verb (none have run yet), not the noun
ticket-steps-none-run-yet = None run yet
ticket-steps-heading = Steps
ticket-steps-phase-work = { -work-stage(case: "upper") }
ticket-steps-phase-evaluation = { -evaluation(case: "upper") }
ticket-steps-phase-landing = { -landing(case: "upper") }
ticket-now-watch = Watch
ticket-now-title = { $status } { $step }
ticket-now-prefix = Now: { $doing }
ticket-now-aria-label = Now
ticket-now-personal-runners = { -personal-runner(case: "upper", form: "plural") }
ticket-run-time-running = running
ticket-needs-you-aria-label = Needs you
ticket-situation-read-the = Read the { $step }
ticket-term-run = { -run }
ticket-situation-step-work = { -work-stage }
ticket-situation-running-work = { -work-stage(case: "upper") }
ticket-situation-where = { $outcome } in { -cycle } { $cycle }
ticket-situation-step-runners = { -runner(case: "upper", form: "plural") }
ticket-situation-step-repositories = { -repository(case: "upper", form: "plural") }

## `TicketStateChip.tsx`: a dependency chip and the dispatch button it sits in.

ticket-dispatch-aria-label = { -dispatch(case: "upper") } { -ticket } #{ $number }

## The Runs tab, its rail and one run's own page: `TicketRuns.tsx`,
## `TicketRunPage.tsx`.

# spells -run: "has run" is the verb, not the noun
ticket-nothing-has-run = Nothing has run
ticket-run-nav-label = { -run(case: "upper") }
ticket-run-view-summary = Summary
ticket-run-view-transcript = { -transcript(case: "upper") }
ticket-run-view-details = Details
ticket-run-view-output = Output
ticket-run-no-summary = No summary
ticket-run-no-transcript = No { -transcript }
ticket-run-runner = { -runner(case: "upper") }
ticket-run-image = Image
ticket-run-worker = Worker
ticket-run-cpus = CPUs
ticket-run-id-field = { -run(case: "upper") } ID
ticket-run-not-found = No such { -run }
ticket-run-showing-first = Showing first { $run }

## The ticket's landing, under the Runs tab: `TicketLandingPage.tsx`,
## `TicketLandings.tsx`.

ticket-landing-heading = { -landing(case: "upper") }
ticket-landing-none = No { -landing }
ticket-landing-not-reached = Not reached
ticket-landing-pull-request-field = { -pull-request(case: "upper") }
ticket-landing-from = From
ticket-landing-into = Into
ticket-landing-head = Head
ticket-landing-base = Base
ticket-landing-creation = Creation
ticket-landing-status = Status
ticket-landing-merge = Merge
ticket-landing-reason = Reason
ticket-landing-mergeability = Mergeability
ticket-landing-merge-state = Merge state
ticket-landing-merge-commit = Merge commit
ticket-landing-merged-head = Merged head
ticket-landing-evaluated-head = Evaluated head
ticket-landing-conflicts = Conflicts
ticket-landing-more-not-shown = More not shown
ticket-landing-target = Target
ticket-landing-candidate = Candidate
ticket-landing-prepared = Prepared
ticket-landing-checked = Checked
ticket-landing-details-label = Details
ticket-landing-details-hide = Hide
ticket-landing-queue-removal = Queue removal: { $removal }
# spells -attempt: tries at the landing, not at a run
ticket-landing-attempts = Attempts
ticket-landing-removal-by = { $reason } by { $actor }
ticket-landing-hold-removal = { $hold }: { $removal }
ticket-landing-held-for = Held { $age } · { $hold }
ticket-landing-held = Held · { $hold }
ticket-landing-wait-state = { $wait } · { $state }
ticket-landing-wait-checked = { $wait } · checked { $checked }
ticket-landing-failure-files = { $failure } · { $files }
ticket-landing-merged = Merged
ticket-landing-unevaluated-head = Unevaluated head
ticket-landing-pull-number = PR #{ $number }
ticket-landing-summary-running = { -landing(case: "upper") } running
ticket-landing-summary-held = { -landing(case: "upper") } held
ticket-landing-summary-waiting = { -landing(case: "upper") } waiting
ticket-landing-summary-failed = { -landing(case: "upper") } failed
ticket-landing-summary-escalated = { -landing(case: "upper") } { -escalation }
ticket-landing-summary-proposed = { -landing(case: "upper") } proposed
ticket-landing-summary-invalidated = { -landing(case: "upper") } invalidated

## The Usage tab: `TicketUsage.tsx`.

ticket-usage-basis-list = list price
ticket-usage-models-note = { $count ->
    [one] one model
   *[other] { $count } models
}
ticket-usage-agent-runs = { -agent } { -run(form: "plural") }
ticket-usage-by-step-caption = Usage by step
ticket-usage-by-model-caption = Usage by model
ticket-usage-col-step = Step
ticket-usage-col-runs = { -run(case: "upper", form: "plural") }
ticket-usage-col-input = Input
ticket-usage-col-output = Output
ticket-usage-col-cache-write = Cache write
ticket-usage-col-cache-read = Cache read
ticket-usage-by-step-title = By step
ticket-usage-by-model-title = By model
ticket-usage-permission-denials = Permission denials
ticket-usage-steps-over = Steps over the first { $run }
ticket-usage-delivery-title = { -delivery(case: "upper") }
ticket-usage-no-figures = No { -run } figures yet

## A run's transcript: `app/browser/RunTranscript.tsx`,
## `app/core/runTranscript.ts`.

ticket-transcript-show-every-turn = Show every { -turn }
ticket-transcript-empty = no { -transcript } has been recorded yet
ticket-transcript-subject = { -transcript(case: "upper") }
ticket-transcript-raw-json = Raw JSON
ticket-transcript-capped-batches = the { -run } reached its { -transcript } cap and stopped recording after { $batches } batches
ticket-transcript-capped-turns = the series kept for each { -turn } reached its cap and stopped after { $turns } { -turn(form: "plural") }
ticket-transcript-gap-content = batch { $batch }: no lines recorded
ticket-transcript-gap-missing = batch { $batch }: bytes unavailable
ticket-transcript-gap-corrupt = batch { $batch }: bytes corrupt
ticket-transcript-earlier-not-held = Earlier { -conversation } not held

## The result a run's result opens, and its artifacts: `TicketResult.tsx`,
## `app/core/artifactPreview.ts`.

ticket-result-end-cut = End cut
ticket-artifact-no-preview = No preview

## The inbox's section titles, and a parked row's badge: `app/core/ticketSections.ts`.

ticket-sections-needs-you = Needs you
ticket-sections-in-progress = In progress
ticket-sections-up-next = Up next
ticket-sections-done = Done
ticket-sections-stopped = Failed or { -revoke(form: "ed") }
