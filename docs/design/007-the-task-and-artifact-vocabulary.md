# The task and artifact vocabulary

**Status: PROPOSED** — kasofsk/chuggy#70 is the ticket. The wire half, `src/interpreter/artifact.ts`, landed with #66; what follows is the unbuilt rest.

## A task type is deployment configuration

A ticket names a task type, and the type names everything the fabric needs to run it: the work image and command, the evaluation image and command, resources, and the deadline and relaunch limit the model's trusted fabric axioms require. The catalog of types is configuration the composition root parses — never content of the project's own repository, because a spec a work branch could rewrite is work granting itself capability, which the authority split's node-local tier forbids. A repo-carried evaluation *command* is a different thing (`.chug/tasks/ci.sh` is the one this repo's tickets will name): it runs inside the sandbox the spawn granted and decides nothing about grants.

## Storage and hand-off

A declaration's body is world state, stored beside the journal under the completing task's identity, first write kept — the same first-write-wins the domain applies to completions, so no ordering is invented at this seam. Evaluation installs the work artifact and never rebuilds it: a branch body is installed by cloning at the name the mark re-forms, prose is fetched from the record, and nothing installs nothing. The producing task of a mark is a pure function of the journal, so nothing stores it (standing rule 3).

## One task per cycle

The first deployment fixes the work fan-out and every evaluation stage's fan-out at one. That is a configuration choice, not a model change, and what it buys is the absence of a combination question: several artifacts from one cycle have no combinator vocabulary, and inventing one before any ticket needs it is exactly the spec silence an implementation then fills by invention. Refutation trigger: the first ticket that genuinely needs a wider fan-out writes the combination convention into `src/interpreter/artifact.ts` first, as its own change.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R4 | The stored declaration, the completion route, the hand-off into evaluation | #69 | Proposed |
| R5 | The catalog and its parse | #68 | Proposed |
