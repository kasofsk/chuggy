# The SQLite journal

**Status: LANDED** — R1 has landed; kasofsk/chuggy#67 was the ticket.

The durable store is one SQLite database on the dispatcher's own volume, opened by the dispatcher process alone, streamed out by a replication sidecar. Every reader the world needs goes through the dispatcher's own face, because a store a second process reads is a store a second process eventually learns to write. `src/adapters/sqliteJournal.ts` is the store and states what it carries; opening the one database is the composition root's with the runtime (doc 006), and streaming it out is the deployment's (doc 015).

## The tables the other adapters may add

Each adapter creates and solely owns its side tables. No table has two writers, and none stores what the journal derives (standing rule 3) — there is no task-instance table, because the journal is it.

## What is deliberately absent

No compaction: the journal grows by one entry per decision, every re-entry is metered by the economy, and a snapshot is a replay prefix — sound by `recoveryComplete` whenever length actually hurts, adoptable then without a model change. One honest note travels with that: the configured ticket bound caps the fleet for the store's lifetime, so the first deployment sets it high, and compaction and the bound are one future decision rather than two.

## What the process assumes of replication

Write-ahead mode, one writer, the database at a stable configured path — and nothing else. The sidecar that streams it out and the restore that reads it back are the deployment's (doc 015); the process cannot tell whether it is replicated, which is the property that keeps the store an adapter.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R1 | The store, its schema, the crash and tamper suite | #66 | **Landed** |
