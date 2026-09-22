# Review — fix/draft-authoring-vocabulary (a013a48d, one commit off main e5f7b3d3)

You did not write this change. Review it fresh, against `.chug/tasks/review-change.md`, in a detached worktree of your own:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/draft-vocab-review a013a48d
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/draft-vocab-review/node_modules

Never run `npm ci` under `ui/`. Diff: `git -C ~/claude/chuggy-wt/draft-vocab-review diff e5f7b3d3..a013a48d`.

## What it claims

PR #723 (the rename, decision semantics 5) lifted every stored journal row through `rowAtCurrentVocabulary` before the codec, but `draft_revision.authoring` — the text a draft retains, which is the `CreateTicket`/`ReleaseTicket` event its release journals — was parsed by `parseDraftAuthoring` at the current vocabulary with no lift. Every draft authored before the deploy says `ReleaseTicket`, so on the rig `GET /drafts/:ticket`, the drafts page and `ReleaseDraft` (via `readiness.ts`) all threw a TypeError that `failureResponse` maps to 400 InvalidRequest. The fix extracts `eventAtCurrentVocabulary` from the row lift, has the row lift call it, adds `parseStoredDecisionEventText` in wire.ts, and reads the draft through that. Client bytes (`parseDecisionEventText`, `parseTicketCommand`) are unchanged. One test added.

## What to check

1. Is the row lift behaviourally identical to before the extraction? Every existing `rowAtCurrentVocabulary` test and the frozen fixtures `test/actor/journalAtSemantics*.json` must still pass: `node --experimental-strip-types --test test/actor/*.test.ts test/interpreter/*.test.ts`. One subtle point: the old code spread `event` only when it was an object; the new code spreads `event: eventAtCurrentVocabulary(row["event"])` when `"event" in row`. Is there a row shape where that differs observably?
2. Is there any OTHER stored text that holds a superseded spelling and is parsed at the current vocabulary without a lift? Grep for every reader of stored JSON/text: `decision_input.command` (`parseTicketCommand` — a Decide queued before the deploy), `native_action`, `finalization_request`, `project_continuation`, `deployment_authoring_policy`, anything in `src/adapters/postgres/*.ts` that calls `JSON.parse` or a `decode*`/`parse*` on a column. Name any you find with the column and the reader; do not fix them.
3. Mutation-test the fix: make `eventAtCurrentVocabulary` a no-op and confirm the new test reddens; make `parseDraftAuthoring` call `parseDecisionEventText` again and confirm it reddens. Revert both.
4. Comments: are the doc comments true, concise, in the tree's voice, no quantity claims (`check-figures`), no stale path claims?

Write the verdict to `~/claude/chuggy-effort/ticket-language/pr3/fix-draft/review.md`: APPROVE or CHANGES, each finding naming a failure that actually happens (file:line, what input, what goes wrong). Under ~50 lines. Remove your worktree when done: `git -C ~/claude/chuggy worktree remove --force ~/claude/chuggy-wt/draft-vocab-review`.
