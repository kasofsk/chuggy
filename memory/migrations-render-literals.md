---
name: migrations-render-literals
description: "A landed migration must render every roster it installs as a literal list; a live import drifts silently each time the roster widens (050 did, twice) — check by rendering every migration on main vs the branch and diffing"
metadata:
  type: feedback
---

A migration that interpolates a live roster (`briefFinalizationModes`,
`briefFinalizationDefault.mode`, …) into a CHECK or default re-renders every
time the roster changes, so the file no longer says what it installed. 050 was
found rendering `('Push','PullRequest','PullRequestMerge')` on the pr-merge
branch though it installed `('Push')`; 051 had widened it once already
unnoticed. Landed migrations now carry their own literal (`…ModesAt51`,
`At90`, `At92`, `At50`); a new widening is a NEW migration (D4/D10 of
[[pr-merge-landing-2026-09-13]]).

**Why:** the ledger records version and name only, so an applied database is
never re-checked against the file — the drift is invisible at runtime and only
a reader is misled; and a widening that edits a landed body is exactly the
[[migrations-edited-in-place]] trap.

**How to apply:** before merging anything that touches a roster a migration
reads, render every migration's statements from `origin/main` and from the
branch and diff them; the only differences allowed are the branch's new
migrations. Freeze any migration whose render moved (fix forward: the literal
it originally installed, and a migration.test case proving that CHECK at that
version). The reviewer's render script left outputs at
`~/claude/chuggy-effort/pr-merge/scratch/review662/{main,branch}.sql` as a
model.
