---
name: landing-default-2026-09-12
description: "The repository landing default effort (2026-09-12) — what shipped to main and the rig, the decisions Geoff took in interview; #653 since closed and PullRequestMerge since shipped (2026-09-13)"
metadata: 
  node_type: memory
  type: project
  originSessionId: cf4446af-5df8-40b3-a9f3-619a18924060
  modified: 2026-09-12T10:28:33.479Z
---

Shipped overnight 2026-09-12 (chuggy main 2cdabf9e, fabric #220, rig ledger 90;
effort dir `~/claude/chuggy-effort/landing/`, DECISIONS.md + LEDGER.md):
a per-repository **landing default** (`project_repository.landing_mode`,
Push | PullRequest), edited on the console's new repository page
(`/$tenant/$project/repositories/$repository`, behind Project Administer),
applied by `create_draft`/`revise_draft` to a brief naming no landing, shown on
the ticket form as a preselected Landing field under a Managed finalizer.

Decisions (Geoff, interview 2026-09-11): the word on screen is **landing**
(the code's word; "finalization" was his and Dave's); landing is a parameter of
the managed finalizer, so a **NoFinalizer ticket may name no landing** (refused
at wire, interpreter and door) and **stores none** (`draft_brief.finalization_mode`
nullable since 090, backfilled); the default is a soft default on the binding,
not a commit to `.chug/configurations`; mode only for now, target stays per
ticket, room for a per-ticket target later (stacked work) and a future
"pull request, then merge" landing; the repository page shows what is
actionable from declared configurations and hides the rest; config editor and
worker-image links are later.

Issue #653 CLOSED by #658 (2026-09-13): a target-less PullRequest brief opens
into the default branch; the "pull request, then merge" landing shipped as
`PullRequestMerge` in #661 ([[pr-merge-landing-2026-09-13]]). Copy deviation
Geoff has not seen: Finalizer is its own panel; Approval/Handoff are columns of
the Configurations table. The Finalizer section reads a tree-wide constant
(always Managed) and says so as "what a new ticket is authored to run".

**How to apply:** treat these as settled unless Geoff reopens them; a later
landing kind or per-ticket target extends `repositoryLandingSchema` and the
`landing_mode` column rather than the configuration document. Related:
[[multi-repo-project-requirements]], [[rig-release-runbook]],
[[chuggy-ui-copy-standard]].
