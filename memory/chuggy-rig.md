---
name: chuggy-rig
description: "The local k8s rehearsal rig — where it is, what it runs, and how far agents may go on it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0206ee6f-3000-4db8-9b7d-6b3c3545427a
  modified: 2026-09-14T10:22:03.915Z
---

The chuggy deployment rehearsal runs against a local rig, not GCP. GCP stays the
eventual target; the local cluster exists so the phases that need nothing from
GCP are proven first.

**The box:** `ssh geoff@192.168.0.114`, sudo available. NixOS 24.11, so its
configuration is declarative. Single-node k3s (node `gtr`), kubectl context
`chuggy-fabric`. Flannel CNI, Traefik ingress, `local-path` storage (hostPath,
no CSI). Flux v2 and kube-prometheus-stack installed. Namespace `chuggy` holds a
hand-rolled postgres StatefulSet; `chuggy-work` holds session pods and the git
mirror; `chuggy-build` holds Shipwright BuildRuns. No `python3` on the node —
filter API answers with grep/cut inside the ssh quotes.

**Live at:** `https://chuggy.vteng.io/` (the console at `/`, the api under `/api`; there is no `chuggy-ui.vteng.io` host, checked 2026-09-20) beside
`chuggy.vteng.io` (the old operations console). Public hostnames must be
single-label ([[vteng-single-label-hosts]]). The real project is `vteng/chuggy`;
`vteng/rehearsal` is an empty partition with no repository binding, so anything
needing a Ready revision must seed it, and synthetic tickets do not go into the
real project.

**How far agents may go (Geoff, 2026-08-20, widened 2026-08-23):** destructive
actions on this box are authorized — restarting k3s, `nixos-rebuild`, installing
components, destroying and restoring the rig's PostgreSQL, firewall and
API-server reachability from an ssh session. Every host and cluster change is
recorded with its undo. **The one exception:** anything whose failure mode needs
a human at the console — port 22, `services.openssh`, the default route. What
makes remote firewall work recoverable is that sshd stays reachable; establish
that from the *built* firewall script before activating, and keep
`nixos-rebuild test` (which a power cycle undoes) ahead of `switch`. It is a rig
and it is meant to be worked on; timidity costs more than breakage here, but an
unattended agent cannot recover a box it has locked itself out of.

**State-row corrections are inside the grant (Geoff, 2026-09-06).** A targeted
correction of one project's state row — before-values read and recorded, the
undo written in the report — is work the rig is for: do it over bare ssh
(`kubectl -n chuggy exec postgres-0 -- psql -U postgres chuggy`), guard the
UPDATE on the before-values, read the row back, then report. Ask first only for
restores, multi-project or whole-table changes. Parking such a fix in a note
while doing optional work is the failure this rule answers.

**Identities are within the grant (Geoff, 2026-08-26 and 2026-08-30):** a
temporary Hydra `client_credentials` client and a Kratos test identity, each with
its undo recorded and removed when the proof is done. Mint it as one bare ssh
with the filtering inside the remote quotes ([[command-permissions]]); never
print a secret. The permission classifier still stops a *subagent* from creating
them and from `nixos-rebuild` — the orchestrator does those under Geoff's
standing grant, and hands over any credentials file at mode 600, never printed,
never committed.

