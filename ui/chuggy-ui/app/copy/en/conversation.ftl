## A conversation's lines and its composer.

conversation-region = { -conversation(case: "upper") }
conversation-loading = Loading…
conversation-bottom = Scroll to bottom
conversation-earlier = Earlier

## The composer.

conversation-message = Message
conversation-send = Send
conversation-stop = Stop
conversation-closed = Closed
conversation-dismiss = Dismiss
conversation-attach = Attach image
conversation-images = Images
conversation-image = Image { $ordinal }
conversation-image-remove = Remove image { $ordinal }
conversation-attach-bound = At most { $count } images
conversation-attach-types = Only { $types }

## What a run was handed, drawn as its first message.

conversation-prompt = Prompt
conversation-prompt-show = Show full prompt
conversation-prompt-hide = Hide full prompt
conversation-prompt-not-kept = Prompt not kept
conversation-prompt-unreadable = Prompt unreadable

## The ask, and the lines that belong to neither speaker.

conversation-context = Context
conversation-sent-from = Sent from
conversation-observation = Observation
conversation-inquiry = { -inquiry(case: "upper") }
conversation-copy-answer = Copy answer
conversation-marker-compaction = Compaction
conversation-marker-elided = Elided · { $bytes } bytes
conversation-marker-elided-batches = Elided · { $count } batches
conversation-marker-unreadable = Unreadable
conversation-marker-truncated = Truncated
conversation-marker-dropped = Dropped · { $count }
conversation-marker-unreached = Not reached
conversation-marker-unlisted = Stream unlisted
conversation-marker-no-store = No store
conversation-cut-result = Result cut · { $count }
conversation-cut-blocks = Blocks cut · { $count }
conversation-cut-steps = Steps cut · { $count }
conversation-cut-exchanges = Exchanges cut · { $count }

## The work an answer did.

conversation-call-unnamed = Result
conversation-call-size = { $chars } chars
conversation-block-unreadable = Unreadable
conversation-work-thought = Thought
conversation-work-tools = { $count ->
    [one] { $count } tool
   *[other] { $count } tools
}
conversation-work-done = Worked
conversation-work-thinking = Thinking
conversation-work-working = Working
conversation-work-thought-tools = { conversation-work-thought } · { conversation-work-tools }

## How a turn failed, by the mailbox's code.

conversation-failure-agent-failed = { -agent(case: "upper") } failed
conversation-failure-agent-rate-limited = Rate limited
conversation-failure-agent-turns-exhausted = { -turn(case: "upper", form: "plural") } exhausted
conversation-failure-agent-budget-exhausted = Budget exhausted
conversation-failure-store-refused = Store refused
conversation-failure-attempt-lost = { -attempt(case: "upper") } lost
conversation-failure-session-closed = Session closed
conversation-failure-turn-withdrawn = { -turn(case: "upper") } withdrawn
conversation-failure-turn-stopped = Stopped
conversation-failure-turn-stopped-queued = Stopped while queued
