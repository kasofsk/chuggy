# Agent guide

Read `CLAUDE.md` in full before changing this repository. It is the entry point
for the model-first architecture, local conventions, and required checks.

- `model/` is the specification; when model and implementation disagree, the
  implementation is wrong.
- Read `.chug/tasks/review-change.md` before authoring or reviewing a change.
- Install with `npm ci`; install hooks once with `just hooks`.
- Run focused checks while working and `just check` before handoff. Exit 2 from
  a gate means it could not run, not that it passed.
- Do not deploy, restart infrastructure, reset data, or otherwise act
  destructively without explicit approval.

Nested `AGENTS.md` files contain only guidance specific to their subtree.
