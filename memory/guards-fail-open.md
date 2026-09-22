---
name: guards-fail-open
description: "On chuggy every guard that failed did so by passing — matching text, reading a channel something else rewrites, or never being enforced at all; the roster of signatures and the red-proof rule that catches them"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bdd96a53-fc09-48f0-8982-b564cd473b78
  modified: 2026-09-09T18:49:26.277Z
---

A guard in this tree fails by **passing**, and almost always because it observes
something other than the property. Seven signatures, all seen live:

- **Matching text instead of establishing the property** (#197 reviews,
  2026-08-23 — five instances, *every one introduced by a fix round*): a
  `postgresRoles` assertion satisfied by a `--` comment quoting the SQL, then by
  `[\s\S]*` capturing a statement's tail so it counted roles a migration
  *mentions*; `firewall-rules.nix` anchored at `$` so NixOS's `-i <iface>` forms
  escaped it; `state-and-secrets.nix` asserting `interval >= (burst-1) × attempt`
  where systemd needs `burst × cycle <= interval`; fabric #8's README grep
  pre-filter turned `0,0` into `1,1` by four appended comment lines.
- **A pipeline's exit status is its last command's** (2026-08-20, twice, two
  different agents, both in the guard the script existed to provide). `set -eu`
  is not `pipefail`, and `pipefail` is not POSIX `sh`. `deploy/rig/git/seed.sh`:
  a failed `kubectl get secret` piped to `base64 -d` minted a well-formed
  htpasswd entry from an empty password, authenticating anyone.
  `deploy/rig/durability/rehearse.sh`: a missing dump piped to `cut` gave an
  empty digest, and `grep -q ""` matches every line, so the guard protecting
  `DROP DATABASE` returned 0.
- **A failed `cd` does not stop the block** (2026-08-23). A bare `cd x` that
  fails prints an error and the rest runs in the *old* directory — a
  `git reset --hard` landed in the primary checkout and moved
  `goal/ory-auth-scheduler-ui`. Chain every `cd` with `&&`, or open with
  `set -e`. Recovered via `git reflog show <branch>`; prefer
  `git worktree add --detach <path> <ref>` and push with an explicit refspec.
- **A harness that cannot tell red from broken** (2026-08-27, #399): in
  `ui/chuggy-ui`, `npx vitest run --reporter=basic` exits 1 on a clean tree
  under vitest 4, so a red-proof harness keyed on its exit code reported every
  plant RED, including the green ones. Plain `npx vitest run` exits correctly.
  The reviewer caught it only by asking *which* test failed.
- **An unenforced suite** (2026-08-28, #417): `check-source.sh` picks unit
  suites from `git ls-files`, so a written-but-unstaged test runs by hand and
  under no gate — `CHUG_CI_FULL=1 ci.sh` stays 0 and the "unit ran N suite(s)"
  count does not move. Staging moved it 141 → 142.
- **A red-proof coarser than the property** (2026-09-09, step 1 of multi-repo,
  twice in one day): the door compares six terms on a replayed operation; the
  fix "varied the partition" by drawing a fresh one that changed tenant *and*
  project, and red-proved by deleting both terms at once. Each term alone
  survived. Same shape one file over: a fix varied `authoritySubject` and
  called it "authority", leaving `authorityKind` unasserted. And in the same
  round a kept regression test stopped regressing because the read it relied
  on now returned the same value as the field under test. A red-proof must
  delete **one** term the assertion claims to hold, and a kept test must be
  re-proved on the branch, not assumed from `main`.
- **An inert fix reported as done** (PR #10, 2026-08-15): an `assertTaskSet`
  call added as a review fix left the suite green when deleted. Same round, a
  timing claim ("101ms→56ms") used a never-pushed intermediate as baseline and
  masked a ~46% regression.

**Why:** a fix written under review pressure reaches for whatever
*demonstrates compliance* fastest, and matching text is the fastest thing that
looks like proof. Every one of these fails in the direction that looks like
success, which is why the author never sees it and the reviewer does.

**How to apply.** Read the built artifact or the end state, never the source
that should produce it — `systemd.services.firewall`'s actual `ExecStart`
literals, `DISTINCT proowner` over the whole schema, `pg_auth_members`. Derive
the expectation from a *different* source than the thing under test. Capture
any guard value and assert it non-empty before use; anchor or replace every
interpolated `grep` pattern. **Red-proof every fix, including guards and
comment-carried figures** — delete the guard, watch a *named* test go red — and
red-proof against the plausible wrong implementation, not merely against
deletion, which often reddens an earlier subtest and proves nothing. A red-proof
table is not evidence: reviewers reproduced these tables and then found
uncovered mutations that survived. Any figure in a disposition is measured at
the compared baselines, not recalled. Related: [[review-discipline]],
[[chuggy-false-reds]].

**Eighth signature (2026-09-11): the suite runs as the superuser, so a missing
grant to a service role is invisible.** The postgres suites decide as whoever
migrated, who holds every grant, and `privileges.test.ts` pins only what a role
may NOT do. PR #627 made the ticket service's decision transaction join
`repository_configuration_provenance`, granted to the api alone; every gate was
green and every activation on the rig raised `permission denied` for two days
(fixed by #644, migration 087). When a change adds a query to a service's
transaction, one case must drive that path over `postgresHarnessRolePool(<its
role>)`, and the privileges pin gains the positive side (it CAN read) beside the
negative.

9. **A fixture shaped like yesterday's remote answer** (2026-09-11): every token
   fixture in chuggy was ≤ 40 chars, so `asForgeInstallationToken`'s 256 bound held
   green while GitHub's real tokens (now `ghs_` + a JWT-shaped tail, 390 chars)
   were refused and the plane answered 503 on every mint. A bound on a value a
   remote produces needs one fixture at the remote's CURRENT shape and length,
   taken from a live answer, not a placeholder.

10. **A test rewritten to a fixture that makes its own arm unreachable**
    (2026-09-20, handoff removal): the authoring precedence test lost its
    handoff fault and was rewritten with a brief that names a repository, so
    the `BriefNamesNoRepository` arm it is named for could no longer fire
    inside it; the author claimed a red-proof that did not exist. When a test
    is re-fixtured to survive a removal, red-proof it against EACH property in
    its name, not the one that was easiest to reach.

11. **A checker that `continue`s past a shape it cannot parse** (same day):
    the golden aim check matched only `lastStep.label != "x"` and silently
    skipped `not(lastStep.label == "x" and ...)`, so the new aimed rows were
    checked by nothing and a drifted trace replayed clean. A parser inside a
    control must refuse what it cannot read, never skip it.

**Twelfth signature (2026-09-21, PR 2 release):** a rig data check that greps
the journal for a deleted NAME passes while rows in the deleted SHAPE remain.
The cascade-revoke rows never say `DependencyRevoked`; they are plain `Revoke`
events whose record carries the dependents' transitions. The migration guard
tested the shape, the pre-merge check tested the name, and the release failed
at the guard on the rig. Before deciding that stored rows of some shape "do not
exist on the rig", run the guard's own predicate against the rig, not a grep
for the words the design removed.

- **Write union wider than read union (2026-09-21, #727).** `briefSchema` admitted `finalization.mode: "None"` and the finalizer honoured it, but `briefFinalizationResponseSchema` listed three modes. Every write passed, and every validating read of such a ticket failed (console ticket parse, project-stream change log). Signature: a discriminated union spelt twice, once per direction. Pin: one test walks every write-side variant through the read schema.
