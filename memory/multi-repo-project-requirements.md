---
name: multi-repo-project-requirements
description: 2026-09-08 interview with Geoff fixing the requirements for a project spanning several repositories (chuggy plus chuggy-fabric)
metadata: 
  node_type: memory
  type: project
  originSessionId: f348a450-0114-478e-8aa2-d7e619606c37
  modified: 2026-09-08T05:19:55.975Z
---

Decisions from the 2026-09-08 interview for the multi-repository planning spike:

- One ticket changes exactly one repository. Cross-repo work is sibling tickets in the DAG, created together and dispatched in parallel. The reason Geoff accepted and wants told to other maintainers: a ticket's finalization is one conclusive verdict in the proved model, and git cannot land in two repositories atomically, so a two-repo ticket would need a half-landed state the machine does not have. Not "because I decided it".
- The ticket names its repository. Whoever creates it (lead, thread, human) sets it; a brief without one is finished by the lead during authoring.
- Configurations are per repository: each repo's own `.chug/configurations` map to the finalizers and evaluators for tickets in that repo. The "active repository" ledger stops being something a ticket depends on.
- Evaluation shape is whatever a repository's configuration says, so a fourth repo brings its own answer. For chuggy-fabric: sometimes no evaluation beyond adversarial review, sometimes the rollout landing is the evaluation. Specifics: pick what is idiomatic.
- chuggy-fabric joins the same tenant and project (vteng/chuggy). It stays under its own GitHub owner; the rig needs token entries for that owner's app installation, no repo move. Both apps are installed there: chuggy-portal installation 156334058, chuggy-worker installation 156791042. The fabric evaluator does not need `nix flake check` on day one, and on 2026-09-09 Geoff confirmed nix stays out for now. There are no "script tests" to start with: every fabric test is a `pkgs.runCommand` in `flake.nix`'s `checks`, and three rendered-manifest gates also need kubectl and PyYAML, none of which the worker image carries. Day one is therefore the release-consistency check alone plus the adversarial review, with the gap stated in the fabric's evaluator header and review brief. A `fabric-change` ticket touching `flake.nix`, `modules/`, `hosts/` or `tests/` gets a green evaluation while its real gate has not run, and a human runs it before merge.
- Acceptance is a PR on GitHub for chuggy-fabric through the rig, because users keep repos on GitHub for other reasons. End goal: chuggy-hosted git is a first-class option and the default; GitHub is what a user opts into. Finalization mode stays per brief.
- Adding a repository from the UI is punted; onboarding is expected to become agentic.
- No data to preserve: no work in flight, dogfood data only. Migrations may delete, rewrite defaults and drop what is no longer read; working paths must keep working.
- The plan lives at ~/claude/chuggy-effort/multi-repo/plan.html and is published as the artifact "Two Repositories, One Project" (2026-09-08), written to share with Dave before work starts.

- **chuggy-fabric is not special; it is only the first second repository.** Everything
  repository-specific must be configuration, never code or a hard-coded pair. A third
  and fourth repository arrive by adding entries and changing config over time, with no
  design conversation and no new code path. Stated by Geoff 2026-09-09 as a caveat on
  the rollout. Applies hardest to the plan's step 6 (the rig manifests): a mirror job,
  a credential entry and a token entry must each be an item in a list the deployment
  iterates, not a copy of the chuggy one with the name changed. The `API_MANIFESTS`
  tuple in the fabric's `scripts/check-release-consistency` is the anti-pattern to
  avoid — a hard-coded roster that silently stops covering what it names.

**Why:** these are Geoff's calls, not derivable from the tree, and the plan and its PRs are built on them.
**How to apply:** cite the atomicity reason when the one-repo rule comes up; do not reintroduce a project-wide active repository as a ticket default; keep per-repo configurations. See [[merge-authority-2026-08-31]] and [[evaluation-is-the-review]].
