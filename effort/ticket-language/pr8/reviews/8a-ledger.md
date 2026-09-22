# PR 8a — review ledger (branch `model/released-ticket`)

| round | tip | reviewer | verdict | fix |
|---|---|---|---|---|
| 1 machine | 378eb585 | opus, fresh | CHANGES: `stageDefinitionEquals` blind to an evaluator's `task`, `instanceEquals` blind to `acceptedSourceRef` (recoveryComplete/evaluationsWellFormed weaker than the model's `==`); nits: AGENTS.md `taskOwner`, source-band comment | orchestrator in-line: conjuncts + `FieldMutants` rosters, red-proved |
| 1 boundary | 378eb585 | opus, fresh | CHANGES: door's stage conjunct unheld (every fixture one stage); B's departures weighed clean (transient deferral is main's, narrowed; sourceless `submit_worker_result` overload has no caller); two report lines overstate (`ImpossibleState` kind kept with new evidence; reserved source lives in `executionSource.ts` and is near-unreachable since a release refuses a brief without a repository) | orchestrator in-line: two-stage door case, red-proved |
| sweep | a7923309 | opus, fresh | APPROVE: 91 mutations, 58 red, 0 behaviour defects; 6 proof gaps (release-refusal conjuncts, TS exact-obligation, dispatch source floor, per-stage stored material, refusal evidences, two codecs); README false claim on `ticket_definition` readers | E (`tasks/8a/E.md`, tests and docs only) |

## Build

- A landed 59cea038 (`tasks/8a/A-report.md`); S landed 3c10ad8f (`S-report.md`); merged 36a9df7a.
- B (opus) on `model/released-ticket` from 36a9df7a, brief `tasks/8a/B.md` + Addendum (A's codec, S's four findings) + Settled (evaluator `contextRef` = accepted `resultRef`; `id`).
- B landed 3dd30cbe (`tasks/8a/B-report.md`); orchestrator rewrote B's attribution trailers (filter-branch, tip cefa77f2).
- D (opus) on the tip: the accepted work result is the report's reference in model, domain and door (B's item 1 settled the other way; `tasks/8a/D.md`).
- D landed 6f7a3788 (`tasks/8a/D-report.md`); affected roster on the tip in `pr8/ci-affected-8a-build.log`.

Tip for round 1: 378eb585 (D + one Prettier commit; affected roster clean, first run false-red on check-random killed at its cap inside ci.sh, sub-second alone).
- Round 1 fixes: a3ad1cf2 (equality), a7923309 (door case). Affected roster on the tip in `pr8/ci-affected-8a-round1.log`.

Tip for sweep: a7923309 (round 1 fixes in; affected roster clean, `pr8/ci-affected-8a-round1.log`).
- E landed e3a353a6 (`tasks/8a/E-report.md`): six gaps pinned, README and AGENTS.md fixed; full roster on the tip in `pr8/ci-full-8a-e3a353a6.log`.
- Merged #732 (main 5c15a8b7); test-race fix #733 (main 02bd9572); released to the rig with the wipe 2026-09-22 ~16:30Z, sanity ticket Done at seq 8 (`pr8/GOAL.md`).
