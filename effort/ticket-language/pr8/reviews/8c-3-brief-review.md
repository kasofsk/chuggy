# Review — migration 017 "the ticket service may re-pin" (branch `model/repin-grant`, base ccbf0c38)

Setup: `_review-setup-8c-2.md` beside this file (part of this brief), with base ccbf0c38 and the branch tip from `git rev-parse origin/model/repin-grant`. Own postgres on 55452; remove it after.

Context: release ccbf0c38 wedged the rig's partition on the first `UpdateTicket`: `decisionRepin` (`src/adapters/postgres/decision.ts`) updates `ticket_projection.configuration_revision/digest`, and 016 granted the ticket service `UPDATE(revision)` only. Every durable suite ran the writer on the owner pool, so no test could see it. The rig was (or will be) hotfixed by hand with the same grant. The builder's report is in `pr8/GOAL.md`'s last lines. Two commits: 49f21d3c (017 + migration cases), a6e750c8 (harness runs decisions as the ticket-service role, inbox as api).

Check, each with a failure that actually happens:
1. 017 is correct and idempotent against a hand-granted database; render-diff 001–016 empty; the api role gains nothing.
2. The harness change: does every writer path the deployed ticket service runs now run under its role in the suites? What still runs as owner that production runs as a narrower role — name any path where a missing grant would still hide, with the production role. Is `-c role=` equivalent to the login for privilege purposes (default privileges, `SET ROLE` restrictions, RLS)?
3. Now that suites run least-privilege: any other grant 016 (or earlier) missed that production would hit on another path (release, dispatch, retry, finalization, restore/replay)? Grep the writer's SQL against the ticket-service grants.
4. The deleted case in `authoring.test.ts` — truly subsumed?
5. Gates, one at a time: check-source (test/rig playwright baseline), check-postgres, check-queries, check-boundaries, check-paths, check-comments, check-duplication.

Verdict: APPROVE or CHANGES; findings with file:line, input, what goes wrong; under ~35 lines.
