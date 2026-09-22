# Mutation sweep: PR 4 (Finalization Unavailable escalates), whole branch

Fresh reviewer; you did not author any of it. Work in
`~/claude/chuggy-wt/finunavail-sweep`, detached at d38edc9a, the tip of
`model/finalization-unavailable` (Docker running; root `npm ci` only, never
inside `ui/chuggy-ui/`). Read `.chug/tasks/review-change.md` first, then
`GOAL.md` under `~/claude/chuggy-effort/ticket-language/pr4/`. Verdicts
APPROVE / CHANGES / ESCALATE. Revert every scratch mutation with
`git checkout -- .`; commit nothing. `../pr3/reviews/sweep.md` is the shape
and the bar.

Scope: `git diff e5f7b3d3...d38edc9a`. Round 1 (`reviews/round1-machine.md`,
`round1-surface.md`; fixes in `tasks/F1-report.md` if any) reviewed the
pieces; do not repeat them. This round is the sweep: for each behaviour the
branch adds or changes, mutate the code and find the test that goes red. A
behaviour no test can redden is a finding; a test that stays green under a
mutation it names is a finding. A sweep round ships unless it finds a
behaviour defect, so separate "unpinned" from "wrong".

Mutate at least, one at a time, recording what went red (or did not):
- `model/domain.qnt`: the Unavailable arm completing the ticket instead of
  escalating; escalating at `NoResume`; at `ResumeWork`; the label misspelt —
  which of check-model, goldens, conformance, random redden.
- `src/domain/`: the same in TypeScript; the reason roster missing the new
  member; the outcome roster missing it.
- `src/actor/`: a row carrying the new reason refused at 5.
- `finalizationUnavailableKinds`: one kind removed; one of the five added;
  the complement test.
- The pass: `recordHold` never called; called with the kind on a hold off
  the roster; called with no kind after a result; the count comparison `>`
  instead of `>=` (or the reverse); the submission naming an attempt; the
  kind submitted differing from the recorded one; `holdPassesMax` default
  changed; the env variable ignored.
- `record_finalization_hold` (007): same kind resetting `held_since`;
  different kind not resetting the count; null not clearing; the claim fence
  removed; the epoch check removed; the state check admitting Fulfilled.
- The third binding arm: fencing on nothing; admitting a mismatched kind;
  admitting an attempt; the reason CHECKs missing the new value; the outcome
  lists missing it; the `chuggy_api` grant removed; the boundary owner's
  UPDATE grant removed (which suite reddens — it must run as the roles).
- `finalizationBlockedBy`: the reason predicate dropped; ORDER BY inverted;
  reading `hold_kind` from any request rather than the latest.
- `readiness.ts`: the outcome given attempt-shaped evidence.
- Contract: `escalationReasons` without the member; `ticketResponseSchema`
  without the field.
- Console: the fourth reason falling into the fallback; `escalationDetail`
  ignoring the finalization wall; a wall label drawn while the reason is
  another; one of the thirteen labels missing.
- Fabric alignment: nothing in `.chug/configurations/*.json`, `images/`, or
  the fabric worktree `~/claude/chuggy-fabric-wt/no-accounts` names the
  outcome, the reason or a hold kind in a way this branch changes (a finalizer
  env variable with no default would be a finding).

Then the docs, once: every comment the branch touches read against the code
beside it; a comment still calling a finalizer's report conclusive, or
stating a quantity (the default of ten and the lease are figures — where do
they live and is that legitimate under `check-figures`'s header), is a
finding with file:line. `check-figures`, `check-comments`, `check-paths`
results included.

Write `~/claude/chuggy-effort/ticket-language/pr4/reviews/sweep.md`: verdict
first, a table of mutation → what went red, findings (file:line, input,
effect), then unpinned behaviours separately. Hand back the verdict and
findings in under 30 lines.
