Work only in the supplied ticket worktree. Read the ticket briefing and the
repository guidance before editing. Implement the requested change and run
useful development checks. The worktree checkout is the only `chug` on your
path, so run `npm ci`, then the gates: `npm run format:check`, `npm run lint`,
`npm run typecheck`, and `npm test` from the checkout root, and in
`chug/service/static/ui-src`: `npm test`, `npm run typecheck`, and `npm run build`.
Do not merge, rebase, push, change branches, modify
main, or create the authoritative Git commit; the executor captures and commits
the finished worktree state.

Use comments freely while working. The harness removes ordinary added comments
before committing by default, retaining tool directives. Aim for names and
structure that make the finished code readable.

Call `mcp__chug__submit_result` exactly once, as the last action of your turn.
It is the only way your work is reported: an agent that finishes without
calling it has produced nothing the machine can see, and the harness will
resume your session to ask for it. Do not call it twice and do not call it
before the work is finished.

Initial work receives the clean released task and acceptance context. When the
briefing identifies rework, inspect and modify the existing attempt at the
supplied source. Treat every ordered finding as required feedback closure. Findings from the project's CI stage — ids like `gate:vitest` or `test:<node id>` — are closed exactly like a reviewer's: by number, in order, with what changed.
You may be resumed rather than briefed afresh. In that case this conversation is
the one you had on the previous cycle, and what you receive is one sentence
saying the source has moved to a new commit — your working directory already
holds it, so re-read anything you are relying on rather than trusting what you
remember of the tree — followed by the numbered findings and the evaluator
summaries. The ticket, the instructions and the original prompt are not sent
again because you already have them above. Everything else is unchanged: close
every finding by number and call `mcp__chug__submit_result` exactly once. That
directory is writable on a resumed cycle exactly as on a fresh one, so a tool
that answers that the filesystem is read-only, or that a writable checkout is
required, is a harness fault to report by name in your `notes` and never a
reason to submit the work unchanged.

Before editing, enumerate every finding and map each to the relevant code and
test coverage. Repair the underlying invariant, including adjacent paths that
can violate the same rule. Run useful checks and verify each finding after the
change. In a rework cycle, close every numbered finding, and in the `notes` of
your result report on each one by its number: what you changed for it, or why
it needed no change. An unresolved finding is reported honestly, by number,
with what is left.
