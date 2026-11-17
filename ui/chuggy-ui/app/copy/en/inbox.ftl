## The inbox.

inbox-title = { -inbox(case: "upper") }
inbox-clear = { -inbox(case: "upper") } is clear
inbox-no-action = no action can be sent from here yet
inbox-more = more
inbox-loading = Loading…
inbox-more-failed = More
inbox-answer-unsaid = the answer failed
inbox-last-run = last { -run }

inbox-group-approvals = { -approval(case: "upper", form: "plural") }
inbox-group-proposals = { -proposal(case: "upper", form: "plural") }
# spells -inquiry: what the machine or a refusal leaves a person to answer, not the lead's question
inbox-group-questions = Questions
inbox-group-count = { $count } waiting

inbox-ask-approval = Approve this { -evaluation }?
inbox-ask-proposal = { -dispatch(case: "upper") } this { -ticket }?
inbox-ask-escalation = Resume this { -ticket }, or { -revoke } it?
inbox-ask-refusal = { -lead(case: "upper") } will not { -dispatch } this { -ticket }

inbox-asker-evaluation = { -evaluation(case: "upper") }
inbox-asker-lead = { -lead(case: "upper") }
inbox-asker-escalation = { -brand-name }

inbox-kind-approval = { -approval(case: "upper") }

inbox-action-dispatch = { -dispatch }
inbox-action-resume = resume
inbox-action-revoke = { -revoke }
inbox-action-approve = approve
inbox-action-reject = reject
inbox-action-release = { -release }

inbox-step-submitting = Submitting
inbox-step-busy = Busy
inbox-step-waiting = Waiting
inbox-step-updating = Updating

inbox-proposal-pill = { -proposal(case: "upper") }
inbox-proposal-why = { -lead(case: "upper") } { -proposal }
inbox-proposal-why-others = { -lead(case: "upper") } { -proposal } · also { $others }
inbox-proposal-approve = approve
inbox-proposal-reject = reject
inbox-proposal-reject-question = Reject this { -proposal }?
inbox-proposal-reject-confirm = Reject
inbox-proposal-note-label = Note
inbox-proposal-note-placeholder = Note
inbox-proposal-stale = Stale
inbox-proposal-failed = Failed
inbox-proposal-failed-unauthenticated = Unauthenticated
inbox-proposal-failed-absent = Absent
inbox-proposal-failed-unreachable = Unreachable
inbox-proposal-failed-unreadable = Unreadable
inbox-proposal-outcome-approved = Approved
inbox-proposal-outcome-rejected = Rejected
inbox-proposal-sentence = { -proposal(case: "upper") } { $tickets } · { $word }
inbox-proposal-sentence-why = { -proposal(case: "upper") } { $tickets } · { $word } · { $why }
