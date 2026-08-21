# chuggy

A job orchestrator. Tickets form a DAG; one journaled actor decides everything; the fabric runs the work and decides nothing.

**The formal model leads.** A Quint model of the machine is proved first and emits golden traces; this implementation grows up against them. When the two disagree, the implementation is wrong.

Start at [CLAUDE.md](./CLAUDE.md) — it is the entry point for humans and agents alike, and routes to the rest.

## Status

What exists today is the proved model, the implementation, and the gates that run over this tree. The written standards that accompanied them have been removed; each gate now carries its own rule in its own header, which is where a rule cannot drift from its enforcement. `CLAUDE.md` names the two places this tree states what is true of itself.

```sh
just hooks    # once per clone
just check    # every gate
```
