# chuggy

A job orchestrator. Tickets form a DAG; one journaled actor decides everything; the fabric runs the work and decides nothing.

**The formal model leads.** A Quint model of the machine is proved first and emits golden traces; this implementation grows up against them. When the two disagree, the implementation is wrong.

Start at [CLAUDE.md](./CLAUDE.md) — it is the entry point for humans and agents alike, and routes to the rest.

## Status

Pre-implementation. What exists today is the standards apparatus and its gates, deliberately landed **before** any code: the comment ban, the doc policy and the boundary rules are cheap to adopt on an empty tree and expensive to retrofit onto a full one, which is the mistake this repo exists partly to avoid repeating.

```sh
just hooks    # once per clone
just check    # every gate
```
