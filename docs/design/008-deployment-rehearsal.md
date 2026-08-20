# The deployment rehearsal

**Status: PROPOSED** — none of this is built; the landing table sequences it. The target is still GCP, and issues #75 and #76 are still the apply.

What changes is the order. The phases that need nothing from GCP are rehearsed first, on a local Kubernetes cluster, and the GCP apply is what remains.

## Why the order

P0 and P1 split in two, and not along the line between them. One half — the Workload Identity Federation token exchange, persistent disk provisioning, the Artifact Registry pull credential, whether Cloud NAT lets the egress out — is a provider's own machinery, and all of it is issue #75's. Getting it right proves that GCP was configured correctly. It proves nothing about chuggy. The other half — the GitOps loop and the git service, which are issue #76's, together with the PostgreSQL roles, epoch fencing and the restore path — is where every mistake that matters will be, because that half is what this tree designed and its deployment has never run. Rehearsing it where the edit-to-verdict loop is short finds those mistakes before a provider's error messages are standing in front of them.

`docs/design/006-durable-project-dispatch.md` permits the order. No statement in it needs GCP to hold a correctness property. It puts the mechanism in PostgreSQL ownership, saying that "Kubernetes supervision and placement are not"; and it calls managed PostgreSQL *the recommended production authority* so that "loss of the Talos cluster does not also remove the record needed to reconstruct it" — which is an argument about failure domains, not about correctness, and which reads the same with any node OS in it.

## What the rehearsal may not claim

006 also says acknowledged commits have "no expected loss under process, instance and zonal failure". A single machine cannot make that true, and the rehearsal must not pretend otherwise. That sentence is a claim about the production deployment; it is not an invariant any code satisfies, and nothing in `src/` can get it right or wrong. So the rehearsal's durability verdicts are confined to the mechanisms 006 does put in the code — ownership, fencing, the recovery epoch, the restore path. Zonal durability is bought at the apply and nowhere earlier.

## The rig

k3s, as it already runs: a single node, with Flannel, Traefik, a `local-path` default storage class, and Flux reconciling. It stays. What D3 exercises is Kubernetes' own vocabulary — labels, node selection, network policy — and k3s enforces policy itself rather than borrowing it from the CNI, so the isolation rehearsal needs no other distribution and no rebuild of a rig that already reconciles. Which OS the production nodes run is not this document's to change: `docs/design/006-durable-project-dispatch.md` names Talos and issue #75 mandates it on GCE VMs. Issue #124 is where that stands now, and it first meets reality at the apply either way.

PostgreSQL is the StatefulSet already in the cluster, not an external server. What the rehearsal is about is the deployment's relationship with a server: which identity migrates, which roles log in, what the recovery path writes before anything else may. An external server answers none of those differently. What it removes is the one question only an in-cluster server poses — who on the network may reach it — and that is the one answer below that may not transfer.

## What the deployment owes PostgreSQL

This holds of slices I0 and I1 and of nothing on `main` yet — the adapter it describes is on their branches — which is why the D0 row depends on them. It is written out here because a deployment obligation has nowhere else to live; when those slices land it becomes a pointer to them.

The migration runs at start-up under an advisory lock and creates the tables and the group roles together, so the identity that runs it needs role creation. It must not be a superuser: cancellation is `SECURITY DEFINER`, so its body runs with the privileges of whoever owns it, and a superuser owner turns any future weakness in that body into a superuser escalation. The group roles do not log in. A deployment therefore has to create a login role per service, grant it the membership, and issue its credentials — and nothing in this tree does that at any layer, so the rehearsal is where it first becomes something that runs rather than something that is described. No extension is required; digests are computed in the process.

The recovery epoch is a control-plane write the dispatcher role provably cannot make, so a fresh database and every restore alike need a path that establishes a never-reused epoch before the first mutation. Nothing here invokes a dump or a restore either. Those two belong in one row: a restore that cannot fence the writer it restored is not a restore.

## What no process reads

