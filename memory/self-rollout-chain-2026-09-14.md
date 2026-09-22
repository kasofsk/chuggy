---
name: self-rollout-chain-2026-09-14
description: "Why a thread cannot roll chuggy out (2026-09-14): sessions read the frozen in-cluster mirror, the fabric-rollout brief names a script that cannot produce a release, and the fabric binding landed as Push; the self-rollout effort fixing it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0206ee6f-3000-4db8-9b7d-6b3c3545427a
  modified: 2026-09-14T10:21:53.884Z
---

Investigated 2026-09-14 after a thread refused to roll out ticket 68. Effort
dir: `~/claude/chuggy-effort/self-rollout/` (LEDGER.md is the state).

**Three defects, none in the thread prompt.** The thread rules already
describe the chain (fabric-change ticket renders build requests → fabric builds
and publishes `results/` → fabric-rollout ticket renders the promotion → PR).
It has never run: the rig journal has zero entries naming either fabric
configuration.

1. **Sessions read a frozen tree.** `sessionSchedulerRun.ts` gives a session
   the project's OLDEST binding; on vteng/chuggy that is the in-cluster mirror
   `http://git.chuggy-git.svc.cluster.local./chuggy.git` (bound 2026-08-25).
   The fabric retired the mirror sync and the scheduler's `mirrors` map in
   fbaee0c (2026-09-11); no CronJob or host timer syncs it. The git service
   still serves the copy, stuck at chuggy 0dce5417. Threads since then read
   GitHub main themselves to answer. Unit A of the effort adds binding
   retirement; then the mirror row is retired on the rig (unit E).
2. **The fabric-rollout brief names the wrong script.** `render-image-promotion`
   renders a stub Deployment for one manifest, needs crane (not in the worker
   image) and pushes itself; it cannot pass `check-release-consistency`, which
   wants one source commit across all ten manifests. `deploy-to-gtr.sh` passes
   that by rewriting the source-commit annotation everywhere and renaming the
   migrate Job, even for a console-only release. Unit B adds
   `scripts/render-release` to the fabric doing that half from `results/`.
3. **Fabric landing was Push.** Set to PullRequest by guarded SQL on
   2026-09-14 (undo: reverse UPDATE). PullRequestMerge waits until something
   does post-merge what `--merge` does (dump, migrate Job wait, rollout status,
   refuse while a live attempt exists).

**Outcome, same day (all landed and live):** chuggy #663 (main 4ee3ab87,
migration 094 `retired_at`, `PUT …/repositories/retirement`, re-bind
reinstates) rolled out as fabric #223; fabric #222 added
`scripts/render-release` and deleted `render-image-promotion`; the mirror
binding is RETIRED on the rig (election now `kasofsk/chuggy`); selector
settings at revision 26 name `render-release` and say the mirror is retired.
Follow-ups in the effort LEDGER: deploy-to-gtr still carries its own copy of
the image→paths map; three real guards in render-release have no test case;
driving a fabric-change → fabric-rollout ticket pair is Geoff's.

**Facts checked while at it:** `images/chuggy-ui/Dockerfile` takes no build
arg and the fabric has built it three times; only the old console's
`images/web/Dockerfile` needs `site=`, which `render-build-request` cannot
pass, so the old console cannot be built by the fabric at all. `landing_mode`
on `project_repository` is mutable (the immutability trigger excludes it);
everything else on the row is not.

**How to apply:** when a thread says it cannot deploy, check the ledger in the
effort dir before re-deriving. Driving a ticket through the chain is Geoff's
([[step7-rehearsal-is-geoffs]]). Related: [[rig-release-runbook]],
[[chuggy-rig]], [[repository-onboarding-plan]].

**2026-09-16:** fabric #226 (davemo88, 2026-09-14) removed the old console
(chuggy-web manifest, render-release web image, roster, tests) and moved the
console to chuggy.vteng.io, so the old-console refusal in render-release is
gone. Geoff set BOTH bindings to PullRequestMerge by hand. First live drive of
the chain started 2026-09-16 via subagent ([[step7-rehearsal-is-geoffs]]);
identity `first-drive` (Hydra client + Keto Project admins) with undo in
`self-rollout/first-drive/LEDGER.md`. Open design point: the wait between the
build-request merge and the result is unowned; the lead (fact in its
observation, refuse/lift) or a readiness fact in Core are the candidates, not
the thread.
