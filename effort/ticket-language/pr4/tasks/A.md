# Task A — the model, goldens, generated mirror, domain and actor

Worktree `~/claude/chuggy-wt/finunavail`, branch `model/finalization-unavailable` off main e5f7b3d3. Run `npm ci` at the root (never inside `ui/chuggy-ui/`). Read, in order: `~/claude/chuggy-effort/ticket-language/pr4/GOAL.md` (decisions are settled; **Model** and **The package's shape** paragraphs are yours), `pr4/survey.md` §1–§3 and §10.1–§10.2, `CLAUDE.md`, `.chug/tasks/review-change.md`, the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/ticket.qnt` around `FinalizationResult`, `TicketFinalizationUnavailable` and `TicketFinalizationResumed` (the shape you are converging on; chuggy keeps its own state shape), then `model/ticket.qnt`, `model/domain.qnt` (`decideFinalizationResult`, `decideResumeTicket`, `escalate`, `finalizationOutcomes`), `model/refinement.qnt`, `model/api.qnt`, `model/tests/`.

## Scope

- `model/`: `FinalizationOutcome` gains `FinalizationResultUnavailable`; `Reason` gains `FinalizationUnavailableEscalated`; `decideFinalizationResult` escalates on it with `ResumeFinalization` and the label `ticket-escalated finalization_unavailable_escalated`; every match and draw over the outcome (`finalizationOutcomes`, refinement, api, mc) takes the branch; the `ResumeFinalization` test at `chuggy_test.qnt:499-503` is rebuilt on the reachable path and the hand-built one deleted; a property or invariant that names the reason roster is extended, none added.
- Goldens: the tenth aimed trace `test/golden/finalization-unavailable.itf.json` firing the new label and then `ticket-resumed` into Finalization with `RunFinalizer`; `manifest.json` row and invariants; witness roster count in `check-model.sh`/`.test.sh` re-checked; every golden re-emitted with `.chug/tasks/emit-goldens.sh` (all committed bytes must be what it emits); `coverage.test.ts` regenerates.
- `src/domain/generated/modelTypes.ts`, `src/generated/model-api.ts` regenerated; `src/domain/*` rosters and switches (`finalizationOutcomeTags`, reason tags, step labels) and the decider.
- `src/actor/`: `decisionSemanticsVersionCurrent` stays 5 — say in the header why an added value moves nothing (survey §3); `rowAtCurrentVocabulary` unchanged; a test that a row carrying the new reason and one carrying the new outcome replay legal at 5.
- `test/conformance/`, `test/random/`: draws cover the third outcome.
- Every comment in your layers that enumerates the outcomes or reasons.

NOT yours: `src/interpreter/`, `src/adapters/`, `src/contract/`, migrations, `ui/`. If a compile forces an edit there, make the smallest one and list it (Task B owns the substance). The interpreter's finalizer will submit the new outcome; you only make the domain accept it.

## Gates

`check-model` (the slow one; run it once on your tip), `check-model-api`, `check-conformance`, `check-random`, `check-source --static` (unit reds outside your layers are expected and listed), `check-figures`, `check-comments`, `check-paths`, and the two suites `sh .chug/tasks/check-conformance.test.sh`, `sh .chug/tasks/check-random.test.sh` (they hardcode a golden name and a walk seed; PR 3 found them only in the full roster). Report each exit on the tip.

## Commits

Small, on `model/finalization-unavailable`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push.

## Report

`~/claude/chuggy-effort/ticket-language/pr4/tasks/A-report.md`: tip, what changed per layer, the golden's shape, files outside your layers touched, unit reds left for B, gates on the tip, anything GOAL.md got wrong. Under ~50 lines.
