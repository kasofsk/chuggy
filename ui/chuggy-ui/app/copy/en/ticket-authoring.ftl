## Writing a ticket and releasing it.

ticket-authoring-joined = { $first } · { $second }
ticket-authoring-new-ticket = New { -ticket }
ticket-authoring-create-ticket = Create { -ticket }
ticket-authoring-revise-and-release = revise and { -release }
ticket-authoring-edit-heading = Edit { -ticket } { $ticket }
ticket-authoring-duplicate-heading = New { -ticket } from
ticket-authoring-duplicate-from = { -ticket } { $ticket }
ticket-authoring-ticket = { -ticket(case: "upper") } { $ticket }
ticket-authoring-not-pending = this { -ticket } is no longer pending, so it cannot be edited
ticket-authoring-draft = { -draft(case: "upper") }
ticket-authoring-repositories = { -repository(case: "upper", form: "plural") }
ticket-authoring-held-draft = { -draft(case: "upper") } version { $version } not { -release(form: "ed") }

## The form's fields.

ticket-authoring-configuration = { -configuration(case: "upper") }
ticket-authoring-choose = Choose
ticket-authoring-none = None
ticket-authoring-selection-work = { -work-stage(case: "upper") }
ticket-authoring-selection-evaluation = { -evaluation(case: "upper") }
ticket-authoring-selection-landing = { -landing(case: "upper") }
ticket-authoring-title = Title
ticket-authoring-title-placeholder = what this { -ticket } is called
ticket-authoring-intent = Intent
ticket-authoring-intent-placeholder = what this { -ticket } is for
ticket-authoring-links = Links
ticket-authoring-link = Link { $number }
ticket-authoring-add-link = Add link
ticket-authoring-remove = Remove
ticket-authoring-checks = { -brief-check(case: "upper", form: "plural") }
ticket-authoring-check = { -brief-check(case: "upper") } { $number }
ticket-authoring-check-placeholder = a command line
ticket-authoring-add-check = Add { -brief-check }
ticket-authoring-branch = Branch
ticket-authoring-branch-placeholder = the branch name
ticket-authoring-target-branch = Target branch
ticket-authoring-target-branch-placeholder = the branch to { -landing(form: "base") } on
ticket-authoring-repository = { -repository(case: "upper") }
ticket-authoring-epic = { -epic(case: "upper") }
ticket-authoring-epics-more = More { -epic(form: "plural") }
ticket-authoring-epics-first = First { -epic(form: "plural") }
ticket-authoring-overrides = { -override(case: "upper", form: "plural") }

## What the advanced settings offer.

ticket-authoring-advanced = Advanced
ticket-authoring-dependencies = { -dependency(case: "upper", form: "plural") }
ticket-authoring-dependencies-none = No { -ticket(form: "plural") } to depend on
ticket-authoring-dependencies-truncated = Not every { -ticket } is listed
ticket-authoring-configuration-version = { -configuration(case: "upper") } version
ticket-authoring-configuration-version-default = Default ({ $following })
ticket-authoring-evaluators-per-stage = { -evaluator(case: "upper", form: "plural") } per { -stage }
ticket-authoring-stage = { -stage(case: "upper") } { $number }
ticket-authoring-add-stage = Add { -stage }

## The images a ticket carries.

ticket-authoring-images = Images
ticket-authoring-image = Image { $number }
ticket-authoring-images-drop = Paste or drop images here
ticket-authoring-attach = Attach
ticket-authoring-attach-images = Attach images
ticket-authoring-images-pick = Pick, paste or drop · { $types }
ticket-authoring-images-uploading = uploading…
ticket-authoring-images-bound = one { -ticket } carries at most { $count } images
ticket-authoring-images-types = only { $types } images attach
ticket-authoring-image-unattached = Not attached
ticket-authoring-image-unattached-cause = Not attached · { $cause }

## What a ticket overrides of its configuration.

