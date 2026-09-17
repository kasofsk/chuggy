# chuggy

A job orchestrator. Tickets form a DAG; one durable project processor decides;
the fabric runs the work and decides nothing.

**The formal model leads.** A Quint model of the machine is proved first and emits golden traces; this implementation grows up against them. When the two disagree, the implementation is wrong.

New projects use the pinned Chuggernaut [ticket model](model/ticket-domain/ticket.qnt),
[evaluation model](model/ticket-domain/evaluation/evaluation.qnt),
[task contract](model/task-contract/task.qnt), and
[processing contract](model/application/project-decision-processing/processing.qnt).
The [source manifest](vendor/chuggernaut/source.json) pins upstream bytes;
`node scripts/build-ticket-domain.ts --check` verifies the generated TypeScript
runtime and trace replay helpers. Existing legacy projects retain their data
and return `LegacyModelUnsupported`.

Tickets use the [ticket/catalog schema](src/adapters/catalog/schemas/ticket.json)
from an exact repository commit. The [PR finalizer](src/adapters/catalog/schemas/finalizer.json)
opens a pull request; `merge: true` also merges it before reporting success.

Start at [CLAUDE.md](./CLAUDE.md) — it is the entry point for humans and agents alike, and routes to the rest.

## Status

What exists today is the proved model, the implementation, and the gates that run over this tree. The written standards that accompanied them have been removed; each gate now carries its own rule in its own header, which is where a rule cannot drift from its enforcement. `CLAUDE.md` names the two places this tree states what is true of itself. A fresh clone runs `npm ci` before any gate can reach a verdict.

```sh
just hooks    # once per clone
just check    # gates affected by this change
just check-full
```
