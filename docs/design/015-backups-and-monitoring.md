# Backups and monitoring

**Status: PROPOSED** — kasofsk/chuggy#75 through #77 carry the pieces.

Every stateful thing names its backup and its rehearsed restore, and observability stays small enough that one operator reads all of it.

## The restores, by what their loss would mean

The journal is the machine's memory and the one state nothing else can reconstruct, so its replica is the one restore continuously proven: a sidecar streams it to object storage, an empty volume restores itself at boot, and a scheduled job restores to scratch and holds the result against the replica — an unverified control being worse than none. Repositories bundle out on every default-branch movement and nightly besides (doc 013); their restore is rehearsed before the first deploy depends on them. The cluster's state is scheduled snapshots plus the machine configurations under `infra/` <!-- intent -->, so the worst day is machines re-created, the snapshot restored, and volumes re-attached. User credentials are deliberately exported nowhere: their store already replicates, and re-supply by their owners is cheaper than an export is dangerous.

## Monitoring

Metrics and logs ship to a hosted sink rather than to storage this cluster would then have to protect; the alert set is small and each one names an action — the dispatcher not serving, the sync not converging, replication lagging, a volume filling, a certificate expiring, a node gone. One uptime check lives outside the cluster entirely and watches the desk's health endpoint, because a dead cluster cannot report itself dead.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| P0 | Buckets, the snapshot schedule, the outside uptime check | — | Proposed |
| P1 | Metric and log shipping | P0 | Proposed |
| P2 | Both restores rehearsed | P1 | Proposed |
