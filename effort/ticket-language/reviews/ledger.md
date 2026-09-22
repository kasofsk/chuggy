# PR 1 review ledger

| Round | Branch | Verdict | Notes |
|---|---|---|---|
| S-round1 | schema/no-accounts cf708286 | APPROVE | two relays to B (leadHttpReads on gas_left; jsonb precondition + coupling test). Opus attribution left as-is. |
| A-round1 | model/no-accounts dc867998 | CHANGES | 8 findings: 7 stale prose (decisionSemantics header the real one), 1 dead export; machine held every probe. Fix on model/no-accounts-review-a. |
| A-round2 | model/no-accounts-review-a f80cf32c | CHANGES | 2 prose findings (3 stale spec citations; ids.ts claim); fixed by orchestrator in the next commit; final whole-branch review checks them. |
| B (author) | model/no-accounts eb7f1fdb | — | 6 commits; journal chain over stored bytes; 8c7cfcfd edited the landed baseline → B-fix0 moves it into 004 on model/no-accounts-fixb. |
| B-fix0 (author) | model/no-accounts-fixb 6fcb53cf | — | baseline byte-identical to main; bound moved into 004 (DROP/ADD CHECK + replace() on settings and history); render diff additions-only; folded into B round 1 scope. |
| B round 1 | eb7f1fdb + 6fcb53cf | CHANGES | (1) finalization failure spends the rework cap — contradicts the uncapped-finalizer decision; (2) session_turn CHECK narrowed outside 004's guard. Journal-chain fix judged stronger than before; no dispatchViewSchemaVersion bump right. → B-fix1 on fixb. |
| B-fix1 (author) | model/no-accounts-fixb f4a86f29 | — | count renamed evaluationFailureReworksStarted, >= cyclesMax; 004 guard gains session_turn arm; refusal text reworded. |
| C (author) | model/no-accounts ba75bdab | — | console loses accounts; full ci.sh clean. Orchestrator review: every action labelled free → 7429fe4f drops the cost slot and renames ActionWithCost→OfferedAction. |
| integration | model/no-accounts 7429fe4f | — | merges 97118367 (review-a) and c3a1e054 (fixb); ids.ts conflict resolved to the reviewed text; fast gates green. |
| sweep | 7429fe4f | APPROVE | 26 mutations, 23 red in the named suite; 3 unpinned, none a defect; five stale-claim docs + one fixture → 75e701c3. |
| B round 2 | f4a86f29 | APPROVE | both fixes hold under nine driven histories; note: a stale Failed from an ExecutionBlocked eval set colours the next work run — undecidable from tasks; comments narrowed in ed19f15c on model/no-accounts. |