ticket-authoring-field-model = Model
ticket-authoring-field-setup = Setup
ticket-authoring-field-files = Files
ticket-authoring-field-practices = Practices
ticket-authoring-field-motivation = Motivation
ticket-authoring-field-acceptance-criteria = Acceptance criteria
ticket-authoring-field-constraints = Constraints
# spells -work-stage: the work in general, not the stage
ticket-authoring-field-work-instructions = Work instructions
# spells -override: the verb
ticket-authoring-override-model = Override model
# spells -override: the verb
ticket-authoring-override-setup = Override setup
# spells -override: the verb
ticket-authoring-override-files = Override files
# spells -override: the verb
ticket-authoring-override-practices = Override practices
# spells -override: the verb
ticket-authoring-override-motivation = Override motivation
# spells -override: the verb
ticket-authoring-override-criteria = Override acceptance criteria
# spells -override: the verb
ticket-authoring-override-constraints = Override constraints
# spells -override: the verb
# spells -work-stage: the work in general, not the stage
ticket-authoring-override-work-instructions = Override work instructions
ticket-authoring-overridden = Overridden
ticket-authoring-use-configuration = Use the { -configuration }'s
ticket-authoring-file-path = { $field } { $number } path
ticket-authoring-file-content = { $field } { $number } content
ticket-authoring-file-path-placeholder = a path in the working directory
ticket-authoring-add-file = Add file

## Where the work happens and where it lands.

ticket-authoring-configuration-line = { -configuration(case: "upper") } · { $name }
ticket-authoring-configuration-line-commit = { -configuration(case: "upper") } · { $name } · { $commit }
ticket-authoring-bootstrap = First { -ticket } · writes this { -repository }'s { -configuration }
# spells -work-stage: the work in general, not the stage
ticket-authoring-branch-hint = the branch this work starts from, and { -landing(form: "s") } on unless a target names another, created if it does not exist yet: a name, not a reference, which this console sends as { $prefix }<name>
# spells -work-stage: the work in general, not the stage
ticket-authoring-target-hint = where the finished work { -landing(form: "s") }, created if it does not exist yet: a name, not a reference, which this console sends as { $prefix }<name>, and { $unnamed } where it is left empty
ticket-authoring-target-unnamed-none = nowhere; { -landing(form: "a") } that { -landing(form: "s") } nothing names no reference
ticket-authoring-target-unnamed-default = the { -repository }'s default branch
# spells -work-stage: the work in general, not the stage
ticket-authoring-target-unnamed-worked = the branch the work happened on
# spells -work-stage: the work in general, not the stage
ticket-authoring-branch-field-hint = Where the work happens · created if missing
ticket-authoring-target-field-none = { -landing(case: "upper", form: "s") } nothing
ticket-authoring-target-field-default = Empty means the { -repository }'s default branch
ticket-authoring-target-field-above = Empty means the branch above
ticket-authoring-branch-prefixed = enter the branch name, not the ref: this console adds { $prefix } itself
ticket-authoring-landing-branch = { -pull-request(form: "a") } is opened from a branch of its own, so name one above
ticket-authoring-landing-whole = { -pull-request(form: "a") } opens from the branch above into a different target branch

## What the form refuses, field by field.

# spells -work-stage: the work in general, not the stage
# spells -run: the verb
ticket-authoring-fault-configuration = { -configuration(form: "a") } is who does the work, so { -ticket(form: "a") } names which one it runs under
ticket-authoring-fault-title = name this { -ticket } in one line of at most { $chars } characters
ticket-authoring-fault-intent = state what this { -ticket } is for, in at most { $chars } characters
ticket-authoring-fault-links = each link is an { $scheme } URL of at most { $chars } characters, and one { -ticket } carries at most { $count }
ticket-authoring-fault-checks = each { -brief-check } is one command line of at most { $chars } characters, and one { -ticket } adds at most { $count }
ticket-authoring-fault-branch = a branch is named here without its { $prefix } prefix, and the whole reference is at most { $chars } characters
ticket-authoring-fault-landing = this { -landing } is not one the API will accept
ticket-authoring-fault-repository = this { -project } binds { -repository(form: "a") }, so { -ticket(form: "a") } in it names which one
ticket-authoring-fault-authoring = one advanced setting is not one this { -project } offers
ticket-authoring-fault-overrides = { -override(form: "a") } is not one { -ticket(form: "a") } may write
ticket-authoring-fault-fence = this form no longer describes { -configuration(form: "a") } the API will accept
# spells -override: the verb
ticket-authoring-fault-override-mode = this model is written into a mode { -ticket(form: "a") } may not override with
ticket-authoring-fault-override-lines = write this as lines of text, one a line
ticket-authoring-fault-override-files = each file is a path and its content
ticket-authoring-fault-override = { $field }: { $reason }
# spells -override: the verb
ticket-authoring-overrides-refused = your role in this { -project } may not override its checked-in { -configuration }; remove the { -override(form: "plural") } to continue
ticket-authoring-program-short = your role in this { -project } may not leave out part of the plan; restore every { -stage } and { -evaluator } it plans to continue

