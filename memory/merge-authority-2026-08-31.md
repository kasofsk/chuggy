---
name: merge-authority-2026-08-31
description: "Geoff (2026-08-31): I handle merging to main on both kasofsk/chuggy and gdoteof/chuggy-fabric, only after a clean adversarial review, up to date and merging cleanly"
metadata:
  type: feedback
---

On 2026-08-31 Geoff said: "you should handle merging to main, both on chuggy and
chuggy-fabric, doing so only after passing adversarial review; making sure we are
up to date and merging cleanly into main." Merges are mine to do, not to request
— this replaced the earlier ask-first default outright.

**Why:** the review loop is what earns the merge; waiting on a human for the
click only stalls the rig, and Flux deploys chuggy-fabric main.

**How to apply:** merge only a PR whose LAST review came back clean on the
committed head (a fix round is new work — re-review it,
[[review-discipline]]). Before merging: the branch is up to date with main
(rebase or merge main in, re-run the full `ci.sh` if main moved since the last
green run); a batch of sibling PRs is integrated locally and gated together
first ([[sibling-pr-integration-gate]]); `gh pr ready N` then the **bare**
command `gh pr merge N -R kasofsk/chuggy --merge --admin` (fabric: `--admin
--delete-branch`) — never wrapped ([[command-permissions]]). Both repos have a
`main` ruleset that `--admin` bypasses. Stacked PRs re-target to main after
their base merges, with `gh api -X PATCH .../pulls/N -f base=main`, never
`gh pr edit` ([[gh-projects-classic-broken]]). Record each merge in the effort
ledger.

**A goal branch is the exception, and it is ours.** For a multi-PR goal, task
PRs target a `goal/<slug>` branch rather than `main` and merge once each has had
its own adversarial review — that is the whole point of the branch. PRs against
a non-main branch may merge unreviewed when they are sonnet-sized pieces being
batched ([[orchestration-default]]); only the `goal/<slug>` → `main` PR takes
the full rule above.
