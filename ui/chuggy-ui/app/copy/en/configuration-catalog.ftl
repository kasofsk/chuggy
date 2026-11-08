## The configuration catalog: `browser/catalog/` and the core modules it draws
## from.

configuration-catalog-title = { -catalog(case: "upper") }
configuration-catalog-none = No { -configuration } imported
configuration-catalog-none-detail = Import one from { $directory }
configuration-catalog-picker-configuration = { -configuration(case: "upper") }
# Each version a configuration has held, by the newest revision holding it.
configuration-catalog-picker-revision = { -revision(case: "upper") }
# A document's format version, which no revision changes.
configuration-catalog-version-one = Version 1 { -configuration }
configuration-catalog-authored = Authored
configuration-catalog-imported = Imported

## The repository's head beside an import.

configuration-catalog-compare-head = Compare with the { -repository } head
configuration-catalog-show-import = Show the import
configuration-catalog-show-head = Show the head
configuration-catalog-head-matches = The { -repository }'s { $branch } at { $commit } declares { $name } as its newest import stored it.
configuration-catalog-head-differs = The { -repository }'s { $branch } at { $commit } declares a { $name } its newest import does not hold.
configuration-catalog-head-undeclared = The { -repository }'s { $branch } at { $commit } declares no { $name }.
configuration-catalog-head-refused = An import of the { -repository }'s { $branch } at { $commit } would be refused.
configuration-catalog-head-showing = Showing { $name } as the { -repository }'s { $branch } at { $commit } declares it.
configuration-catalog-head-branch-absent = The { -repository } has no default branch to read.
configuration-catalog-head-commit-absent = The { -repository }'s head moved while it was read.
configuration-catalog-head-snapshot-refused = The { -repository } refused a read of its head.

## The entries, as the list groups them and the detail names them.

configuration-catalog-group-workloads = { -workload(case: "upper", form: "plural") }
configuration-catalog-group-plans = { -evaluation-plan(case: "upper", form: "plural") }
configuration-catalog-group-landings = { -landing(case: "upper", form: "plural") }
configuration-catalog-group-prompts = Prompts
configuration-catalog-kind-workload = { -workload(case: "upper") }
configuration-catalog-kind-plan = Plan
configuration-catalog-kind-landing = { -landing(case: "upper") }
configuration-catalog-kind-prompt = Prompt
configuration-catalog-default-work = Default { -work-stage }
configuration-catalog-default-evaluation = Default { -evaluation }
configuration-catalog-default-landing = Default { -landing }
configuration-catalog-model-default = Default
configuration-catalog-unread = Unread
configuration-catalog-commands = Commands
configuration-catalog-prompt-inline = inline prompt
configuration-catalog-prompt-written-inline = Written inline
configuration-catalog-approved-first = Approved first
configuration-catalog-lands-unapproved = { -landing(case: "upper", form: "s") } unapproved
configuration-catalog-stage = { -stage(case: "upper") } { $number } · { $name }
configuration-catalog-stage-field = { -stage } { $number } · { $name }
configuration-catalog-field-file = File
# spells -runner: the workload's own runner field, Agent or Commands, not a machine
configuration-catalog-field-runner = Runner
configuration-catalog-field-evaluator = As { -evaluator(form: "a") }
configuration-catalog-field-model = Model
configuration-catalog-field-prompt = Prompt
configuration-catalog-field-approval = { -approval(case: "upper") }
configuration-catalog-field-landing = { -landing(case: "upper") }
configuration-catalog-field-policy = Policy
configuration-catalog-field-path = Path
configuration-catalog-uses = Uses
configuration-catalog-uses-none = Nothing.
configuration-catalog-used-by = Used by
configuration-catalog-used-by-none = Nothing in the { -catalog }.
configuration-catalog-entry-absent = Nothing in this { -catalog } is { $entry }.

## A selection's picker, an entry beside what it runs.

configuration-catalog-choice = { $name } · { $detail }
configuration-catalog-choice-default = { $name } (default) · { $detail }
configuration-catalog-choice-approved-first = approved first
configuration-catalog-choice-unapproved = { -landing(form: "s") } unapproved

## What a configuration's run is given: `core/configurationView.ts`.

configuration-catalog-agent-claude-code = { -claude-code }
configuration-catalog-agent-single = Single { -agent }
configuration-catalog-network = Network
configuration-catalog-network-none = No network
configuration-catalog-filesystem-none = No filesystem access
configuration-catalog-filesystem-readable = Working directory readable
configuration-catalog-filesystem-writable = Working directory writable
configuration-catalog-joined = { $lead } · { $rest }
