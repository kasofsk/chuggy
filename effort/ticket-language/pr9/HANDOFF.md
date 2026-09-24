# Ticket-language handoff — PR 9

2026-09-24 · David. Exported from the live doc (https://claude.ai/artifact/Tbt1x5oUKewK7hywWVTeZr, visible once David shares it). In this branch, `~/chuggy-effort/ticket-language/` means `effort/ticket-language/`.

PR 8 is done and released; PR 9 — importing the package's ticket_domain — is sized, and waits on four decisions before its first builders go out.

## Where things stand

main is **f8998a22** and the gtr rig runs it: migrations through 017, decision semantics 8, package pinned at 76c95a9. Rig tickets 1 and 2 are both Done; nothing is in flight.

| PR | Main | Migration | Wipe | What |
| --- | --- | --- | --- | --- |
| #737 fix | f8998a22 | 017 | no | The ticket service may re-pin; durable suites decide as the writer's role |
| 8c-2 #736 | ccbf0c38 | 016 | no | `UpdateTicket`, `Ticket.revision`, draft reopens while Pending; a ticket runs and reads what was released |
| 8c-1 #735 | b6e5b4fb | 015 | yes | `TicketCommand` in, the thirteen refusals on the wire and in the console |
| 8b #734 | e78a93ce | 014 | yes | `TicketEvent` and `evolve`; the journal row carries the event |
| 8a #732 | 02bd9572 | 013 | yes | `ReleasedTicket`; the definition materialized at release |

8c-2's release wedged the partition on the first update: 016 granted the writer `UPDATE(revision)` but `decisionRepin` also writes the configuration pin. It was hotfixed on the rig by hand with the user's approval, then fixed properly by migration 017 (idempotent against the hand grant). Sanity after: ticket 2 updated to revision 2, a stale update refused `TicketRevisionStale {expected 1, current 2}`, dispatch ran to Done at seq 13 on the revised brief.

## PR 9 as sized

PR 9 is about 8b's size in model and TypeScript, with no schema, wire or console half and no migration. The plan row: delete chuggy's copy, point Quint at the package, rewrite `refinement.qnt` against the package's `decide`/`evolve`, re-aim the goldens and replay the package's traces. The sizing survey is `pr9/survey.md` (base f8998a22).

| PR | Model lines | TS domain/actor/generated | Schema | Interpreter | Console |
| --- | --- | --- | --- | --- | --- |
| 9 (est.) | ~+1500/−2300 | ~+2500/−2000 | none | 4 files | none |
| 8c-2 | +348/−45 | +353/−30 | 016 | yes | yes |
| 8c-1 | +1053/−659 | +1174/−569 | wipe | yes | yes |
| 8b | +1787/−1371 | +2098/−1290 | wipe | yes | no |
| 8a | +937/−533 | +844/−392 | wipe | yes | no |

What the survey found that the plan did not say:

1. **The refinement is barely a rewrite.** 8b already folds the journal through `decide`/`evolve`. The work is `domain.qnt`: its state machine and 18 invariants (`:1275-1918`) restated over `TicketState`.
2. **The package's ticket has no memory.** It holds `{definition, revision, workCyclesStarted, state}`. Chuggy reads history in three live places: `evaluations` (the rework cap, 4 invariants), `spawned` (the wire task number, `decisionPlan.ts:125-139`), `completions` (`actor/obligations.ts:73-81`). It needs a home.
3. **The rework cap loses its basis.** It counts failed evaluations; the package's policy sees only the current instance.
4. **Names collide.** Quint refuses the import (`QNT101`) while chuggy defines `commandValid`, `releasedTicketValid`, `updateTicket`, `isReady`, `dependencyClosure` and others the package also defines.
5. **The stale-failure guard cannot stay in `evolve`.** The package parks on any Work failure; `decide` already refuses stale ones, so the guard moves to journal legality.
6. **The package's traces don't replay as they are.** They record no commands, and their keys break chuggy's bounds; a second harness replays them once the TS state has the package's shape.
7. **The package's TypeScript can't be used at runtime** (shape, TS 7 `prepare`, `--ignore-scripts` in the api image). Keep mirroring.
8. **Vendoring is nearly free.** The package's `ticket.qnt` dropped in unchanged typechecks and its 22 tests pass. Nothing checks the "verbatim" claim today; a pin gate is needed.
9. **No wipe holds on three conditions:** semantics stays 8, the task-number formula is unchanged (or no ticket in flight at release), and a stored-journal replay test is added.
10. **Chuggy's `decisionValid` drops the package's `graphInvariant(evolved)`**; importing brings acyclicity and `ticketInvariant` in for the first time.

## The split

Two PRs in a forced order, neither with a migration or a wipe. The import cannot land while chuggy's colliding names stand, and the package's traces cannot replay until the TS state has the package's shape. If only one PR fits, fold 9b into 9a as its last commits; never start with the import.

| | 9a — The ticket is a TicketState | 9b — Import ticket_domain |
| --- | --- | --- |
| Model | `Ticket` becomes the package's four fields; `WorkInput`, escalation payloads, `source` and `FinalizationOperation` move inside the variants; deciders and `evolve` become the package's text; history gets its home; rework cap re-based; stale guard to legality; colliding names renamed; 18 invariants restated; goldens re-emitted | Delete the text diff-equal to the package (reviewable mechanically); import it, vendored with a digest gate |
| TypeScript | `src/domain`, `src/actor`, `src/generated` mirror the model; interpreter: `decisionPlan` (mint, phase, escalation), `projectWriter`, `reworkCap`, `dispatchView`; a stored-journal replay test at semantics 8 | A package-trace replay harness |
| Gates | — | Pin gate red on a one-byte edit; exit 2 when the package is absent (`check-model`, `check-model-api`, `emit-goldens`); lockfile rows in `_ci-select`; `model/AGENTS.md`; `check-paths` fallout |
| Schema, wire, console | none | none |
| Release | Code release like 8c-2's, no wipe; mechanical fabric digests PR. At release: semantics still 8, no ticket in flight | Vendored: nothing to deploy (image unchanged). An npm git dependency instead would change the api image and need GitHub and TS 7 on the release host |

## Decisions open

None of these is taken yet; 9a's decisions section in a new `pr9/GOAL.md` records the user's answers before any builder starts. The recommendations are the orchestrator's.

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| 1 | The split | 9a then 9b | The import is blocked by the name collisions and the trace replay by the TS shape |
| 2 | Where chuggy's history lives | A chuggy-owned ledger in the model, beside the package's graph | Deriving it from the journal pushes model state into replay |
| 3 | The rework cap's basis | Keep counting failed evaluations, from that ledger | It is chuggy's own policy; no package change |
| 4 | The stale work-failure guard | Journal legality, out of `evolve` | `decide` already refuses stale failures, so `evolve` can be the package's text and stored rows stay guarded |
| 5 | How Quint reaches the package (9b) | Vendor at the package's paths with a digest gate | No network on clone or release, no image change; can wait for 9b |

- [ ] Take decisions 1–4 with the user, write `pr9/GOAL.md`, then brief 9a's builders.

## How the work runs

The orchestrator writes briefs and merges; builders and reviewers are fresh Opus subagents, each in its own worktree, and nothing reviews its own work.

1. **Build.** One brief per builder in `pr9/tasks/<pr>/`, with a shared `_setup.md`. Launch with `Agent`, `isolation: "worktree"`, `model: "opus"`. Builders push `HEAD:refs/heads/<branch>-<letter>`, never the branch itself; the orchestrator merges in its own detached worktree and pushes. File each report and log a line in `GOAL.md`.
2. **Review.** Fresh reviewers per round, machine half and boundary half, from a `_review-setup` plus a brief naming the base and tip. Findings need file:line, an input and what goes wrong; each fix is red-proven. Rounds repeat until APPROVE; a ledger per PR in `pr9/reviews/`.
3. **Gate.** `CHUG_CI_FULL=1 sh .chug/tasks/ci.sh` at the tip before the PR. `deploy-to-gtr.test.sh` hits the 60s suite cap (rc 124) under the full run and passes alone — a false red. `check-source` is red on David's Mac only for `test/rig` (`@playwright/test`) unless playwright is installed.
4. **Merge.** `gh pr merge N -R kasofsk/chuggy --admin --merge --delete-branch`, only after the user says "approved to merge w/ admin" (the classifier wants that wording).
5. **Release**, only after the user approves the deploy:
    1. Phase 1 from the merged main: `deploy/rig/deploy-to-gtr.sh` with `CHUG_RIG_SSH=dev2@10.100.0.1` and a local PostgreSQL in `CHUG_PG_URL`; it gates, builds and opens the fabric PR.
    2. Suspend the importer, scale the seven deployments to 0, confirm no pods in `chuggy-work`.
    3. Immediately run `deploy-to-gtr.sh --merge` with `CHUG_RIG_ARCHIVE` set to an existing directory; it dumps, merges and rolls out.
    4. Verify: rollouts 1/1, the migrate job's `applied N`, importer unsuspended, no `ActivationFailed` in the ticket service, console pages 200.
    5. Sanity on the rig through Geoff's `api-call.sh` (tools in `pr8/rig/tools/`), as the release's own ticket.

## Traps and constraints

The costly traps so far were all at the boundary between what the gates exercise and what the rig runs.

- **Grants the suites cannot see.** Suites now decide as the ticket-service role and accept as the api role. Still on the owner: `harness.authoring` (production: api and configuration importer), journal legality, the domain-configuration precondition, forge installations, the repository-binding read. All granted today, none exercised.
- **Flux restores a scale-down** within about a minute. Run `--merge` straight after scaling to 0 and rely on its dump; the `dev2` account writes only in namespace `chuggy`, so Flux cannot be suspended.
- **A wipe before a migration uses the previous release's script** (`git show <prev main>:deploy/rig/wipe-tickets.sql`). PR 9 needs no wipe.
- **Semantics 8 is load-bearing** for PR 9's no-wipe claim: `journal.ts` refuses any other version.
- **A renamed field name can collide with the envelope** (8c-1: `command` was the discriminator; the field became `ticketCommand`).
- **Opening a PR is not proof of a green run.** Read the full-run result first.

Standing constraints:

- Merge, deploy, wipe, fabric merge and any direct change on the rig's database each need the user's explicit approval, every time.
- No mutation sweeps. Single red-proof mutations, reverted, are fine.
- Never print a secret. Geoff's credential is used only in place through `sudo -n -u geoff /home/geoff/api-call.sh`.
- Leave the agent memory directory alone; do not import handoff notes into it.
- Do tree-changing work in your own worktree; the user works the shared checkout.

## Files and links

| What | Where (in this branch) |
| --- | --- |
| The plan, landed PRs, standing decisions | `effort/ticket-language/SPIKE.md` |
| PR 9 sizing survey and its brief | `effort/ticket-language/pr9/survey.md`, `survey-brief.md` |
| PR 8's record: decisions, progress log, reviews | `effort/ticket-language/pr8/GOAL.md`, `pr8/reviews/`, `pr8/tasks/` |
| Release logs | `effort/ticket-language/pr8/rig/release-<sha>-{phase1,merge}.log` |
| Rig tools | `effort/ticket-language/pr8/rig/tools/` |
| Rig backups | not shared; on David's Mac and the rig |
| The pinned package (76c95a9) | clone [kasofsk/chug-ticket-domain](https://github.com/kasofsk/chug-ticket-domain) to `effort/ticket-language/package/` |
| Chuggy repo | [kasofsk/chuggy](https://github.com/kasofsk/chuggy) |
| Fabric repo | [gdoteof/chuggy-fabric](https://github.com/gdoteof/chuggy-fabric) |
| Previous handoff | `effort/ticket-language/pr8/HANDOFF-2026-09-24.md`; doc [after 8c-1](https://claude.ai/artifact/Sa5e6fft5PjmkZAsTb2DDy) |