`src/` reads no environment variable at all. On I0 and I1 the connection string and the idempotency keying secrets are constructor arguments instead, which means no deployment can configure a chuggy process even once those land. That gap is real and it is not this document's to close: it belongs to whichever slice first deploys a process. Issue #117 already fixes the shape for the keying secret — a mounted directory of versioned files, byte-identical across replicas, deliberately not an environment variable — and the connection string wants the same treatment rather than a different one.

## What the rehearsal cannot see

Said plainly, so nobody trusts it further than it goes: that work and system are different machines, because one node makes them the same — D3's labels and nodeSelector express the split, and only a second node would prove it; node machine configuration and bootstrap, which first meet reality at the apply; CSI attach, detach and resize, because the rig's volumes are directories on a node; which mechanism answers reachability in production, because issue #75 leaves managed versus in-cluster PostgreSQL to the operator and D0's policy transfers only to the in-cluster choice; a real certificate chain; and the GCP row — the token exchange, disk provisioning, the registry pull credential, Cloud NAT's behaviour.

D3 reaches the placement and egress rules themselves; the machines underneath them are the apply's, which is why the apply is still a row.

D3 lands the labels and the nodeSelector, and deliberately not the taint. A work-pool `NoSchedule` taint on the only node forces every system workload on it to carry a toleration — k3s's own coredns, Traefik, metrics-server and local-path-provisioner, Flux's controllers, the PostgreSQL StatefulSet — which is the inverse of what the production split wants, and a manifest the apply would then have to undo. The taint belongs to the pool split the apply builds. A second node joining the rig would make the split real here as well, and the row leaves that open rather than committing to it.

## The seams that stay seams

The rig must not become a design input. What holds today is not a seam but an absence, and an absence leaks nothing: `src/` has no adapter for a secret source, a registry, a storage class or a database, so there is nothing in it yet for the rig to reach. The seams themselves are the shapes `origin/infra-explore` proved and this tree has not re-landed — the secret source a port with a single read, satisfied by a file adapter and a GCP one alike and chosen at compose time; and image references from a catalog file rather than from code, so no registry host appears in `src/`. Re-landing them belongs to whichever slice first deploys a process, and until then the trigger below is the whole of the control.

**Refutation trigger.** A module under `src/` naming k3s, Traefik, the rig's storage class, or a hostname. That is what a leak looks like, and it is greppable.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| D0 | The rig's PostgreSQL made real: per-service login roles, the membership grants, `.chug/tasks/check-postgres.sh` run against the rig's server, and the policy that makes it reachable only from authorized workloads | I0, I1 | Proposed |
| D1 | The git service and the Flux loop: a git service over smart HTTP, the repository seeded, Flux reconciling from it | — | Proposed |
| D2 | The durability rehearsal: a real dump and restore, a fresh epoch established before any mutation, an old-epoch actor refused afterwards | D0 | Proposed |
| D3 | The isolation rehearsal, on the rig as it stands: the pool labels and a nodeSelector placing work and system apart, default-deny egress on the job namespace, and the metadata endpoint refused by policy rather than by the rig's not having one | — | Proposed |
| D4 | The GCP apply, issues #75 and #76 | D0, D1, D2, D3 | Proposed |

D2 is 006's I8, taken early and taken in part. 006 places I8 behind I0 through I7, and what puts it there is its second half — the managed deployment, and the inventory and reconciliation of Git repositories, blobs, executions and permits, which needs the finalizer and the scheduler to have produced any. Its first half — backup and restore, a fresh recovery epoch, and old-epoch actors still rejected after one — needs only a database that has an epoch, which is I0. D2 takes that half and leaves the rest with I8.

The only input any of D0 through D2 takes from this tree is a connection string, and I0 already makes it an argument; D1 needs not even that. The credential D0 issues is a deployment secret rather than a read through a secret source.

Deploying the dispatcher and driving a real ticket through work is deliberately not a row. It needs the decision transaction, the mailbox and the scheduler — slices I2, I3 and I6 — and issue #77 already carries those dependencies. Putting it here would move the dependency without satisfying it.
