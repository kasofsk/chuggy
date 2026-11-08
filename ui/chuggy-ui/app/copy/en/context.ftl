## What an agent's context held, what went into it and how it grew: a run's
## Context tab and the panel beside a session, `app/core/contextView.ts`,
## `app/core/contextRun.ts`, `app/core/contextSession.ts` and
## `app/browser/context/`.

context-title = { -context(case: "upper") }
context-open = { -context(case: "upper") }
context-close = Close
context-view-label = What the { -context } held

## The window: what the latest reading held of it, by category.

context-window-title = { -window(case: "upper") }
context-at = { $unit ->
    [turn] { -turn(case: "upper") } { $at }
   *[call] Call { $at }
}
context-at-unread = { $at } · No reading
context-used-of = of { $window } tokens
context-used-alone = tokens
context-compacts-at = { -compaction(case: "upper", form: "s") } at { $tokens }
context-bar-label = The { -window }, by what holds it
context-col-category = Category
context-col-tokens = Tokens
context-col-share = Share
context-col-file = File
context-col-bytes = Bytes
context-col-tool = Tool
context-col-calls = Calls
context-category-system-prompt = System prompt
context-category-system-tools = System tools
context-category-mcp-tools = MCP tools
context-category-memory-files = Memory files
context-category-skills = Skills
context-category-agents = Custom { -agent(form: "plural") }
context-category-messages = Messages
context-category-free = Free
context-category-buffer = Autocompact buffer
context-category-deferred = Deferred tools
context-category-used = Used
context-category-window = { -window(case: "upper") }
context-not-recorded = Not recorded
context-unloaded = Unloaded

## Growth: the context at each call or turn, and where it was cut.

context-growth-title = Growth
context-per-call = Per call
context-per-turn = Per { -turn }
context-peak = Peak
context-calls = Calls
context-turns = { -turn(case: "upper", form: "plural") }
context-compactions = { -compaction(case: "upper", form: "plural") }
context-cache-read = Cache read
context-none = None
context-subagents-none = No { -subagent(form: "plural") }
context-subagent-calls = { $count } { -subagent }
context-compactions-at = At { $tokens }
context-compactions-after = After { $unit ->
    [turn] { -turn }
   *[call] call
} { $at }
context-threshold-unrecorded = Threshold not recorded
context-cache-share = { $share }% of input
context-legend-context = { -context(case: "upper") }
context-legend-main = Main
context-legend-subagent = { -subagent(case: "upper") }
context-legend-threshold = Threshold
context-legend-compaction = { -compaction(case: "upper") }
context-compacted = { -compaction(case: "upper", form: "ed") } { $before } → { $after }
context-compacted-from = { -compaction(case: "upper", form: "ed") } from { $before }
context-chart-label = The { -context } at each call or { -turn }
context-tokens = { $tokens } tokens
context-point-moved = { $moved ->
    [fell] −{ $growth }
   *[rose] +{ $growth }
} since { $unit ->
    [turn] { -turn }
   *[call] call
} { $previous }
context-point-subagent = { -subagent(case: "upper") } call
context-growth-none = No calls recorded yet
context-growth-none-turns = No { -turn(form: "plural") } measured yet

## Inputs: what the agent was handed before its first call.

context-inputs-title = Inputs
context-snapshot = Snapshot
context-brief = { -brief(case: "upper") }
context-characters = characters
context-show = Show
context-hide = Hide
context-instructions = Instructions
context-settings = Settings
context-files-other = Other files
context-file-unkept = Not kept
context-tools = Tools
context-mcp-servers = MCP servers
context-skills = Skills
context-subagents = { -subagent(case: "upper", form: "plural") }
context-plugins = Plugins
context-deferred-count = { $tokens } deferred
context-brief-none = No { -brief } kept
context-inputs-none = No snapshot kept
context-appended-prompt = Appended prompt
context-thread-seed = { -context(case: "upper") }

## Heaviest: the tool results that filled it.

context-heaviest-title = Heaviest
context-results = { $count ->
    [one] { $count } result
   *[other] { $count } results
}
context-by-tool = By tool
context-largest = Largest results
context-share-estimated = Share of the peak { -context }, at four bytes a token.
context-share-exact = Share of the { -context } at the latest reading.
context-share-unweighed = A result with no text, such as an image, is not weighed.
context-bytes = bytes
context-growth-after = +{ $tokens } tok
context-result-uncounted = Call unknown
context-heaviest-none = No tool results read yet

## The reads behind it.

context-subject-run = this { -run }'s { -context }
context-subject-session = this { -context }
