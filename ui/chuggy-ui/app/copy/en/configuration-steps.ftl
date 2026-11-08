## What a ticket runs with, a row per step under a row per phase:
## `app/core/configurationSteps.ts`, `ConfigurationSteps.tsx`.

configuration-steps-col-step = Step
configuration-steps-col-runs = { -run(case: "upper", form: "plural") }
configuration-steps-col-model = Model
configuration-steps-col-overrides = { -override(case: "upper", form: "plural") }
configuration-steps-overridden = overridden on this { -ticket }
configuration-steps-prompt = Prompt
configuration-steps-prompt-view = View prompt
configuration-steps-prompt-hide = Hide prompt
configuration-steps-yaml = YAML
configuration-steps-model-default = Default
configuration-steps-following-pinned = Pinned
configuration-steps-following-latest = Latest
configuration-steps-default = default
configuration-steps-chosen-default = { $name } · default
configuration-steps-plan = plan { $name }
configuration-steps-review = Review
configuration-steps-side-by-side = { $count } side by side

## A step's details, each by the name it is drawn under.

configuration-steps-agent = { -agent(case: "upper") }
configuration-steps-model = Model
configuration-steps-arguments = Arguments
configuration-steps-effort = Effort
configuration-steps-commands = Commands
configuration-steps-cpus = CPUs
configuration-steps-cpu-count = { $count ->
    [one] { $count } CPU
   *[other] { $count } CPUs
}
configuration-steps-memory = Memory
configuration-steps-memory-mib = { $mib } MiB
configuration-steps-setup = Setup
configuration-steps-files = Files
configuration-steps-practices = Practices
configuration-steps-image = Image
configuration-steps-runner = { -runner(case: "upper") }
configuration-steps-purpose = Purpose
configuration-steps-authority = Authority
configuration-steps-framing = Framing
configuration-steps-brief = { -brief(case: "upper") }
configuration-steps-run-requirement = { -run(case: "upper") } requirement
configuration-steps-tools = Tools
configuration-steps-credentials = Credentials
configuration-steps-access = Access
configuration-steps-completes-run = Completes { -run }
configuration-steps-yes = Yes
configuration-steps-no = No
configuration-steps-policy = Policy
configuration-steps-approval = { -approval(case: "upper") }
configuration-steps-required = Required

## A version 1 work's prompt, by part.

configuration-steps-motivation = Motivation
configuration-steps-acceptance-criteria = Acceptance criteria
configuration-steps-constraints = Constraints
configuration-steps-instructions = Instructions
