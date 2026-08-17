# The SQLite journal

**Status: PROPOSED** — kasofsk/chuggy#67 is the ticket.

The durable store is one SQLite database on the dispatcher's own volume, opened by the dispatcher process alone, streamed out by a replication sidecar. Every reader the world needs goes through the dispatcher's own face, because a store a second process reads is a store a second process eventually learns to write.

## The shape

The journal table's primary key is the sequence number, which is two of the tree's obligations in one mechanism: the dedup memory that must outlive the process, and a second line of defense for Single writer — a rollout that briefly runs two dispatchers has the loser crash on the constraint rather than fork history. Rows are wire text and every load passes the parse, exactly as the stub keeps them; the cursor is stored beside the rows and deliberately not with them, because a lost checkpoint re-emitting its suffix is the model's own drawn regression. Each adapter creates and solely owns its side tables; no table has two writers, and none stores what the journal derives (standing rule 3) — there is no task-instance table, because the journal is it.

## What is deliberately absent

No compaction: the journal grows by one entry per decision, every re-entry is metered by the economy, and a snapshot is a replay prefix — sound by `recoveryComplete` whenever length actually hurts, adoptable then without a model change. One honest note travels with that: the configured ticket bound caps the fleet for the store's lifetime, so the first deployment sets it high, and compaction and the bound are one future decision rather than two.

## What the process assumes of replication

Write-ahead mode, one writer, the database at a stable configured path — and nothing else. The sidecar that streams it out and the restore that reads it back are the deployment's (doc 015); the process cannot tell whether it is replicated, which is the property that keeps the store an adapter.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R1 | The store, its schema, the crash and tamper suite | #66 | Proposed |
