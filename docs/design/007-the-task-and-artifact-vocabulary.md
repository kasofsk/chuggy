# The task and artifact vocabulary

**Status: R4 LANDED** — the vocabulary, the stored declaration and the completion route are in the tree; kasofsk/chuggy#71 carries the task-type catalog and the install into evaluation, which are not.

## A task type is deployment configuration

A ticket names a task type, and the type names everything the fabric needs to run it: the work image and command, the evaluation image and command, resources, and the deadline and relaunch limit the model's trusted fabric axioms require. The catalog of types is configuration the composition root parses — never content of the project's own repository, because a spec a work branch could rewrite is work granting itself capability, which the authority split's node-local tier forbids. A repo-carried evaluation *command* is a different thing (`.chug/tasks/ci.sh` is the one this repo's tickets will name): it runs inside the sandbox the spawn granted and decides nothing about grants.

## The install into evaluation

Evaluation installs the work artifact and never rebuilds it: a branch body is installed by cloning at the name the mark re-forms, prose is fetched from the record, and nothing installs nothing.

## One task per cycle

The first deployment fixes the work fan-out and every evaluation stage's fan-out at one. That is a configuration choice, not a model change, and what it buys is the absence of a combination question: several artifacts from one cycle have no combinator vocabulary, and inventing one before any ticket needs it is exactly the spec silence an implementation then fills by invention. Refutation trigger: the first ticket that genuinely needs a wider fan-out writes the combination convention into `src/interpreter/artifact.ts` first, as its own change.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R4 | The stored declaration, the completion route, the per-job token | #69 | **Landed** |
| R5 | The catalog, its parse, and the install into evaluation | #68 | Proposed |
