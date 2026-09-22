---
name: worker-image-roster-stage
description: "2026-09-17: the worker Dockerfile's roster stage runs the whole gate roster inside the image and fails the fabric build (PR #680); what it found, what it costs, the traps hit building it, and the shape Geoff chose over a local gate or a canary"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7e427040-cc3d-4267-b4d1-33072fa24a77
  modified: 2026-09-17T06:13:58.363Z
---

Geoff's ask (2026-09-17): "ensure future built images are able to run the ci
gate" — meaning **the fabric's build fails** when the image cannot run
`.chug/tasks/ci.sh`, not a chuggy-tree gate and not a canary ticket. Shape
chosen: a `roster` stage in `images/worker/Dockerfile` FROM the image that
COPYs the build context, `git init`s it (`.git` is dockerignored), `npm ci`,
runs `CHUG_CI_FULL=1 ci.sh` against a PostgreSQL 17 (initdb `--encoding UTF8
--locale C`, else SQL_ASCII breaks the no-control-character constraint) and
Ory Keto (the linux_sqlite release tarball; the container image's binary is
musl-linked) started inside the RUN; the final stage `RUN --mount=type=bind,
from=roster,...` so the build depends on the verdict and ships nothing.
Whole roster inside the build: ~5 min locally (profile timeout 1h, 8Gi).
Red-proved: same stage on bookworm fails at check-model (GLIBC_2.39).

**What running the roster in the image found:** the eight blessed-practices
plugins were never installed in the worker image, so check-roster exited 2 in
pods and rig agents could not invoke a practice by name (now installed at
build from `.claude/settings.json`); `deploy/rig/deploy-to-gtr.test.sh`
relied on a global git identity. Rig DB (`execution_result_report`) showed no
attempt had ever run check-postgres/queries/keto to a verdict, and **the pod
has no Keto** — check-keto (cone `src/**`) will exit 2 in attempts until a
Keto sidecar is added to `workerPod.ts` + fabric. Still open.

**Traps hit:** `_postgres.sh` claims `image`, `port`, `container`, `scratch`,
`base_url`, `subject`, `waited`… at source time (my `$image` became
postgres:18-alpine); a worktree's `.git` is a file pointing at the main repo,
so `git ls-files` fails inside a container that mounts only the worktree;
`time` is bash-only; a COPYed file in /tmp is root's and uid 1000 cannot rm it
(use `RUN --mount=type=bind` instead).

A local gate `check-worker-image.sh` was built first and parked as WIP on
branch `gate/worker-image` (worktree chuggy-wt/worker-image-gate); it is not
what Geoff wanted. **Landed 2026-09-17** as chuggy 44612cfe (two review
rounds; the second asked for an explicit suite budget on the RUN, servers'
logs on failure, the practices listing through a file, and the header saying
the stage proves the image not the pod). Fabric PR #249 (03e7464) filed the
hand-rendered build request `builds/chuggy/44612cfe…/f75c13fe….yaml` (worker
image is NOT in `build_sources.py`, so it is always a hand render, not
`request-build`). **First builder run refused the image** (BuildRun f75c13fe, left standing,
never retired): a console model-walk test went past vitest's default per-test
cap on the 4-CPU builder — fixed by a suite-wide `testTimeout` in
`ui/chuggy-ui/vite.config.ts` (chuggy #682, 1452fe73). Cause filed as #683:
node sizes pools from the host's 16 cores, not the cgroup quota (build 4 CPU,
attempt pod 1 CPU). Second build (BuildRun fcfbeeef) passed: roster clean in
~442s in-build, digest sha256:c3226d5e…; admitted as **worker 0.27** (fabric
#251), `chuggy-development.json` repinned (chuggy #684). **The configuration
importer CronJob (every 2 min) imports chuggy main directly**, so a worker
repin needs NO deploy-to-gtr; the rig's chuggy release is still 4ee3ab87.
See [[rig-release-runbook]].
