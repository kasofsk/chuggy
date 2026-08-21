# The deployment rehearsal

**Status: D0, D1, D2 AND D3 LANDED** — the rehearsal ran on the local k3s rig, and `deploy/rig/` carries it. Each row's procedure, the evidence it produces and the bounds on that evidence are in its own README, which is where they are now maintained and where a correction goes. What is left here is D4, the GCP apply, and the two things the rehearsal deliberately did not close.

## What no process reads

`src/` reads no environment variable at all. The connection string and the idempotency keying secrets are constructor arguments instead, so nothing deploys a chuggy process by configuring one — which is why every landed row drives the rig by hand or through a gate rather than by running the thing being deployed. That gap belongs to whichever slice first deploys a process. Issue #117 already fixes the shape for the keying secret — a mounted directory of versioned files, byte-identical across replicas, deliberately not an environment variable — and the connection string wants the same treatment rather than a different one.

**Refutation trigger.** `process.env` under `src/`.

## The seams that stay seams

The rig must not become a design input. `src/adapters/postgres/` is the one adapter the rehearsal reaches, and it takes its address as an argument, so it names nothing about where that address points. For a secret source, a registry and a storage class there is still no adapter at all, and an absence leaks nothing.

The seams themselves are the shapes `origin/infra-explore` proved and this tree has not re-landed — the secret source a port with a single read, satisfied by a file adapter and a GCP one alike and chosen at compose time; and image references from a catalog file rather than from code, so no registry host appears in `src/`. Re-landing them belongs to whichever slice first deploys a process, and until then the trigger below is the whole of the control.

**Refutation trigger.** A module under `src/` naming k3s, Traefik, the rig's storage class, or a hostname. That is what a leak looks like, and it is greppable.

## What the apply still owes

Each landed README ends on what it does not prove, and the union of those four sections is most of D4's scope; they are the text to re-read before the apply, not a summary here. Three bounds belong to no README, because no row was in a position to state them:

- **CSI attach, detach and resize.** The rig's volumes are directories on a node, so no row exercised a volume that can move.
- **Which mechanism answers reachability in production.** Issue #75 leaves managed against in-cluster PostgreSQL to the operator, and D0's network policy transfers only to the in-cluster choice.
- **Node machine configuration and bootstrap.** `docs/design/006-durable-project-dispatch.md` names Talos and issue #75 mandates it on GCE VMs. Issue #124 is where that stands, and it first meets reality at the apply whichever way it settles.

The rest is issue #75's own machinery — the Workload Identity Federation token exchange, persistent disk provisioning, the Artifact Registry pull credential and whether Cloud NAT lets the egress out. Getting it right proves GCP was configured correctly and proves nothing about chuggy, which is why it was left until last rather than rehearsed.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| D0 | The rig's PostgreSQL identities, their grants and the policy admitting them — `deploy/rig/postgres/` | I0, I1 | Landed |
| D1 | The git service and the Flux loop — `deploy/rig/git/` | — | Landed |
| D2 | The durability rehearsal, dump through fenced restore — `deploy/rig/durability/` | D0 | Landed |
| D3 | The isolation rehearsal, placement and egress — `deploy/rig/isolation/` | — | Landed |
| D4 | The GCP apply, issues #75 and #76 | D0, D1, D2, D3 | Proposed |

Deploying the ticket service and driving a real ticket through work is still not a row, but the reason has changed. The slices it waited on — the decision transaction, the mailbox and the scheduler, I2, I3 and I6 — have all landed, so what stands between the rig and a real ticket is no longer a missing decision but the configuration gap above: nothing can tell a chuggy process which server to open. Issue #77 carries that row, and closing #117's shape for both secrets is what unblocks it.
