---
name: repository-onboarding-plan
description: "2026-09-10 plan for onboarding an existing GitHub repository or bootstrapping a new one from the console; where it lives, its shape, the decisions taken under decide-and-ship (single route, two Apps, no server-side state token), and progress"
metadata: 
  node_type: memory
  type: project
  originSessionId: d39ac532-3a96-4bc3-b5ee-6fb9eab3703e
  modified: 2026-09-11T01:36:40.056Z
---

Plan at `/home/geoff/claude/chuggy-effort/onboarding/plan.html`, published as the
artifact "The Roster Becomes a Row" (2026-09-10); tracker beside it in `STATUS.md`.
It is the "import or create a repository" leg of the auth vision's one-sitting path.

Shape as decided by 2026-09-11 (see STATUS "Step 3/4 — design decisions"):
chuggy mints GitHub App installation tokens itself; **single route**: the api
alone holds the portal key and mints, the ticket service, finalizer and
importer ask the api under client credentials (composed in step 7); **two
Apps** (a one-App shape was tried 2026-09-11 and reversed the same day: the
branch ruleset admits the portal App to protected main, so a Work attempt's
contents:write token must be the worker App's, which the ruleset refuses):
portal App → api/finalizer/ticket service/importer; worker App → the plane,
per-mint permissions (read for evaluation and sessions, write for work);
onboarding installs both, claims name their app; installations are stored in `forge_installation` and claimed over
a bearer-protected api route behind Tenant `administer` — **no server-side
state token** (GitHub echoes `state` only to the browser; the console holds
it as it holds OIDC state); bind and create are routes behind Project
`administer`; a repository without `.chug` starts on a bootstrap review-only
configuration (step 4b, from a template); the in-cluster mirror retires for
forge repositories; the fabric's `repositories.nix` roster is subtracted.
Steps 1 and 2 are the auth decision's Keto steps.

Facts pinned from GitHub's OpenAPI: installation tokens can create org repos,
generate from a template, create rulesets, and open/merge PRs; they cannot create
a repository under a personal account.

Progress: steps 1, 2, 2b merged and released (rig at chuggy 3be38c30, ledger
83, 2026-09-10); step 3 (api mints, chuggy 5882e0d8) and 3b (fabric mounts the
portal key, 47bc17f) merged and released 2026-09-11 (fabric a410f76, ledger
84, two claim rows written); step 5 (plane mints for attempts and sessions,
chuggy b977eb10) merged with fabric #204 (plane key) and #206 (api worker key,
for verifying worker-App claims) live, worker image 0.23 admitted and repinned
(P = 71916275), phase 1 → fabric #209 awaiting Geoff's phase 2; step 4 (claim
and bind routes, 085) merged 6411d811, release after step 5's; step 4b
(bootstrap configuration + `POST …/repositories/new` over the contents API,
both claims required, `administer` permission set never on the wire) merged
41734773 (PR #641) 2026-09-11, releases with step 4; step 6 (console:
Repositories page, setup landing `/forge/github/setup`, `returnPath` on the
OIDC transaction, ticket-form repository picker) draft PR #642 in its fix
round, one mutation sweep after its round 2 (configurations outcome, Create
dialog); step 7 brief being written from a fabric fact pass; the console's
contract classifier collapses every 404 and drops the success status
(follow-up in `src/contract/outcomes.ts`). Two Apps after all (2026-09-11): ruleset bypass is per
integration, so the worker App mints for pods and the portal App for the
control plane; four claim rows on the rig. Rig requirement for step 8: the
portal App must hold contents:write, pull_requests:write and (for `/new`)
administration:write.

**Why:** the design choices are Geoff's to confirm and not derivable from the tree.
**How to apply:** Geoff decided 2026-09-10: "no new authz or authn columns, if that
means keto first it's keto first." So the auth decision's Keto steps lead this
plan, and no access kind is ever added as a column. Decisions above were taken
under [[decide-and-ship]]; report them in recaps so he can overrule. See
[[auth-vision-interview-2026-09-10]]. Builds on
[[multi-repo-project-requirements]]; runs under [[orchestration-default]].
