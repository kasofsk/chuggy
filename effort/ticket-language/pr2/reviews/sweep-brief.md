# Mutation sweep: PR 2 (three deletions), whole branch

Fresh reviewer; you did not author any of it. Work in
`~/claude/chuggy-wt/three-deletions-sweep`, detached at dd7e1423, the tip
of `model/three-deletions` (`node_modules` linked, Docker running). Read
`.chug/tasks/review-change.md` first, then `GOAL.md` under
`~/claude/chuggy-effort/ticket-language/pr2/`. Verdicts APPROVE / CHANGES /
ESCALATE. Revert every scratch mutation with `git checkout -- .`; commit
nothing. PR 1's `../reviews/sweep.md` is the shape and the bar.

Scope: `git diff 617675bb...dd7e1423`. Prior rounds (`reviews/S-round1.md`,
`A-round1.md`, `B-round1.md`, `B-round2.md`) reviewed the pieces; do not
repeat them. This round is the sweep: for each behaviour the branch adds or
changes, mutate the code and find the test that goes red. A behaviour no
test can redden is a finding; a test that stays green under a mutation it
names is a finding. A sweep round ships unless it finds a behaviour
defect, so separate "unpinned" from "wrong".

Mutate at least, one at a time, recording what went red (or did not):
- `model/domain.qnt`: `decideRevoke` parking a Pending dependent again;
  the passing final stage completing outright instead of entering
  Finalizing; `combine` as any-pass — which of check-model, the goldens,
  check-conformance, check-random redden.
- `src/domain/`: the same three in TypeScript; `revocableIn` refusing
  Pending.
- `src/actor/decisionSemantics.ts`: each semantics-4 refusal (ticket-done
  from a non-Finalizing phase; ticket-revoked with two transitions)
  removed; the ≤3 dropped-key acceptance made strict.
- Finalizer: `None` reporting Failed; `None` still calling the forge;
  the default landing resolving to `None` instead of the repository's.
- The ticket read: `revokedDependencies` without the Pending predicate;
  unordered; listing Done deps.
- Stored operation decode: the `ExecutionBlocked{DependencyRevoked}`
  refusal removed.
- Migration 005: each guard arm removed (six); the settled-row arm
  widened to Open; the program rewrite skipped; the NULL→None rewrite
  skipped; a landing-mode CHECK left without 'None'; the session_turn
  re-render skipped; `decision_event_is_valid` admitting NoFinalizer.
- Contract: a stage on the wire carrying `combinator`; `finalizer` on
  the ticket read; `DependencyRevoked` back in `escalationReasons`;
  `briefFinalizationProposes("None")` true.
- Console (`ui/chuggy-ui`, sonnet-authored, orchestrator-reviewed):
  `revokedDependencyLine` plural/singular; the landing picker missing
  None; a stage label drawing a combinator; the Repository page's deleted
  Finalizer panel. Read `tasks/C-report.md`'s judgment calls and say
  whether any is wrong.
- Fabric alignment: `.chug/configurations/*.json` and the fabric's
  ticket-service config carry nothing the new parser refuses (grep for
  finalizer/combinator).

Then the docs, once: every comment the branch touches read against the
code beside it; a comment describing something the branch removed, or
stating a quantity, is a finding with file:line. Line-joined grep for the
twelve deleted names across the whole tree including `ui/` and `.chug/`.
`check-figures`, `check-comments`, `check-paths` results included.

Attribution: commits f78a96de/e6912751 (S) carry a different
Co-Authored-By; note, not a finding.

Write `~/claude/chuggy-effort/ticket-language/pr2/reviews/sweep.md`:
verdict first, a table of mutation → what went red, findings (file:line,
input, effect), then unpinned behaviours separately.
