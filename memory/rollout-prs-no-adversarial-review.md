---
name: rollout-prs-no-adversarial-review
description: "Geoff 2026-09-06: no adversarial review on chuggy-fabric rollout PRs that deploy-to-gtr.sh generated (digests + source-commit annotations only); a mechanical diff check by the orchestrator, then --merge"
metadata:
  type: feedback
---

Geoff, 2026-09-06, during release 30: "I wanna avoid doing adversarial reviews
on chuggy rollout PRs, which are purely generated from the deploy script that
do nothing but update the hashes in the job annotations to load the specific
worker images."

**Why:** the rollout PR is machine output of `deploy/rig/deploy-to-gtr.sh`
phase 1; a fresh Opus reviewer running kustomize, nix flake check and
mutations against it costs a round for no finding the script's own
check-release-consistency does not already make.

**How to apply:** for a rollout PR whose diff is only image digests,
`fabric.chuggy.dev/source-commit` annotations and the migrate Job rename, the
orchestrator checks the diff mechanically (touched files, digest agreement
across the api manifests, registry digest matches, no env/netpol/README
change) and goes straight to phase 2 `--merge`. A rollout PR that carries
anything hand-written (worker admit, config repin, policy change) still gets
the adversarial review — see [[rig-release-runbook]] and
[[merge-authority-2026-08-31]].