## What a submit does, and where it has got to.

# spells -work-stage: the work in general, not the stage
ticket-authoring-effect-starts = Starts work
ticket-authoring-effect-waits = { -release(case: "upper", form: "ed") } for { -role-dispatcher(form: "a") } to start
ticket-authoring-step-submitting-release = creating the { -draft } and { -release(form: "ing") } it…
ticket-authoring-step-submitting-update = revising the { -draft } and { -release(form: "ing") } the update…
ticket-authoring-step-backlogged = the API is deferring this; trying again in { $seconds }s
ticket-authoring-step-following-release = waiting for the actor to decide the { -release }…
ticket-authoring-step-following-update = waiting for the actor to decide the update…
ticket-authoring-step-confirming-release = waiting for the { -project } to catch up with the { -release }…
ticket-authoring-step-confirming-update = waiting for the { -project } to catch up with the update…
ticket-authoring-step-released = { -release(form: "ed") }
ticket-authoring-step-starting = starting…
ticket-authoring-step-updated = updated

## Why a submit made no ticket.

ticket-authoring-context-no-repository = No { -repository } bound
ticket-authoring-context-no-configuration = No { -configuration }
ticket-authoring-context-unknown = No ready { -configuration } found
ticket-authoring-stale = { -project(case: "upper") } changed · Submit again
ticket-authoring-stale-unread = { -project(case: "upper") } changed · Could not reload
ticket-authoring-project-inactive = { -project(case: "upper") } not active · No new { -ticket(form: "plural") }
ticket-authoring-draft-changed = { -draft(case: "upper") } changed elsewhere · Not written
ticket-authoring-draft-kept-unsettled = { -draft(case: "upper") } { $ticket } kept · Maybe { -release(form: "ed") }
ticket-authoring-draft-kept-unreleased = { -draft(case: "upper") } { $ticket } kept · Not { -release(form: "ed") }
ticket-authoring-draft-followed-unsettled = { -draft(case: "upper") } { $ticket } · Maybe { -release(form: "ed") }
ticket-authoring-draft-followed-unreleased = { -draft(case: "upper") } { $ticket } · Not { -release(form: "ed") }
ticket-authoring-draft-unread = { -draft(case: "upper") } not written
ticket-authoring-draft-deleted-followed = { -draft(case: "upper") } { $ticket } deleted · Nothing here will be { -release(form: "ed") }
ticket-authoring-draft-deleted-created = { -draft(case: "upper") } { $ticket } deleted · Submit again for a new one
ticket-authoring-ticket-exists = #{ $ticket } already exists · Changes since are not in it
ticket-authoring-release-unfinished = { -release(case: "upper") } did not finish
ticket-authoring-draft-unsaved = { -draft(case: "upper") } not saved · Fix the form to send
ticket-authoring-leave-question = Discard the unsaved { -ticket } and leave?
ticket-authoring-take-theirs = Take theirs
ticket-authoring-keep-mine = Keep mine

## What a duplicate did not carry.

ticket-authoring-dropped = Not carried · { $parts }
ticket-authoring-dropped-repository = { -repository } { $repository }, no longer bound
ticket-authoring-dropped-dependency = { -dependency } on { -ticket } { $ticket }, { -revoke(form: "ed") }
ticket-authoring-dropped-configuration = { -configuration } { $configuration }, no longer offered

## The ticket list's sorts.

ticket-authoring-sort-state = State
ticket-authoring-sort-newest = Newest first
ticket-authoring-sort-oldest = Oldest first
ticket-authoring-sort-activity = Last activity

## The YAML editor.

