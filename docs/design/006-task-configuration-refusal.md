# Task configuration and prompt briefing

**Status: PROPOSED** — this is a direction for the first task configuration
consumer, not a renderer, a prompt catalogue, or a claim that release-time
validation exists.

A ticket eventually asks agents to implement a change and to review it. Each
task needs two kinds of instruction: the stable responsibilities of its role,
and the ticket's reason, acceptance criteria and constraints. The latter must
be shared by builder and reviewer so the review tests the work against the same
claim the work set out to satisfy.

## Templates own a role; ticket data fills known slots

One plausible first vocabulary has two task purposes: `Code` and `Review`.
Each would receive a template owned by the implementation, rather than a
user-assembled sequence of functions. The code template would carry the
standing expectations for implementation and verification; the review template
would carry the standing expectations for inspecting a change and reporting its
result. This does not choose their wording yet.

For example, a shared ticket brief could carry motivation, acceptance criteria,
constraints, and blessed practices. Purpose-specific configuration could carry
implementation instructions for code and review focus for review. Runtime facts
would come from the adapter: workspace, changed files and an earlier agent's
handoff. They would not be authored prompt text, and would not enter the core.

The templates could render those values in a fixed order:

1. Role instructions.
2. Why the ticket matters.
3. Acceptance criteria and constraints.
4. Purpose-specific instructions or review focus.
5. Practices that apply to this purpose.
6. Runtime context.
7. The required result.

Empty optional sections disappear, but their neighbours do not reorder. This
keeps a prompt inspectable and makes a task's configuration small enough to
validate as ordinary data.

## Practices are a finite policy, not arbitrary code

A blessed practice could carry an instruction and whether it applies to `Work`,
`Review`, or `Both`. For example, a work-only practice might concern regression
coverage; a review-only practice might concern changed call paths; and a shared
practice might concern acceptance criteria. The vocabulary should grow only
when a repeated real need earns a new member.

Tools, permissions and authority do not belong in this composition. A prompt
may ask an agent to run tests, but structured task policy decides what it may
actually run. Letting a later prompt block widen a permission an earlier one
narrowed would make authority depend on prose and leave the executor nothing to
enforce.

## Where refusal belongs remains an integration decision

Names, shapes and practice scopes that can be checked from task configuration
alone should be parsed before a ticket is released. A prompt that is empty only
after it reads the runtime view is an execution outcome, and the consumer must
turn it into a task failure rather than throw through a layer.

The current core journals `decideRelease` before the fabric adapter is called.
An adapter therefore cannot, by itself, refuse release-time configuration: the
future integration must name a pre-release validation boundary, or change the
command contract to carry validation. This is deliberately not claimed as
landed here.

Likewise, any failure trace needs an explicit retention and redaction policy
before it is handed to a desk or persisted. Intermediate prompt text can be
large or contain ticket-sensitive material.

## When a pipeline would be earned

The renderer may internally be a sequence of fixed blocks, but there is no
general registry of named transforms. A generic pipeline becomes worth adding
only when several independently owned prompt vocabularies or reusable optional
blocks prove that the two templates are the wrong ownership boundary. Until
then, exhaustive task-purpose templates are simpler to parse, test and review.

## Landing

| # | What lands | Where | Status |
|---|---|---|---|
| B1 | Typed code and review templates, shared ticket brief, scoped practices, and runtime slots | `src/briefing/` <!-- intent --> | Proposed |
| B2 | Concrete task configuration schema and a pre-release validation boundary | task authoring and command path | Proposed |
| B3 | Runtime empty-prompt outcome and bounded/redacted diagnostics | fabric consumer | Proposed |
| B4 | Move briefing under the adapter that actually consumes it | `src/adapters/` <!-- intent --> | Proposed |
