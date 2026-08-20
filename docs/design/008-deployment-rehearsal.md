# The deployment rehearsal

**Status: PROPOSED** — none of this is built; the landing table sequences it. The target is still GCP, and issue #75 is still the apply.

What changes is the order. The phases that need nothing from GCP are rehearsed first, on a local Kubernetes cluster, and the GCP apply is what remains.

## Why the order

P0 splits in two, and the halves are worth different amounts. One half — the Workload Identity Federation token exchange, persistent disk provisioning, the Artifact Registry pull credential, whether Cloud NAT lets the egress out — is a provider's own machinery. Getting it right proves that GCP was configured correctly. It proves nothing about chuggy. The other half — the GitOps loop, the git service, PostgreSQL roles and epoch fencing, backup and restore — is where every mistake that matters will be, because that half is what this tree designed and has never once executed. Rehearsing it where the edit-to-verdict loop is short finds those mistakes before a provider's error messages are standing in front of them.

This is not a cost argument. The rehearsal costs roughly what the apply costs; it is bought for the order, not the price.

`docs/design/006-durable-project-dispatch.md` permits the order. No statement in it needs GCP to hold a correctness property. It puts the mechanism in PostgreSQL ownership, saying that "Kubernetes supervision and placement are not"; and it calls managed PostgreSQL *the recommended production authority* so that losing the cluster does not also lose the record that reconstructs it — which is an argument about failure domains, not about correctness.

## What the rehearsal may not claim

006 also says acknowledged commits have "no expected loss under process, instance and zonal failure". A single machine cannot make that true, and the rehearsal must not pretend otherwise. That sentence is a claim about the production deployment; it is not an invariant any code satisfies, and nothing in `src/` can get it right or wrong. So the rehearsal's verdicts are confined to the mechanisms 006 does put in the code — ownership, fencing, the recovery epoch, the restore path. Zonal durability is bought at the apply and nowhere earlier.

## The rig

k3s, as it already runs: a single node, with Flannel, Traefik, a hostPath-backed default storage class, and Flux reconciling. It stays. A Talos and Cilium rehearsal is a later phase of its own, before the apply — machine configuration, bootstrap and default-deny egress are what it exists to exercise — rather than a rebuild of a rig that already reconciles.

PostgreSQL is the StatefulSet already in the cluster, not an external server. What the rehearsal is about is the deployment's relationship with a server: which identity migrates, which roles log in, what the recovery path writes before anything else may. An external server answers none of those differently, and it removes the one question that only an in-cluster server poses, which is who on the network may reach it.

## What the deployment owes PostgreSQL

The migration runs at start-up under an advisory lock and creates the tables and the group roles together, so the identity that runs it needs role creation. It must not be a superuser: cancellation is `SECURITY DEFINER` and executes with the privileges of whoever created it, so a superuser migration hands every caller a superuser. The group roles do not log in. A deployment therefore has to create a login role per service, grant it the membership, and issue its credentials — and nothing in this tree does that at any layer, so the rehearsal is where it first becomes something that runs rather than something that is described. No extension is required; digests are computed in the process.

The recovery epoch is a control-plane write the dispatcher role provably cannot make, so a fresh database and every restore alike need a path that establishes a never-reused epoch before the first mutation. Nothing here invokes a dump or a restore either. Those two belong in one row: a restore that cannot fence the writer it restored is not a restore.

## What no process reads

`src/` reads no environment variable at all. The connection string and the idempotency keying secrets are constructor arguments, which means no deployment can configure a chuggy process today. That gap is real and it is not this document's to close: it belongs to whichever slice first deploys a process. Issue #117 already fixes the shape for the keying secret — a mounted directory of versioned files, byte-identical across replicas, deliberately not an environment variable — and the connection string wants the same treatment rather than a different one.

## What the rehearsal cannot see

Said plainly, so nobody trusts it further than it goes: node-pool isolation, because one node makes work and system the same machine; default-deny egress, which needs the CNI the later phase brings; Talos machine configuration and bootstrap; CSI attach, detach and resize, because the rig's volumes are directories on a node; a real certificate chain; and every GCP row — the token exchange, disk provisioning, the registry pull credential, Cloud NAT's behaviour.

The Talos phase reaches the isolation, egress and machine-configuration rows. The rest is the apply's, which is why the apply is still a row.

## The seams that stay seams

The rig must not become a design input. The seams that keep it out are these, and they hold today: the secret source is a port with a single read, satisfied by a file adapter and a GCP one alike and chosen at compose time; image references come from a catalog file rather than from code, so no registry host appears in `src/`; nothing in `src/` names a storage class or a volume claim; the connection string is an argument.

**Refutation trigger.** A module under `src/` naming k3s, Traefik, the rig's storage class, or a hostname. That is what a leak looks like, and it is greppable.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| D0 | The rig's PostgreSQL made real: per-service login roles, the membership grants, `.chug/tasks/check-postgres.sh` <!-- intent --> run against the rig's server, and the policy that makes it reachable only from authorized workloads | I0, I1 | Proposed |
| D1 | The git service and the Flux loop: a git service over smart HTTP, the repository seeded, Flux reconciling from it | — | Proposed |
| D2 | The durability rehearsal: a real dump and restore, a fresh epoch established before any mutation, an old-epoch actor refused afterwards | D0 | Proposed |
| D3 | The Talos and Cilium rehearsal: a local Talos cluster, the pool labels and taints on genuinely separate nodes, default-deny egress | D1 | Proposed |
| D4 | The GCP apply, issue #75 | D0, D1, D2, D3 | Proposed |

D0 through D2 need nothing beyond I0 and I1, and `src/interpreter/secretSource.ts` <!-- intent --> is the only seam any of them touch.

Deploying the dispatcher and driving a real ticket through work is deliberately not a row. It needs the decision transaction, the mailbox and the scheduler — slices I2, I3 and I6 — and issue #77 already carries those dependencies. Putting it here would move the dependency without satisfying it.
