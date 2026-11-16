## The lead's page.

## The top bar.

lead-heading = { -lead(case: "upper") }
lead-no-lead = No { -lead }
lead-session-open = Open
lead-session-closed = Closed
lead-absence-since = { $label } · since { $time }
lead-absence-until = { $label } · until { $time }
lead-absence-off = { $label } · credentials off
lead-absence-manual = { -ticket(case: "upper", form: "plural") } are { -dispatch(form: "ed") } by hand

lead-attention-monitoring = Monitoring
lead-attention-attention = Attention
lead-attention-stopped = Stopped

## The mailbox tail.

lead-turns-title = { -turn(case: "upper", form: "plural") }
lead-turns-none = No { -turn(form: "plural") }
lead-turns-col-turn = { -turn(case: "upper") }
lead-turns-col-input = Input
lead-turns-col-state = State
lead-turns-col-model = Model
lead-turns-col-tokens = Tokens
lead-turns-col-cost = Cost
lead-turns-col-duration = Duration

lead-turn-input-observation = Observation
lead-turn-input-message = Message
lead-turn-input-wake = Wake
lead-turn-input-question = { -inquiry(case: "upper") }
lead-turn-input-offer-reply = Offer reply

lead-turn-state-queued = Queued
lead-turn-state-claimed = Claimed
lead-turn-state-answered = Answered
lead-turn-state-failed = Failed
lead-turn-state-abandoned = Abandoned

lead-turn-failure-agent-failed = { -agent(case: "upper") } failed
lead-turn-failure-rate-limited = Rate limited
lead-turn-failure-turns-exhausted = { -turn(case: "upper", form: "plural") } exhausted
lead-turn-failure-budget-exhausted = Budget exhausted
lead-turn-failure-store-refused = Store refused
lead-turn-failure-attempt-lost = { -attempt(case: "upper") } lost
lead-turn-failure-session-closed = Session closed
lead-turn-failure-withdrawn = Withdrawn
lead-turn-failure-stopped = Stopped
lead-turn-failure-stopped-queued = Stopped while queued

## The conversation.

lead-conversation-aria = { -conversation(case: "upper") }
lead-conversation-empty = No { -conversation }
lead-handoff-note = Handoff note
lead-handoff-truncated = Truncated

## The decision log.

lead-decisions-title = Decisions
lead-decisions-none = No decisions
lead-decision-title = Decision { $ordinal }
lead-decision-none = None
lead-decision-tickets-label = { -ticket(case: "upper", form: "plural") }
lead-decision-dispatch-label = { -dispatch(case: "upper") }
lead-decision-inbox-link = { -inbox(case: "upper") }
lead-decision-refused = Refused
lead-decision-lifted = Lifted
lead-decision-refused-count = refused
lead-decision-lifted-count = lifted
lead-decision-summary-dispatched = { $landed } of { $named } { -dispatch(form: "ed") }

## Standing refusals.

lead-refusals-title = Refusals
lead-refusals-none = No refusals
lead-refusals-more = More
lead-refusals-caption = Standing refusals
lead-refusals-col-ticket = { -ticket(case: "upper") }
lead-refusals-col-version = Version
lead-refusals-col-state = State
lead-refusals-col-recorded = Recorded
lead-refusals-col-reason = Reason
lead-refusal-standing = Standing
lead-refusal-superseded = Superseded

## The questions asked of the lead.

lead-inquiries-title = { -inquiry(case: "upper", form: "plural") }
lead-inquiries-none = No { -inquiry(form: "plural") }
lead-inquiry-field = { -inquiry(case: "upper") }
lead-inquiry-ask = Ask
lead-inquiry-mine = Mine
lead-inquiry-asking = Asking
lead-inquiry-asked = Asked
lead-inquiry-failed = Failed
lead-inquiry-fault-empty = Empty
lead-inquiry-fault-too-long = Too long
lead-inquiry-asker-none = None
lead-inquiry-refusal-not-started = Not started
lead-inquiry-refusal-closed = Closed
lead-inquiry-refusal-in-flight = In flight
lead-inquiry-refusal-needs-hosted-runs = Needs { -hosted-runs }
lead-inquiry-refusal-subsidy-exhausted = Month's allowance spent · Resumes next month or on { -runner(form: "plural") }
lead-inquiry-refusal-not-subsidized = Moving to { -brand-name } · Takes { -inquiry(form: "plural") } after the { -lead }'s next pass
lead-inquiry-refusal-unknown = Refused
lead-inquiry-refusal-no-lead = No { -lead }

## The strip.

lead-mode-name = { -lead(case: "upper") }
lead-mode-running = Running
lead-mode-paused = Paused
lead-mode-action-pause = Pause
lead-mode-action-resume = Resume

lead-dispatch-name = { -dispatch(case: "upper") }
lead-dispatch-automatic = Automatic
# spells -approval: approving a dispatch, never a finalization
lead-dispatch-approval = { -dispatch(case: "upper") } approval
# spells -approval: approving a dispatch, never a finalization
lead-dispatch-action-require = Require { -dispatch } approval
lead-dispatch-action-automatic = { -dispatch(case: "upper") } automatically