**Two repositories since 2026-09-09 (fabric #190, host generation 200):**
`repositories.nix` in chuggy-fabric is the roster; the host runs eight
`chuggy-github-app-token-{reader,finalizer,build-reader,worker}-{chuggy,chuggy-fabric}-refresh`
units minting `chuggy-fabric-github-{reader,finalizer}-token` (chuggy),
`chuggy-fabric-github-worker-token` (chuggy-work) and
`chuggy-fabric-build-source-read` (chuggy-build). The git service holds
`/git/chuggy-fabric.git` beside `chuggy.git` and `rig.git`, hook installed; the
mirror CronJob follows both. Adding a repository: one roster entry, then do what
`tests/github-repository-transition.py` names — and the host rebuild goes
*before* the merge, or the Recreate deployments sit in FailedMount.
Since 2026-09-10 (chuggy 3e0574bc live, ledger 82; fabric #193): `vteng/chuggy`
binds three repositories — the chuggy mirror URL (oldest, what sessions check
out), `https://github.com/kasofsk/chuggy.git` and
`https://github.com/gdoteof/chuggy-fabric.git` — and the importer CronJob
imports both GitHub repositories, each at its own main, with `repository`
beside `commit` in its config. The fabric's mirror URL is deliberately not
bound: the scheduler's `mirrors` map (keyed by the binding string) rewrites a
GitHub binding to the in-cluster mirror at placement, and a binding naming the
mirror would point the finalizer at the git service; the chuggy mirror row is
legacy from before that map and was RETIRED on 2026-09-14 (`retired_at` set,
migration 094; the mirror sync itself was removed in fabric fbaee0c on
2026-09-11, so the copy is frozen at 0dce5417). Sessions now check out
`kasofsk/chuggy` main. A re-bind reinstates a retired row
([[self-rollout-chain-2026-09-14]]). Bindings are otherwise immutable; `bind:project-repository` runs as `chuggy_owner` from inside
the api pod with the password read from `chuggy-postgres-credentials` on the
node (see the multi-repo effort's `release/bind.md`).
Since 2026-09-10 (fabric #197, host generation 201): build results are committed
into the fabric under `results/<repository-id>/<source-commit>/<request-digest>/<attempt>.json{,.sha256}`
by `chuggy-build-results-publish.timer` on gtr, pushing to main as the
finalizer App (bypass actor; `remote: Bypassed rule violations` in its journal
is success). `tests/build-results.py` is the layout gate. The fabric builds
the api image since chuggy #633 (https apt from a seeded CA bundle; build
egress is 443-only); BuildRun names carry the first 40 hex of the request
digest. Selector settings for vteng/chuggy are at revision 23 with the
two-repository orientation appended to thread rules and base prompt
(effort `multi-repo/orientation/`).

**Rebuilding the host:** `sudo nixos-rebuild <build|test|switch> --flake
github:gdoteof/chuggy-fabric/<full-sha>#gtr` — from the pinned SHA on GitHub,
never from a checkout on the box. `build` first and inspect
(`nix store diff-closures /run/current-system ./result`, `cmp` the sshd unit),
then `test`, verify ssh from a second session, then `switch`. A `sudo` build
leaves a root-owned `/tmp/result` GC root; remove it with sudo.

**Releases** go through `deploy/rig/deploy-to-gtr.sh` — see
[[rig-release-runbook]] for the route and its traps. **Merging a chuggy PR
deploys nothing by itself**: Flux follows chuggy-fabric `main` only, and
`flux reconcile kustomization apps --with-source` is the reconcile that works
from ssh (the GitRepository is named `fabric`, so `flux reconcile source git
flux-system` fails). Rolling the api back below the ledger it declares is a
database restore, not a manifest edit. Images reach the rig registry by
`k3s ctr images tag` + `images push --plain-http` to the registry ClusterIP
(`10.43.129.13:5000`).

**Worker commits land on chuggy `main` directly** — the Worker pushed `aa5bff9`
itself on 2026-08-29 and has since. That is the accepted interim, not
unreviewed work ([[evaluation-is-the-review]]); branches cut before one rebase
over it.

**Two silences that are health, not failure.** Session pods and the scheduler
are silent by construction (`silentSchedulerTelemetry`) — an empty log is fine,
and a refusal is in the *previous* container's stderr. A session pod's one
stderr line is its checkout (`session checkout <mirror url> at <sha>`); the
turn's refusal reason is on the turn row only.

Network-policy quirk (seen 2026-09-10): a pod started seconds ago is *refused*
(connection refused, not a timeout) on any port an `ory` policy admits through a
`from: podSelector` clause, for roughly ten seconds, until the policy
controller's source ipset catches up. Ports admitted with no `from` answer at
once. So a `kubectl run ... curl` probe of an admin port (Hydra 4445, Keto 4467)
lies on its first try: probe from a long-lived pod, or sleep before the request.
Keto (deployed 2026-09-10, fabric 11286c9) is `keto-read.ory:4466` /
`keto-write.ory:4467`; see [[repository-onboarding-plan]].

**How to apply:** brief cluster-touching subagents with the facts above rather
than making them rediscover them, plus the console-failure-mode exception and
the record-your-undo rule. Related: [[merge-authority-2026-08-31]],
[[orchestration-default]].

**Worker pod memory (2026-09-11, fabric #217):** a worker evaluation's
`check-source` lint stage died on JavaScript heap exhaustion. Node sizes its
default heap from the container's cgroup limit (about half of it), and typed
ESLint over the chuggy tree peaks above the old 2Gi limit entirely, so no heap
flag could fix it. The budget is `CHUG_SCHEDULER_WORKER_RESOURCES` in the
fabric's `cluster/apps/chuggy-scheduler.yaml`, now 1Gi/4Gi like the session
pod. A worker gate red reading "Ineffective mark-compacts near heap limit" is
this budget, not the branch.
