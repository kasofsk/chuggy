# F1 report

Tip: `a704946c` (two commits on top of `64e5abb5`).

1. `50a99aca` — `ui/chuggy-ui/test/codeLabels.test.ts`: added
   `...blockedReasons.map(blockedReasonLabel)` to the copy-budget `drawn`
   array, plus a new test covering `escalationDetail`'s wall-present
   (`blockedReasonLabel`) and wall-absent (`escalationReasonLabel`) arms.
   Red-proofed: blanked `ExecutionProfileUnavailable`'s return, confirmed
   both the budget test and the new test failed, reverted.
2. `a704946c` — comments: `inboxUnion.ts:8` and `inboxApproval.test.tsx:6`
   now say `` `Finalization` `` instead of `` `Finalizing` ``;
   `leadTurn.test.ts:422` and `selector.test.ts:2723` now say `` left ...
   in `Work` `` to match `leadTurn.ts:345`; `codeLabels.ts:142-146` keeps
   the gerund-mapping sentence and drops the PR-bound clause.

Gates: `check-console.sh` 0, `check-source.sh` 0, `check-comments.sh` 0
(907 files), `check-figures.sh` 0 (102 files). No `npm ci` needed (root
install was current). Never pushed.
