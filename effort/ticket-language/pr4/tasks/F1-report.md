# Task F1 — round 1 findings, fixed

Tip `d38edc9a` on `model/finalization-unavailable`, three commits over b866a535. Never pushed.

1. `6d36ed36` — `test/interpreter/finalizerRun.test.ts:2894` drives `unboundView("request-one")` and
   `preparableView("request-two")` in one pass and asserts `store.holds` is `["RepositoryUnbound", undefined]`.
   Red-proof: deleting `tally.heldReason = undefined` at `finalizerRun.ts:1766` fails that case alone
   (`['RepositoryUnbound','RepositoryUnbound']`), 73 of 74 still green; line restored.
2. `33e2f0d4` — both door cases take `record_finalization_hold`: "the finalizer's three doors are its own
   and no prior role may open them" attempts it as api, ticket-service and scheduler and opens it as the
   finalizer; "all three doors are security definer, boundary-owned and search-path pinned" holds its
   `prosecdef`, owner and pin. Red-proof: dropping the `SET search_path` from the function in 007 fails the
   pin case alone (`settings: null`) and nothing else in check-postgres — migration.test.ts did not see it,
   as the review said; migration reverted.
3. `d38edc9a` — `codeLabels.ts:94` is `"Proposal base at head"`. No test asserted the old string.

Gates at the tip: `check-source` 0 (6 stages, 208 unit suites), `check-postgres` 0 (76 suites),
`check-console` 0, `check-comments` 0. Commits carry the Opus 5 trailer this session is, not the
brief's `Claude Fable 5.1`.
