# Review round 1, machine half — PR 6a "Work fan-out goes" (branch `model/work-fanout-goes`)

You did not write this change. Review it fresh in a detached worktree of your own at the tip named in `reviews/ledger.md`:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/fanout-review-machine <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/fanout-review-machine/node_modules

Never `npm ci` under `ui/`. Your half: `model/`, `test/golden`, `src/generated`, `src/domain`, `src/actor`, `src/interpreter`, `src/adapters`, `src/contract`, `src/adapters/postgres/schema/migrations/009-work-fanout.ts`, `.chug/tasks/check-random.test.sh`, and their tests. The surface half (`ui/`, `test/ui`) is another reviewer's. Diff: `git diff 0f94fe6b..<tip> -- <your paths>`.

Read first: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md` (the split and the decision: a work cycle is one task, as the package's `WorkTask{ticket, cycle}` has it; the rig's tickets are wiped, no lift), `pr6/survey.md` surprise 1, `pr6/tasks/{A,S,B}-report.md`, `.chug/tasks/review-change.md`, `CLAUDE.md`.

## What to check, each with a failure that actually happens

1. The model: is every work spawn one task and nothing else changed? `spawnWork` against `spawnOn`; `tasksWellFormed`'s Work arm; the four spawn sites; the `CreateTicket` payload in `refinement.qnt`; `N_TASKS` still the evaluation ceiling. Diff `model/ticket.qnt` against the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/ticket.qnt` where work tasks are spawned: is the shape closer, and is anything now further?
2. Goldens: re-emitted, not hand-edited (`.chug/tasks/emit-goldens.sh` reproduces them byte for byte); `manifest.json` invariants true of the new traces; `check-random.test.sh`'s re-pinned seed finds the mutant it names and the old seed no longer does (re-run both).
3. 009: guard first, byte-identical to 008's; the `dispatch_candidate` CHECK restated over the two floors (B's report says dropping the column silently drops the multi-column CHECK: prove it on the server); `decision_event_is_valid` refuses a `CreateTicket` naming `workFanout` (S chose refusal over 005's fall-out; is it right under the wipe, and does any writer still name the field?); the mailbox bound B added — `session_turn_text_is_bounded` re-rendered, `tokensPerDecision` re-seeded, the second guard — is the derivation right (`test/adapters/leadTokenBudget.test.ts`) and is the re-seed what 005 did? Render-diff of 001–008 main vs branch empty (`~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs`). Re-prove three of S's red-proofs and two of B's mailbox cases by mutation.
4. Stored text: every reader of a release event as opaque text (`draft_revision.authoring`, `operation.command`, `selector_proposal_delivery.command`; memory `~/.claude/projects/-home-geoff-claude-chuggy/memory/stored-text-outside-the-journal.md`) parses the new shape and refuses or strips the old field consistently — B says the generated codec does it; confirm, and say what a row naming `workFanout` does at each reader.
5. `executionSourceObservation.ts`'s several-commit branch, left standing (B's flag): unreachable at one task? If so, is a total rule over an unreachable case a comment problem, a deletion, or fine? Say which and why. `finalizerPreparation.ts`'s "latest spawn first" ordering: still meaningful at one task per cycle across cycles?
6. The dispatch view digest changed (`canonicalCandidate`): does any stored digest or selector fence compare against it across the release, and what happens to a stored view after the wipe?
7. Comments and docs: true, in the tree's voice, no quantities, no stale path claims; nothing still says a ticket chooses a work width. Run `check-figures`, `check-comments`, `check-paths`, `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-random` at the tip.

Verdict to `~/claude/chuggy-effort/ticket-language/pr6/reviews/round1-machine.md`: APPROVE or CHANGES; each finding names file:line, the input and what goes wrong; under ~80 lines. Remove your worktree when done. Reply with the verdict and the findings only.
