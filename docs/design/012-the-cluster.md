# The cluster

**Status: PROPOSED** — the P0 files are in `infra/`; kasofsk/chuggy#75 carries the applies, which are an operator's hand, forever.

Self-managed Kubernetes on Talos, on GCE machines, with node pools carrying the authority split. Managed infrastructure — the secret store, object storage, the image registry — stays the cloud's; the cluster itself does not, so the deployment owns its control plane and everything stateful below it states its restore (doc 015).

## Why Talos

The work pool runs agent-authored code, so the node surface is the exposure: Talos nodes carry no shell, no remote login and no package manager, and their whole configuration is declarative files applied over an authenticated API. That is the node-local tier of the authority split made literal — a node grants capability out of its own configuration, which nothing inside the cluster can request — and it is also the one-operator upgrade story: atomic image upgrades with rollback, and a managed etcd with role-scoped snapshot access.

## Pools are the split

A container escape onto a node that also mounts the journal volume or the repositories is journal tampering — a Single-writer violation no namespace boundary prevents — so the boundary is physical placement. The work pool is tainted and labeled, attracts only task Jobs, and its nodes grant nothing beyond pulling images; the system pool holds the dispatcher, the git service and every privileged workload. Advertised capacity and granted capability stay two halves, both failing closed at the node.

## Workload identity and the network

In-cluster workloads reach cloud services by federation against the cluster's own service-account issuer — one cloud account per workload, impersonable only by its own service account, no key files anywhere. The instance metadata service is unreachable from pods, so node identity cannot be stolen by the code a job runs; the job namespace is default-deny egress, opened only to name resolution, the git service, the dispatcher's completion endpoint and the public internet's TLS ports; and job pods mount no cluster API token at all.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| P0 | `infra/terraform`, `infra/talos` and `infra/runbooks/phase-0.md` | — | **Landed** |
