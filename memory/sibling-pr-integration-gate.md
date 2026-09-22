---
name: sibling-pr-integration-gate
description: GitHub's MERGEABLE/CLEAN is per-PR-vs-main only; batch merges in chuggy need a local all-in integration run of ci.sh first
metadata:
  type: project
---

Before landing a **batch** of chuggy PRs, merge them all into one local worktree off
`origin/main` and run `./.chug/tasks/ci.sh` on the result. Merge only after that is clean.

**Why:** GitHub computes `mergeable`/`mergeStateStatus` for each PR against `main`
**alone**, never against its siblings, and chuggy has no CI at all — so a defect that
exists only in the *combination* is invisible to every per-PR signal and to every
per-PR adversarial review, because neither diff contains the other's files.

Proved on 2026-08-23 merging 9 PRs: all 9 reported `MERGEABLE/CLEAN`, yet
- **#227 + #238 together broke `check-duplication`** — `src/roots/ticketService.ts` and
  `src/roots/selector.ts` each re-declare the same `database`/`runtime` zod config
  prelude. Either alone is clean; together = 3 clones over a 0% threshold. Fixed by
  extracting `src/roots/commandConfig.ts` (schema + env decode) and
  `test/roots/harness.ts` (the spawn-and-signal suite helper); all 9 then landed.
  A suite may not statically import a root — `check-boundaries` scans `test/` too —
  so cover a root module through the command's executable surface in a child process.
- **A `package.json` collision was unavoidable in every merge order.** `main`'s scripts
  block ends at `provision:project-access`; some PRs insert *before* it, others append
  *after* it (adding its comma). All six permutations of the touching PRs left exactly
  one conflict. Expect to hand-resolve one union and push, which moves that PR's head —
  comment on the PR saying the resolution touched no source file, so the prior
  approval still covers the content.

**How to apply:** build the integration in a scratch worktree (needs its own `npm ci`),
run under Node 24 per [[chuggy-false-reds]], alone per [[chuggy-false-reds]].
Capture `git rev-parse HEAD^{tree}` and re-run `ci.sh` against real `main` after
merging — do not trust the scratch tree as the verification, since a scripted conflict
resolution can differ from what actually lands. Retarget stacked PRs with
`gh api -X PATCH .../pulls/N -f base=main`, never `gh pr edit` ([[gh-projects-classic-broken]]).
Related: [[merge-authority-2026-08-31]] for who may merge.

**Gate the commit, not the working tree (2026-08-26).** Landing #356 I amended a fix, ran the full gate clean, pushed, merged — and `main` went red, because `set -e` had aborted an earlier attempt before its `git add`, so one of two test fixes lived only in the working tree. Before pushing a landing head: `git status --short` must be empty (or `git stash -u` before the gate), and the gate must run on exactly the tree that is pushed. Fix-forward was PR #360.
