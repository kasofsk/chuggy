# PR 8b — review ledger (branch `model/ticket-events`)

| round | tip | reviewer | verdict | fix |
|---|---|---|---|---|
| 1 machine | cf829352 | opus, fresh | CHANGES: legality docs claim "exactly owed" (theorem 1 et al.) where the check is sound for decided rows only and re-checks no guard; the work-failure evolve arms are stricter than the package's (cycle must match) but described as arm-for-arm; note: decisionValid is sound not complete on the model side | orchestrator in-line de28c424 (docs only) |
| 1 boundary | cf829352 | opus, fresh | CHANGES: 014's evidence predicates (finalization facts, work failures) unpinned — deleting either left migration.test green; 014 header claimed the branch wipe script empties the journal (false before 014: FK); readiness.ts deferral comment untrue when the remote recovers; two stale continuation test comments; `deferred_since` written, never read. Runtime sound throughout (identities, grouping, desk, deferral bound, trigger, codec spot-check, render-diff, finalization evidence) | orchestrator in-line e42da9bf: four refused rows red-proved (both predicates deleted → red), headers and comments, `deferred_since` dropped from 014 |

## Build

- A landed 2acfe7a7 (`tasks/8b/A-report.md`); S landed 727b62d2 (`S-report.md`); merged 469425c8.
- B landed cf829352 (`tasks/8b/B-report.md`); B's gate table clean but for the machine's playwright baseline.

Tip for round 1: cf829352.
- Round 1 fixes: de28c424 (machine docs), e42da9bf (boundary). migration.test 118/118 and sourceDeferral 2/2 on a fresh prepare; check-queries 0.
- Affected roster at e42da9bf (`pr8/ci-affected-8b-round1.log`): every gate clean but check-source static — typecheck/lint the playwright baseline, and one Prettier miss in migration.test.ts (fixed 65cfcade).

Tip for the full roster and merge: 65cfcade.
- Full roster at 65cfcade (`pr8/ci-full-8b-65cfcade.log`): every gate clean, check-model 0 failures / 122 tests; the only red is the 120s shell-suite budget. The eight suites it skipped, run alone (`ci-full-8b-65cfcade-suites.log`): all rc 0 except `deploy-to-gtr.test.sh`, whose `sed -i` (test.sh:280) is GNU-only — pre-existing, the script's own `rewrite()` is portable; with a `sed -i` → `sed -i ''` shim it is 125/125. (A first full run was void: an `npm install` in `test/rig` replaced the worktree's node_modules symlink — root `package.json` has `test/rig` and `ui/chuggy-ui` as workspaces; fixed by a root `npm ci` in the worktree.)
