# chuggy

A job orchestrator. Tickets form a DAG; one journaled actor decides everything; the fabric runs the work and decides nothing.

**The formal model leads.** A Quint model of the machine is proved first and emits golden traces; this implementation grows up against them. When the two disagree, the implementation is wrong.

Start at [CLAUDE.md](./CLAUDE.md) — it is the entry point for humans and agents alike, and routes to the rest.

## Status

The machine runs. `npm start` boots the composition root — `src/compose.ts` — which replays the SQLite journal, re-drives what a crash left holding, and serves the desk over HTTP; the environment names the rest, and each half falls back to a recording stub where it names nothing: the fabric runs Kubernetes Jobs against a configured API, and the wrap-up merges over git against a configured remote. The proved model in `model/` still leads — the implementation replays its golden traces — and the crash suite in `test/entrypoint/` kills the dispatcher mid-flight and proves recovery at process level. A first real ticket has been driven end to end with `.chug/tasks/ci.sh` as its evaluator; `npm run demo` reruns it. What remains is the platform's applies: the cloud foundation under `infra/` is written and none of it is applied, so every deployment so far is a local process.

```sh
just hooks    # once per clone
just check    # every gate
```
