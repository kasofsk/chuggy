---
name: rollout-chain-resolves-main-at-run-time
description: A rig build-request ticket files a request for main as it stands when it runs, and the rollout ticket after it resolves main again when IT runs; merging anything to chuggy main between the two strands the rollout (ticket 84, 2026-09-21)
metadata:
  type: project
---

The fabric's dogfood release chain is two tickets: `fabric-change` runs
`scripts/request-build --repository-id chuggy --source-ref refs/heads/main`
(files `requests/chuggy/<commit>/<digest>.json` for main *now*), a bot on the
fabric commits "fulfil build requests" / "publish build results" within
minutes, and `fabric-rollout` runs `scripts/rollout-from-results --within-secs
3000`, which resolves main *again* and awaits results for that commit. On
2026-09-21 I merged chuggy #721 between ticket 83's request (ac99fb06) and
ticket 84's run, so 84 found no request document for 4d7b4075 and escalated
WorkFailed.

**Why:** the rollout ticket carries no commit ("a dependency carries no
data"); the two runs agree only if main did not move between them.

**How to apply:** while a request→rollout pair is open on the rig, hold every
merge to chuggy main until the rollout ticket is Done. Repair when it happens:
file the request for the new main with the script (a PR to the fabric,
script-generated, mechanical check then merge), then resume the rollout ticket
through the API (POST `/api/v1/tenants/<t>/projects/<p>/operations` with
`{"operation":<uuid>,"mutation":{"mutation":"ResumeTicket","ticket":n}}`,
header `idempotency-key`, bearer from a temporary Hydra client with an `admins`
tuple on `Project 5:vtengchuggy`; helper shape in
chuggy-effort/multi-repo/orientation/settings-call.sh). See [[chuggy-rig]],
[[rig-release-runbook]], [[overnight-autonomy-2026-09-21]].
