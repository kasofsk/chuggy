| round | scope | reviewer verdict | findings | fixed by |
|---|---|---|---|---|
| 1 | machine at 8a4cd92d | CHANGES (one comment) | chuggy_witness_test.qnt:154 says "the only resume that re-enters the phase it left" — ResumeEvaluation does too; restate as "re-runs the step it interrupted". Notes: 007 header overstates chuggy_api's need for hold_passes/held_since | F1 |
| 1 | surface at 344d443b | CHANGES (no behaviour defect) | (1) per-request heldReason reset at finalizerRun.ts:1766 unproved (two requests in one pass); (2) finalizerPrivileges.test.ts:412,:432 not extended to record_finalization_hold (prosecdef, search_path); (3) label "Proposal base is already head" → noun phrase | F1 |
| 1 fix | F1 at d38edc9a | — | two-request pass case; three-door privilege cases; noun label | — |
- sweep (d38edc9a): APPROVE, 50 mutations, 10 survivors none a behaviour defect, full roster clean. Three unpinned claims → pinned by the orchestrator (finalization_blocked_by's reason term and DESC, the finalization park's detail line); each red-proved by its mutation. Merged origin/main (#724) in; full roster running.
