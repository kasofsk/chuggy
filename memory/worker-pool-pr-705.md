---
name: worker-pool-pr-705
description: Dave's worker-pool PR #705 (pull-based pool plane beside main's push AttemptPlacementPort) reviewed 2026-09-20; fixes in PR #711 against dc/worker-pool; open policy question on pool forge credentials
metadata:
  type: project
---

PR #705 (branch dc/worker-pool, Dave + Opus, 2026-09-20) adds a pull-based
worker-pool subsystem per issue #687: pool plane process, registration tokens,
Hydra client minting, Keto `pools` relation, migration 002, and a
`WorkerPoolBackend` seam with Kubernetes as the one implementation. It does
NOT abstract main's existing push path (`AttemptPlacementPort` +
`workerLaunch.ts`); nothing routes work to a pool yet and the scheduler never
opens a Placing attempt for placement='Pool'.

Three fresh reviewers all returned CHANGES; PR #711 (fix/worker-pool-review,
21 commits) fixes them against dc/worker-pool after four further review
rounds. Verdict and file:line list under
~/claude/chuggy-effort/pr-705-review/. Follow-ups filed: #706 harness
task-fetch route, #707 pool_refusal terminal, #708 launcher fold onto
kubernetesWorkloadPod, #709 re-register leaks Hydra client, #710 client drops
Denied settlement.

**Open for Geoff:** a pool principal holds Execute + API audience and can mint
forge credentials for any bound repo with no work in hand; README says chosen,
contract header says credentials never leave the orchestrator. Asked on #705.

**How to apply:** when #711 merges into dc/worker-pool, #705 still needs its
own merge to main (I have merge authority per [[merge-authority-2026-08-31]]);
re-run full ci.sh on the merged result first ([[sibling-pr-integration-gate]]).
Suites here are node:test, not vitest; `node --test <file>`.
