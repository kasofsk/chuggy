# Task configuration and prompt briefing

**Status: PROPOSED** — the ownership and integration decisions are settled
here; the renderer, schemas and adapters are not built yet.

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

## Release pins one validated configuration revision

Names, shapes and practice scopes that can be checked from task configuration
alone are validated by the dispatcher runtime while it handles `Release`,
before it journals the domain's `Release` decision. Validation is not an API
preflight and not a fabric-adapter concern: either would race a later Draft
edit or discover an invalid configuration after the ticket entered the
pipeline.

Draft configuration lives as immutable revisions in the authoring store. A
release request names the revision it observed. At the dispatcher's serialized
position, one transaction verifies that the ticket is still a Draft, checks
that the named revision is current, parses and validates it, and pins its
revision and digest beside the released ticket projection. Only then does the
runtime invoke the pure `Release` decider and commit its journal entry. A stale
revision or invalid configuration refuses the operation without a domain
event; released tickets cannot acquire another revision.

This validation surrounds the model rather than enlarging it. Task
configuration changes neither a ticket transition nor the termination
measure, and the model-level effect remains nullary.

## Execution reads the pinned revision

When a journaled decision creates logical tasks, the concrete effect outbox is
materialized from that decision's exact post-state. It names the decision and
effect position, ticket, logical task identities and kinds, stable capacity
account, and the pinned configuration revision and digest. The model does not
gain those transport fields.

The fabric consumer reads that immutable revision and renders the purpose-owned
template with runtime facts. It never reads an unversioned moving ticket row.
Redelivery therefore describes the same executions and the same briefing even
after later ticket decisions, and partial batch registration can safely fill
only the missing logical task identities.

## A runtime refusal is a task outcome with bounded diagnostics

A prompt that is empty only after runtime facts are applied is an execution
outcome, not a release-time schema error. The consumer resolves the logical
task failed through the normal durable completion path; it does not throw
around the ticket lifecycle.

The retained diagnostic is structured and bounded: outcome code, template
version, configuration revision and digest, section identifiers and sizes, and
a sanitized message truncated at a configured byte ceiling. Rendered prompts,
runtime source material, credentials and arbitrary exception objects are not
persisted or handed to the desk. Operators may inspect sensitive material only
through an explicitly authorized, short-lived diagnostic path whose access is
audited. Redaction happens before the completion outbox or desk record is
written.

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
| B2 | Revisioned task configuration schema and serialized release validation | authoring store and dispatcher runtime | Proposed |
| B3 | Version-pinned execution payload, runtime outcome and bounded/redacted diagnostics | effect outbox and fabric consumer | Proposed |
| B4 | Move briefing under the adapter that actually consumes it | `src/adapters/` <!-- intent --> | Proposed |
