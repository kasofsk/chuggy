# The git wrap-up

**Status: PROPOSED** — kasofsk/chuggy#72 is the ticket.

For a ticket wrapping up exclusively, the gate is the merge. The model's lease is occupancy of the holding phase; the attempt's only honest home is under it, and the environment's dequeue draw is refined accordingly.

## Always moved

The dequeue with `moved` false completes the ticket in the same decision — before any physical attempt could run — so a deployment performing a real merge always draws it true and lets the gate carry the attempt. Always-true is a legal refinement of the invalidation draw, and it keeps the invariant that failure is drawable only against an invalidated artifact trivially satisfied.

## The attempt

The performer holds a scratch mirror on the dispatcher's own volume: fetch, merge by plumbing against the branch the mark re-forms, and one atomic push with the sole credential allowed to move a default branch — the repositories themselves live behind the git service (doc 013), which serves bytes and enforces ref scope while deciding nothing. The outcome returns through `src/interpreter/inbound.ts`. A conflict is not an error: it is the failed outcome the wrap-up economy already prices, re-entering rework or parking on the exhausted budget exactly as the model states. Authorship is the ticket's author; the committer and the signature are the machine's, because a job or a merge that could hold a person's signing key could sign as that person.

## Idempotence and recovery

A re-run attempt that finds its candidate already an ancestor of the target reports success without touching a ref, which is how a re-delivered gate instruction re-answers rather than re-merges; a duplicate resolution is refused by enablement. A crash mid-gate is answered by the boot re-drive (doc 006); a genuinely wedged gate is an operator's resolution or a revocation, and because the lease is derived from phase, every exit frees it. No lease timeout exists in this design, and the pre-named trigger stands: the day the attempt leaves the process, the crash seam stops being writable as a function, and that day is a model commit rather than an adapter patch.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R6 | The performer: mirror, gate merge, conflict pricing, idempotence | #66, #68 | Proposed |