ticket-authoring-yaml-unloaded = YAML editor did not load · Form still holds this { -ticket }
ticket-authoring-yaml-loading = loading the YAML editor…
ticket-authoring-mode-switch = Write the { -ticket } as
ticket-authoring-mode-form = Form
ticket-authoring-yaml-stuck = fix the YAML to switch back to the form
ticket-authoring-fold-all = Fold all
ticket-authoring-unfold-all = Unfold all
ticket-authoring-expand-references = Expand references
ticket-authoring-collapse-references = Collapse references
ticket-authoring-vim-keys = Vim keys
ticket-authoring-editor-control-character = Control character
ticket-authoring-editor-close = close
ticket-authoring-editor-folded-code = folded code
ticket-authoring-editor-to = to
ticket-authoring-editor-unfold = unfold
ticket-authoring-editor-fold-line = Fold line
ticket-authoring-editor-unfold-line = Unfold line
ticket-authoring-editor-folded-lines = Folded lines
ticket-authoring-editor-unfolded-lines = Unfolded lines
ticket-authoring-editor-find = Find
ticket-authoring-editor-replace-field = Replace
ticket-authoring-editor-next = next
ticket-authoring-editor-previous = previous
ticket-authoring-editor-all = all
ticket-authoring-editor-match-case = match case
ticket-authoring-editor-regexp = regexp
ticket-authoring-editor-by-word = by word
ticket-authoring-editor-replace = replace
ticket-authoring-editor-replace-all = replace all
ticket-authoring-editor-go-to-line = Go to line
ticket-authoring-editor-go = go
ticket-authoring-editor-current-match = current match
ticket-authoring-editor-on-line = on line
ticket-authoring-editor-replaced-matches = replaced { $count } matches
ticket-authoring-editor-replaced-match = replaced match on line { $line }
ticket-authoring-editor-diagnostics = Diagnostics
ticket-authoring-editor-no-diagnostics = No diagnostics
ticket-authoring-editor-completions = Completions
ticket-authoring-editor-selection-deleted = Selection deleted
ticket-authoring-ticket-yaml = { -ticket(case: "upper") } YAML
ticket-authoring-problems = Problems
ticket-authoring-problems-count = { $count ->
    [0] No problems
    [one] One problem to fix before sending
   *[other] { $count } problems to fix before sending
}
ticket-authoring-problem-line = line { $line }: { $message }
ticket-authoring-submit-question = { $label }?
ticket-authoring-restored = Restored the unsaved YAML this browser kept for this { -ticket }.
ticket-authoring-discard = Discard it
ticket-authoring-fragment-ticket = { -ticket } { $name }
ticket-authoring-fragment-workload = { -workload } { $name }
ticket-authoring-fragment-plan = plan { $name }
ticket-authoring-fragment-landing = { -landing } { $name }
ticket-authoring-fragment-prompt = prompt { $name }
ticket-authoring-fragment-look-through = Look through { $name }
ticket-authoring-fragment-close = Close { $name }
ticket-authoring-fragment-edit = Edit { $name } in this { -ticket }
ticket-authoring-fragment-edit-text = Edit the text of { $name } in this { -ticket }

## What the YAML editor refuses of a text.

