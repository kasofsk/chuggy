## The configuration catalog: `browser/catalog/` and the core modules it draws
## from.

configuration-catalog-title = { -catalog(case: "upper") }
configuration-catalog-none = No { -configuration } imported
configuration-catalog-picker-configuration = { -configuration(case: "upper") }
# Each version a configuration has held, by the newest revision holding it.
configuration-catalog-picker-revision = { -revision(case: "upper") }
# A document's format version, which no revision changes.
configuration-catalog-version-one = Version 1 { -configuration }
configuration-catalog-authored = Authored
configuration-catalog-imported = Imported
configuration-catalog-search = Search the { -catalog }
configuration-catalog-search-placeholder = Search names…
# Where nothing the page lists matches the search.
configuration-catalog-search-none = Nothing in the { -catalog } matches
# What a count beside a group's or a configuration's heading counts, read in its figure's place.
configuration-catalog-count = { $count ->
    [one] { $count } entry
   *[other] { $count } entries
}
# What the count beside the configurations' heading counts, read in its figure's place.
configuration-catalog-count-configurations = { $count ->
    [one] { $count } { -configuration }
   *[other] { $count } { -configuration(form: "plural") }
}

## A repository's configurations and the fragments they are made of.

configuration-catalog-picker-repository = { -repository(case: "upper") }
# The way back from one configuration to everything its repository declares.
configuration-catalog-repository-back = All of { $repository }
configuration-catalog-section-configurations = { -configuration(case: "upper", form: "plural") }
configuration-catalog-incomplete = Incomplete
# Before the file that holds a fragment written in no file of its own.
configuration-catalog-written-in = Written in
# Before the configurations that hold a fragment.
configuration-catalog-held-by = In
# Under the configurations, where a read of one of them failed.
configuration-catalog-fragments-partial = The parts of a { -configuration } that could not be read are not listed.

## The repository's head, drawn in an import's place.

configuration-catalog-show-import = Show the import
configuration-catalog-head-matches = The { -repository }'s { $branch } at { $commit } declares { $name } as its newest import stored it.
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
configuration-catalog-runner-unknown = Unknown
configuration-catalog-approval = { -approval(case: "upper") } by a person
configuration-catalog-approvers-developer = Any { -project } { -role-developer }
configuration-catalog-approvers-admin = Any { -project } { -role-admin }
configuration-catalog-plan-approved = { $stages } · waits on a person's { -approval }
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
configuration-catalog-field-reevaluate = Reevaluates
configuration-catalog-field-model = Model
configuration-catalog-field-prompt = Prompt
configuration-catalog-field-approvers = Answered by
configuration-catalog-field-instructions = Instructions
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
