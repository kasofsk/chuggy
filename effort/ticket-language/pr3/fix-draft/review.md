# Review — fix/draft-authoring-vocabulary (a013a48d, one commit off e5f7b3d3)

## APPROVE — no findings

Reviewed fresh in a detached worktree at a013a48d. Nothing found names a
failure that actually happens.

**1. The row lift is behaviourally identical.** The only semantic change is the
guard: `objectFields(row["event"]) !== undefined` became `"event" in row`. I ran
the old body and the new one side by side over 19 row shapes — `event` absent,
`null`, `undefined`, a number, a string, an array, an array of events, an event
with `reason`/`out`, and a row whose key order puts `event` in the middle — and
the two agree on value and on key order everywhere. They can only differ if
`event` is inherited or non-enumerable, and `JSON.parse` — the sole producer of
these rows, at `journal.ts:326` and `wire.ts:352` — yields neither.
`node --experimental-strip-types --test test/actor/*.test.ts
test/interpreter/*.test.ts`: 1231 pass, 0 fail, frozen
`test/actor/journalAtSemantics*.json` among them.

**2. No other stored text is read at the current vocabulary without a lift.**
006 rewrote the four constrained columns in place (`ticket_projection` phase,
reason and resume point, `native_action.reason`,
`project_continuation.expected_phase`), so their readers need none. Of what it
left at the old spelling: `journal_entry.entry` goes through
`parseStoredEntry` → `rowAtCurrentVocabulary`; `execution.blocked_reason`
reaches the writer inside a `Decide`/`ExecutionBlocked` envelope and is lifted
by `storedSchedulerCompletion` (`wire.ts:352`); a `SubmitFinalizationResult`
outcome is lifted by `checkedFinalizationSubmission` (`wire.ts:304`). The rest
of `decision_input.command` falls through to `parseTicketCommand` unlifted, and
that is sound rather than lucky: the public set it admits is `Decide` over
`Revoke`/`Dispatch`/`ResumeTicket` (a ticket number), `ReleaseDraft`,
`ResolveNativeAction` and `ProposeDispatch` (read at `selector.ts:415`), none of
which spells a renamed word in any field. `nativeReads.ts` matches the release
row on `IN ('ReleaseTicket','CreateTicket')` and projects only `deps`. The
remaining `JSON.parse` columns in `src/adapters/postgres/` are configurations,
dispatch programs, briefs and session notes, which hold no vocabulary.
`draft_revision.authoring` was the one gap, and both of its readers
(`authoring.ts:229`, `readiness.ts:173`) go through the fixed
`parseDraftAuthoring`; the release it feeds journals a freshly built event, so
nothing re-writes the old tag forward.

**3. Mutations kill it.** `eventAtCurrentVocabulary` returning `raw`: the new
test fails, and so does one actor test (38/39) — the row lift really does run
through it. `parseDraftAuthoring` back on `parseDecisionEventText`: the new test
fails alone. Both reverted; `git status` clean. The test's own
`assert.notEqual` guards the `replace` against silently doing nothing.

**4. Comments hold.** `check-comments`, `check-figures`, `check-paths`,
`check-source`, `check-boundaries`, `check-duplication` and `check-knowledge`
all exit 0 at this commit. The prose is true: `draft_revision` exists and keeps
the release event, and the only count ("the two payload fields") is enumerated
by the lines under it and predates this change.
