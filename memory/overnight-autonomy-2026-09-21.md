---
name: overnight-autonomy-2026-09-21
description: Geoff's overnight grant for the ticket-language convergence — continue through PRs unattended, keep main pulled, roll out to the rig, sanity-check the cluster after each rollout
metadata:
  type: feedback
---

On 2026-09-21 Geoff went to bed mid-effort and said: continue all night; after each PR merges, pull main and keep the integration branch up to date (he is dogfooding on the rig, so rig-authored PRs land on main while I work); do basic sanity testing on the cluster after each rollout, not a full end-to-end ticket drive; free to mint identities, roll changes to the cluster, make cluster and config changes, whatever the convergence needs, while keeping core functionality and the end-to-end ticket train intact.

**Why:** the earlier pause-after-rollout pattern needed him awake; this replaces it for the night with a self-run sanity check.

**How to apply:** after each rig release, run the sanity checks myself (api ready, console 200, migrate job applied, deployments rolled, a ticket page and project page render, no crash-looping pods) and record the result in the effort ledger; merge `origin/main` into the working branch before every full ci run and before opening a PR. Extends [[decide-and-ship]] and [[step7-rehearsal-is-geoffs]]; see [[ticket-language-2026-09-20]].
