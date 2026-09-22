# Review round 1, machine half — PR 8a "The released ticket" (branch `model/released-ticket`)

You did not write this change. Review it fresh in a detached worktree of your own at the tip named in `reviews/8a-ledger.md`:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/released-review-machine <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/released-review-machine/node_modules

Never `npm ci` under `ui/`. Standing prefixes: Node 24 on PATH, `TMPDIR=/tmp`, `FORCE_COLOR=0 NO_COLOR=1`. Your half: `model/`, `test/golden`, `src/generated`, `src/domain`, `src/actor`, and their tests. The boundary half (`src/interpreter`, `src/adapters`, `src/contract`, migration 013) is another reviewer's. Diff: `git diff aaaff1ec..<tip> -- <your paths>`.

Read first: `~/claude/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8a — decisions", `pr8/survey.md` §1, §5, §6 and surprises 1, 3, 9, 12, `pr8/tasks/8a/{A,S,B}-report.md`, the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/ticket.qnt` (types, `releasedTicketValid`, `workTaskObligation`, the `source` chain through `decideDispatch`, the work-pass arm, rework, resume and finalization) and `README.md` lines 5–13, 29–31, `.chug/tasks/review-change.md`, `CLAUDE.md`.

## What to check, each with a failure that actually happens

1. The copies: `diff` the package's `task.qnt` and `evaluation.qnt` against `model/task-contract/task.qnt` and `model/ticket-domain/evaluation/evaluation.qnt`; both empty. `model/AGENTS.md` says verbatim for both and names no divergence. Any residue is a finding.
2. The source chain (decision 2): dispatch at source 9, work passes with `acceptedSourceRef` 11, the instance is begun with `acceptedSourceRef` 11 and `workResult` = the report's `resultRef`; an evaluation-failure rework, a finalization needs-work rework, a resume from every escalation and the finalizer all spawn at 11 and nothing re-reads 9; the invariant `sourcePinned` holds (`source > 0` exactly when dispatched) and the copy's `acceptedSourceRef > 0` holds of every instance. Mutate the work-pass arm to keep the dispatch source and confirm a model test or a golden reddens.
3. The exact-obligation rule (decision 3): a work report whose `result.obligation.definition` differs from `ticket.definition.workConfiguration`, whose `contextRef` is not the cycle, or whose identity is stale, is not enabled; an evaluator's report whose obligation differs from the one `currentTaskObligations` owes is not enabled, and `contextRef` for an evaluator equals the instance's `workResult`. A failure report still matches by identity alone. `reportAdmissibilityRequiredTest` red-proofs the rule; mutate `reportMatchesTask` to compare identities only and confirm it reddens.
4. `releasedTicketValid`: the package's conditions plus chuggy's bounds; positional stage keys, unique evaluator keys, every evaluator carrying a valid task; `definitionsWellFormed` holds after every step of every golden; a `CreateTicket` with a zero ref is not enabled.
5. Goldens re-emitted, not hand-edited (`emit-goldens.sh` byte for byte; `manifest.json` steps current); decision 10's four shapes present and the fifth's absence argued (A-report); the walk in `test/random/draws.ts` draws sources and definitions from bands a reader can tell apart; `check-conformance`, `check-random`, `check-model`, `check-model-api` at the tip.
6. `src/domain`/`src/actor`: `applyProduced` holds the `ValidatedTaskResult` against the obligation with the same rule the model states (`*Equals` over the whole obligation, not the identity); `currentTaskObligations` returns obligations whose `definition` is the evaluator's own `task`; `idsAccounted` untouched in meaning.
7. Comments and docs: true, in the tree's voice, no quantities, no stale path claims; the `source` and `definition` field docs say where the package puts each value; `git grep -n '\bdeps\b\|\bprog\b\|program\b' model src/domain src/actor` is empty or every hit justified. Run `check-figures`, `check-comments`, `check-paths`, `check-duplication` at the tip.

Verdict to `~/claude/chuggy-effort/ticket-language/pr8/reviews/8a-round1-machine.md`: APPROVE or CHANGES; each finding names file:line, the input and what goes wrong; under ~80 lines. Remove your worktree when done. Write the verdict, reply with it, and stop.
