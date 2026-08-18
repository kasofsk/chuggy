# The durable infrastructure boundary

**Status: PROPOSED** — the runtime has made no storage choice yet. This document recommends PostgreSQL as the durable authority and keeps NATS as an optional communication adapter when worker topology or event fan-out earns it. The implementation is tracked by issue #92.

## Decision

Clients call the authenticated web API. The API does not call the dispatcher as the authoritative mutation path; it submits an idempotent command to a durable inbox. The dispatcher is the only consumer allowed to turn that command into a domain decision and append it to the journal.

PostgreSQL is the default adapter for the inbox, journal, command results and effect outbox. The choice follows from the product's queryable record — tickets, tasks, dependencies, human work, command status and audit history — rather than from Kubernetes. Kubernetes supplies placement, discovery and supervision; it supplies none of the durability, ordering or idempotence this boundary requires.

NATS is not rejected. It remains a candidate adapter for worker request/reply, ephemeral status and downstream event fan-out when those needs justify another stateful service. It is not required between the API and dispatcher, and it is not the system of record.

## Command path

The API authenticates and authorizes a mutation, validates its wire shape, and submits a command envelope carrying a stable command id, tenant and principal identity, an idempotency key, the typed command, and trace context. Submission durably creates an operation. A repeated idempotency key returns that operation rather than another command.

The preferred HTTP result is an accepted operation resource. The API may wait briefly for a completed result as a latency optimization, but a timeout does not make command acceptance ambiguous: the client can read the operation or retry with the same key.

The dispatcher's durable consumer polls the inbox in storage order. A notification may wake it early, but the stored row is the truth and polling recovers every missed notification. The dispatcher records either the journaled decision or the domain refusal as the operation result.

Reads do not pass through the actor merely because writes do. The API reads projections suitable for lists, filters and history. A query that specifically requires the actor's current linearized position must say so in its contract and enter the actor as a message.

## Single writer

Every decision-bearing input — client command, worker completion, timer or operator action — enters one bounded in-process mailbox. One loop owns the actor state, receives one message, decides, durably appends, installs the post-state and replies. Concurrent handlers and effect workers never hold mutable actor state.

The mailbox is the primary serialization mechanism. Storage independently fences the journal head: an append supplies the expected preceding sequence, and the adapter rejects a stale append. A uniqueness constraint on sequence and a durable dispatcher epoch prevent an accidentally concurrent or stale process from becoming a second writer.

Running one dispatcher replica is not the correctness mechanism. An active/standby deployment may elect a leader through a Kubernetes Lease or a storage-backed lock, but leadership is operational availability; the journal's conditional append is the final authority.

## Decisions and effects

Command acknowledgement follows the durable decision, not its external effects:

```text
command -> decide -> journal and outbox commit -> operation result
                                      |
                                      v
                             idempotent delivery
```

Effect delivery is at least once. Its identity remains the deciding sequence and the effect's position in that decision. A slow Git operation, worker launch or desk update therefore does not need to block the actor from deciding the next command, while no effect can exist without the journal entry that authorized it.

The initial implementation may drain effects serially for simplicity. Parallel delivery is a later adapter concern only if measurement requires it; it cannot move decisions out of the actor or weaken per-effect idempotence.

## Ports, not a generic bus

The infrastructure boundary names the semantics the application needs rather than the product that happens to provide them:

| Port | Promise |
|---|---|
| command inbox | durable idempotent submission, bounded consumption and durable result |
| journal store | ordered recovery and conditional append at an expected head |
| effect outbox | recoverable at-least-once delivery keyed by decision and position |
| leadership | one active dispatcher identity with a fencing epoch |
| query store | authorized projections for API reads |
| worker client | bounded request/reply without durable secret retention |

SQL notifications, NATS subjects, consumer acknowledgements and Kubernetes Lease objects stay inside adapters. In particular, no `MessageBus` abstraction joins unrelated guarantees and recreates the coupling this boundary exists to prevent.

## Why PostgreSQL first

Chuggy is not yet committed to PostgreSQL: the repository has only the `JournalStore` contract and its in-memory adapter. PostgreSQL is recommended because the web product needs relational queries and because one transaction can commit the journal entry, operation result, durable effects and projections together. Permanent uniqueness constraints also express business idempotency without relying on a transport's finite duplicate-detection window.

NATS with JetStream can implement durable commands, ordered streams, redelivery and compare-and-set. It is preferable if messaging itself becomes the system's dominant workload. Making it the primary store today would leave API filtering and reporting to custom key layouts or a second projected database, introducing the cross-system delivery seam the PostgreSQL transaction avoids.

Adding both systems at the outset is not the simple default. NATS enters when a measured need for worker routing, streaming throughput or independent subscribers outweighs its deployment, backup and cross-system delivery costs.

## Landing

| Slice | Contract | Outcome | Depends on | Status |
|---|---|---|---|---|
| I0 | journal append | expected-head append is part of the port and exercised against a competing writer | — | Proposed |
| I1 | command envelope | typed submission, refusal and operation-result vocabulary | I0 | Proposed |
| I2 | runtime actor | bounded mailbox is the only route to a decision | I1 | Proposed |
| I3 | PostgreSQL adapter | inbox, journal, results and effects share the durable authority | I0, I1 | Proposed |
| I4 | deployment | leader election, fencing identity, readiness and recovery | I2, I3 | Proposed |
| I5 | API bridge | authenticated mutations submit operations; reads use projections | I1, I3 | Proposed |
| I6 | worker transport | choose Kubernetes RPC first; introduce NATS only against an observed need | I2, I4 | Proposed |

The model leads any change to the actor's step relation. These slices supply runtime serialization and durable adapters around that relation; they do not add a second writer or move effects into deciders.