ticket-authoring-yaml-one-line = write this as one line of text
ticket-authoring-yaml-list = write this as a list, one entry a line
ticket-authoring-yaml-member = { $refusal } one of { $members }
ticket-authoring-yaml-merge-by = merge by
ticket-authoring-yaml-order-as = order the merge as
ticket-authoring-yaml-land-by = { -landing(form: "base") } by
ticket-authoring-yaml-kind-names-field = a { $kind } names its { $field }
ticket-authoring-yaml-landing-map = write the { -landing } as a map of { $fields }
ticket-authoring-yaml-landing-fields = { -landing(form: "a") } names { $fields }
ticket-authoring-yaml-landing-kind = { -landing(form: "a") } names its kind: one of { $kinds }
ticket-authoring-yaml-none-target = { $none } { -landing(form: "s") } nothing, so it names no target
ticket-authoring-yaml-kind-names-no = a { $kind } names no { $field }; only a { $merge } does
ticket-authoring-yaml-name-one = name one of { $names }
ticket-authoring-yaml-selection-map = write the selection as a map of { $fields }
ticket-authoring-yaml-selection-fields = a selection names { $fields }
ticket-authoring-yaml-dependencies = write the { -ticket(form: "plural") } this one waits for as a list of { -ticket } numbers
ticket-authoring-yaml-dependency = { -dependency(form: "a") } is { -ticket(form: "a") } number
ticket-authoring-yaml-dependency-twice = { -ticket } { $ticket } is named twice
ticket-authoring-yaml-stage-shape = write each { -stage } as `{ $shape }`
ticket-authoring-yaml-stages-max = a program has at most { $count } { -stage(form: "plural") } here
ticket-authoring-yaml-evaluators-max = { -stage(form: "a") } takes at most { $count } { -evaluator(form: "plural") } here
ticket-authoring-yaml-image-unknown = `{ $image }` names no image attached to this { -ticket }; attach images in the form
ticket-authoring-yaml-overrides-shape = write the { -override(form: "plural") } as a map under the { -configuration }'s own field names
ticket-authoring-yaml-plain-key = a key is a plain word
# spells -override: the verb
ticket-authoring-yaml-override-refused = { -ticket(form: "a") } may not override `{ $path }`; it may override { $fields }
ticket-authoring-yaml-workloads-shape = write the { -workload(form: "plural") } as a map, each under the name its { -catalog } holds it under
ticket-authoring-yaml-workload-key = { -workload(form: "a") } is named by a plain word
ticket-authoring-yaml-no-key = this form has no `{ $key }`
ticket-authoring-yaml-keys = write the { -ticket } as keys, one `{ $shape }` a line
ticket-authoring-workload-unknown = the { -catalog } holds no { -workload } `{ $name }`
ticket-authoring-workload-unmapped = write the { -workload } as a map of its fields
# spells -run: runs is the verb, and an execution requirement is a workload's placement, not a run
ticket-authoring-workload-unplaced = { -workload(form: "a") } runs in an image or under an execution requirement; name one
ticket-authoring-workload-removed = { -ticket(form: "a") } replaces `{ $field }` and cannot remove it; write it back
# spells -run: the verb
ticket-authoring-workload-refused = this { -workload } is not one { -ticket(form: "a") } may run

## What each key of a ticket's text means.

ticket-authoring-hint-images = the images attached in the form, by identity: { $bound }
# spells -work-stage: the work in general, not the stage
ticket-authoring-hint-landing = how the finished work { -landing(form: "s") }: its kind, a { $merge }'s mode and policy, and its target where it { -landing(form: "s") } somewhere
ticket-authoring-hint-dependencies = the { -ticket(form: "plural") } this one waits for, by number
ticket-authoring-dependency-candidate = { -ticket } { $ticket }
ticket-authoring-hint-program = the { -evaluation } program: at most { $count } { -stage(form: "plural") }, each judged by the { -evaluator(form: "plural") } it counts
ticket-authoring-hint-overrides = what this { -ticket } replaces of its { -configuration }, each field whole, under the { -configuration }'s own names: { $fields }
# spells -run: the verb
ticket-authoring-hint-selection = what this { -ticket } runs from its { -catalog }: each of { $work }, { $evaluation } and { $finalization } a name the { -catalog } holds, { $configuration } { $pinned } or { $latest }, and each its default where left out
# spells -run: the verb
ticket-authoring-hint-workloads = each { -workload } this { -ticket } runs, as its { -catalog } holds it; a field changed here is this { -ticket }'s own, and a commented skeleton is a field to fill in
# spells -work-stage: the work in general, not the stage
ticket-authoring-hint-selection-work = the { -workload } that does the work
# spells -work-stage: the work in general, not the stage
ticket-authoring-hint-selection-evaluation = the plan whose { -stage(form: "plural") } judge the work
# spells -work-stage: the work in general, not the stage
ticket-authoring-hint-selection-landing = the { -landing } that { -landing(form: "s") } the work
# spells -run: the verb
ticket-authoring-hint-selection-revision = the { -revision } it runs on: the one it was { -release(form: "ed") } on, or the newest
# spells -work-stage: the work in general, not the stage
ticket-authoring-hint-kind = how the finished work { -landing(form: "s") }: merged, proposed, or not at all
ticket-authoring-hint-mode = how a { $merge } advances its target, which only a { $merge } names
ticket-authoring-hint-policy = how a { $merge } is ordered against the others on its target, which only a { $merge } names
ticket-authoring-hint-evaluators = how many { -evaluator(form: "plural") } judge this { -stage }, from one to { $count }

