# chuggy

A job orchestrator. Tickets form a DAG; one durable project processor decides;
the fabric runs the work and decides nothing.

**The formal model leads.** A Quint model of the machine is proved first and emits golden traces; this implementation grows up against them. When the two disagree, the implementation is wrong.

New projects use the ticket machine of the `@kasofsk/chug-ticket-domain`
dependency, which the lockfile pins. Its Quint models, and the golden traces
holding its core to them, are proved in that package and are not restated here;
`node scripts/build-ticket-domain.ts --check` verifies the TypeScript this tree
compiles from it. Nothing else is vendored: the application code around the
domain is this tree's own, as is the [processing
contract](model/application/project-decision-processing/processing.qnt).
Existing legacy projects retain their data and return `LegacyModelUnsupported`.

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