## What a workload written into a ticket's text may say.

ticket-authoring-skeleton-default = { $default } where left out
ticket-authoring-skeleton-in-place = in place of { $field }
# spells -run: the verb
ticket-authoring-placeholder-setup = a command run before the { -workload }
ticket-authoring-placeholder-path = a path in the working directory
ticket-authoring-placeholder-content = its text
ticket-authoring-placeholder-tool = a tool the { -agent } may call
ticket-authoring-placeholder-credential = a credential it may mint
# spells -work-stage: the work in general, not the stage
ticket-authoring-placeholder-motivation = why the work matters
ticket-authoring-placeholder-done = what done looks like
ticket-authoring-placeholder-constraint = what it must not do
# spells -run: the verb
ticket-authoring-workload-runner = how the { -workload } runs: { -agent(form: "a") } briefed with its prompt, or commands the worker runs itself
ticket-authoring-workload-purpose = what the { -workload } is as { -evaluator(form: "a") }; { $default } where left out
ticket-authoring-workload-prompt = what the { -agent } is briefed with: a `{ $path }` to a prompt file the { -catalog } stores, or `{ $text }`
ticket-authoring-workload-path = a prompt file the { -catalog } stores, read as the text its import stored
ticket-authoring-workload-text = the prompt itself, in place of the { -catalog }'s
# spells -run: the verb
ticket-authoring-workload-worker = the { -agent } the { -workload } runs as, and what is installed before it runs
# spells -run: runs is the verb, and an execution requirement is a workload's placement, not a run
ticket-authoring-workload-mode = the { -agent } a worker runs as, or where an execution requirement runs: { $container } on its image, { $capability } on any { -runner } declaring its capabilities
# spells -run: the verb
ticket-authoring-workload-type = how many { -agent(form: "plural") } run the { -workload }
# spells -run: the verb
ticket-authoring-workload-agent = which { -agent } runs the { -workload }
# spells -run: the verb
ticket-authoring-workload-model = the model a { $codex } { -agent } runs
# spells -run: the verb
ticket-authoring-workload-effort = the reasoning effort a { $codex } { -agent } runs at; { $codex }'s default where left out
ticket-authoring-workload-arguments = the { -agent }'s command-line arguments, one a line
# spells -run: the verb
ticket-authoring-workload-setup = commands run before the { -workload }, one a line
ticket-authoring-workload-files = files written into the working directory before the { -workload }, each a path and its content
ticket-authoring-workload-authority = what the { -workload } narrows of what its worker may reach
ticket-authoring-workload-tools = the tools the { -agent } may call
ticket-authoring-workload-credentials = the credentials the { -workload } may mint
ticket-authoring-workload-network = whether the { -workload } may reach the network
ticket-authoring-workload-filesystem = what the { -workload } may do to the filesystem
ticket-authoring-workload-may-complete = whether the { -agent } may complete its { -run }
ticket-authoring-workload-framing = { $framing } wraps the prompt in { -brand-name }'s own role and result wording; left out adds none
ticket-authoring-workload-practices = the practices the { -workload } is held to
ticket-authoring-workload-brief = the claim the { -workload } is briefed with: motivation, acceptance criteria and constraints
# spells -run: the verb
ticket-authoring-workload-commands = the lines a commands { -workload } runs at the { -repository } root
# spells -run: runs is the verb, and an execution requirement is a workload's placement, not a run
ticket-authoring-workload-image = the image the { -workload } runs in, in place of its execution requirement
# spells -run: the verb
ticket-authoring-workload-execution = where the { -workload } runs, in place of its image
ticket-authoring-workload-operating-system = the operating system { -runner(form: "a") } must offer
ticket-authoring-workload-architecture = the architecture { -runner(form: "a") } must offer
ticket-authoring-workload-capabilities = tokens { -runner(form: "a") }'s pool must declare, { -agent(form: "a") } among them as { $token }
ticket-authoring-workload-resources = the CPU and memory the { -workload } is given
ticket-authoring-workload-cpus = whole CPUs
ticket-authoring-workload-memory = memory, in MiB
