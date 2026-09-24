# PR 9 survey — Import ticket_domain (chuggy main f8998a22, package 76c95a9, 2026-09-24)

Read-only sizing survey. Repo paths are relative to the chuggy root; `pkg/` is
`~/chuggy-effort/ticket-language/package/`. "Verified" means run here: both copies
diffed empty against the package, the package's `ticket.qnt` typechecked in chuggy's
layout, its `ticket_tests.qnt` run (22 passing, ~4 s, quint 0.32.0), and a Quint name
clash reproduced.

## Surprises

1. **The refinement is not a rewrite.** `model/refinement.qnt` already folds the
   journal of `TicketEvent`s through `decide`/`evolve` (`:231-246`, `:337-350`). 8b did
   that work. What PR 9 changes there is a handful of field reads: `finalizationGeneration`
   (`:452`, `:505`) and the `completions` ghost (`:573-575`). The real work is
   `model/domain.qnt`: its state machine, its draw sets and its eighteen invariants
   (`:1275-1918`) have to be restated over `TicketState`.
2. **The package's `Ticket` has no memory, and chuggy needs its history in three places.**
   The package's record is `{definition, revision, workCyclesStarted, state}`
   (`pkg/.../ticket.qnt:74-79`). `Done`, `Work` and `Finalization` carry no instance. The
   extra fields on chuggy's record (`model/ticket.qnt:359-424`) have live readers:
   - `evaluations` (every past instance): the rework cap counts `EvaluationFailed`
     instances (`src/domain/ticket.ts:483-489` → `src/interpreter/reworkCap.ts:54-60`).
     Invariants `evaluationsWellFormed`, `evaluationsMonotone`, `idsAccounted` and
     `artifactWellFormed` also read it, as does `deliverableTasksIn` (`domain.qnt:567-572`).
   - `spawned`: the wire's task number, `base = ticket.spawned - roster.length`
     (`src/interpreter/decisionPlan.ts:125-139`).
   - `completions`: the ghost behind `completionExclusive` and `journalCompletionsMatchLedger`
     (`src/actor/obligations.ts:73-81`).

   PR 9 has to give this history a home: either a chuggy ledger beside the package graph
   or a derivation from the journal. The plan row does not mention it.
3. **The rework cap loses its basis.** SPIKE decision 1 said the cap reads
   `workCyclesStarted`. The landed cap reads instance history instead, and its header
   argues against `workCyclesStarted` because finalization reworks and resumes also count
   as cycles (`reworkCap.ts:11-23`). The package's policy type is `EvaluationInstance =>
   Disposition` (`pkg/.../ticket.qnt:31`), so it sees the current instance only. The writer
   has to compute the count from the journal or a ledger and close over it.
4. **Chuggy's names collide with the package's.** Quint 0.32 rejects the clash (verified,
   `QNT101 Conflicting definitions`). Chuggy defines its own differing versions of
   `releasedTicketValid` and `commandValid` (bounds added, `domain.qnt:292-325`),
   `workTaskObligation` and `executeWork` (2 arguments vs the package's 4,
   `ticket.qnt:642,857`), `revocationAllowed(Phase)`, `incompleteDependencies`,
   `dependencyClosure`, `isReady`, `liveTaskList`, and the machine's `action updateTicket`
   (`domain.qnt:1452`), which clashes with the package's `pure def updateTicket`. Each one
   is deleted or renamed. Chuggy's bounds (positional stage keys, `N_TASKS`,
   `MAX_STAGES`) become a separately named conjunct.
5. **The stale-failure guard cannot stay in `evolve`.** The package parks on any failure
   in `Work` (`pkg/.../ticket.qnt:993-1020`). Chuggy requires the current cycle
   (`domain.qnt:1007-1016`, 8b round 1). `decide` already refuses a stale failure
   (`pkg :743-758`), so no decided row is stale. The guard therefore protects only against
   forged rows. It either moves into journal legality (`refinement.qnt:237-246`,
   `src/actor/journal.ts:113-131`) or is accepted, the way 8b accepted the dispatch guard.
   Moving it keeps every stored row's meaning, which is what lets semantics stay 8
   (surprise 10).
6. **The package's traces cannot replay "as is" through chuggy's `decide`.**
   - A trace records `graph`, `priorGraph` and `lastDecision`, and never the command.
     The package's own harness rebuilds 303 of 325 commands from events and `mbt` action
     names (`pkg/test/conformance/replay.ts`, README).
   - The traces use stage keys 10/20 and evaluator keys 11/12/21. Chuggy's bounds require
     positional stage keys and keys ≤ `N_TASKS` (`domain.qnt:299-305`), so chuggy's
     invariant bundle is red on them. Only the package's `graphInvariant`/`decisionValid`
     apply.
   - Chuggy therefore needs a second ITF harness (different var names, the package's
     state shape), and it only works once chuggy's TypeScript state is the package's shape.
7. **The package's TypeScript cannot be imported at runtime, and should not be.**
   - Representation: it uses classes with `kind`, snake_case and branded ids; chuggy uses
     generated `{type, value}` records with Zod codecs.
   - Build: `dist/` is gitignored (`pkg/.gitignore`) and built by `prepare` with
     TypeScript ^7. The image installs `npm ci --omit=dev --ignore-scripts`
     (`images/api/Dockerfile:24`), so there would be no `dist/`, and Node will not strip
     types inside `node_modules`.
   - Keep mirroring. The package's TypeScript could at most be a test-only oracle.
8. **Vendoring is nearly free because chuggy's layout already copies the package's.**
   `model/task-contract/task.qnt` and `model/ticket-domain/evaluation/evaluation.qnt` sit
   at the package's own paths. `pkg/.../ticket.qnt` dropped in at
   `model/ticket-domain/ticket.qnt` typechecks unchanged (verified). The npm git
   dependency instead needs GitHub on every clone, worktree and release, plus a TS 7
   `prepare`, and npm keeps no integrity hash for git dependencies. The repo is public
   (`gh repo view`).
9. **Today's "VERBATIM, `diff` empty" claim has no gate** (`model/AGENTS.md`). No gate
   compares either copy with the package. Both are identical today (diffed). Whichever
   option PR 9 takes, it has to add the pin check. Two related gate gaps:
   - `check-model` reads a typecheck `^error` as a finding (`check-model.sh:109`), so a
     missing package would report as a model defect rather than could-not-run.
   - `_ci-select.sh:86-87` does not run `check-conformance`/`check-random` on
     `package.json`/`package-lock.json`, so a pin bump would skip replay.
10. **No wipe holds for stored text, with three conditions.** What is stored is already
    the package's text: the journal event, the command, the refusal and
    `ticket_definition`. Projection literals equal the `TicketState`/`Escalation` tags (the
    `Phase` roster is identical, and `NoEscalation` stays a projection-only value,
    `nativeReads.ts:249-251`). `TicketGraph` is decoded only in tests (verified: `decodeTicketGraph`
    appears only in `src/generated`, `test/itf`, `test/generated` and `test/domain`). The conditions:
    - (a) Semantics stays 8. `journal.ts:120` refuses any other value, so a bump would
      amount to a wipe.
    - (b) The task-number mint stays identical in formula, or no ticket is in flight at
      release. `UNIQUE (tenant, project, ticket, task)` (`constraints.ts:103`) absorbs a
      re-minted number as a silent no-op (`decisionPlan.ts:117-122`), so a changed mint
      wedges an in-flight ticket. The rig's tickets 1 and 2 are Done (`pr8/GOAL.md:167-170`).
    - (c) A replay-equivalence test over stored rows, in the shape of 8c-2's
      `test/actor/storedBeforeUpdate.test.ts`.
11. **Chuggy's `decisionValid` drops the package's `graphInvariant(evolved)`**
    (`pkg :1360` vs `domain.qnt:1150-1162`). Importing it puts the package's
    `ticketInvariant` in front of chuggy's walk for the first time.
12. **The package's docs are stale at the pin.** `traces/README.md` and
    `test/conformance/README.md` name scenarios, paths and counts that do not exist:
    `repositoryContract`, `tests-ts/`, "29 traces". The directory has 26, matching
    `ticket_tests.qnt`. Trust the files, not the READMEs.

## 1. Residual diff after 8c-2

| module | identical | renamed / divergent | chuggy-only | package-only |
|---|---|---|---|---|
| `task` (89 l) | whole file (diff empty) | — | — | — |
| `evaluation` (480 l) | whole file (diff empty) | — | — | — |
| `ticket` (chuggy `ticket.qnt` 879 l / 71 defs + `domain.qnt` 1918 l / 143 defs; package 1363 l / 101 defs) | about 40 defs: every command, event, refusal, obligation and decision type (`ticket.qnt:447-617`); all seven deciders and `decide` (`domain.qnt:384-881`); `evolve`'s arms other than the two work-failure arms; `decisionValid` and its helpers (`:1088-1162`). About 815 lines of `domain.qnt` and 450 of `ticket.qnt` | `Ticket` (a record with `phase` vs `TicketState`); `Escalation` (nullary vs payloads, the one named divergence in `model/AGENTS.md`); `workTaskOf`↔`workTaskIdentity`; `workTaskObligation`/`executeWork` arity; `liveTaskList` (derived via `liveObligations`); `evolve`'s work-failure arms (surprise 5); `releasedTicketValid`/`commandValid` (+bounds); `decisionValid` (−`graphInvariant`) | about 25 in `ticket.qnt` (`Phase`, `Resume`/`resumeOf`, `ArtifactMark`/`artifactOf`, `LastDecision`, instance-history and mint helpers `:676-853`, `producedResult*`, `finalizationOperationOf`); in `domain.qnt` the draw sets, fixtures and probes (`:75-345`, `:1164-1273`), the state and actions (`:1275-1563`) and 18 invariants (`:1565-1918`) | about 31: `WorkCause`, `WorkInput`, `WorkExecution`, `WorkEscalation`, `EvaluationFailureEscalation`, `FinalizationEscalation`, `TicketState`, `is*`, `*WorkInput`, `nextCycleNumber`, `resumedFinalization`, `enterWorkCycle`, `applyCommand`, `workInput*`, `escalationValid`, `ticketInvariant`, `graphInvariant`, the dependency-closure trio |

The known items, where each lands:
- `TicketState` vs `phase`/`escalation`/`finalizationGeneration`: all three fields
  collapse into the sum. `deskConsistent`, `finalizationGenerationHeld` and
  `sourcePinned` become structural or move into the package's `ticketInvariant`.
- `WorkInput`: package-only state (`cause`, and `retryEvidence` accumulating across
  resumes). No obligation reads it, so the obligations are unchanged; conformance
  compares it.
- `source`: moves off the record into `Work`, the three `Escalated` payloads,
  `Finalization`, and the instance's `acceptedSourceRef`. Nothing outside `src/domain`
  reads `Ticket.source`; dispatch reads `ticket_source`.
- The work-failure current-cycle check: surprise 5.

## 2. What chuggy keeps that the package lacks

| kept | lives after import |
|---|---|
| `N_TICKETS`/id universe (`ticketIdsWellFormed`) → boundary `TicketCapacityReached` | `domain.qnt` draw set + invariant; writer boundary unchanged |
| `N_TASKS`, `MAX_STAGES`, positional stage keys | a renamed bounds conjunct over `releasedTicketValid` (surprise 4) |
| nondet policy pick, `dispositionChoices` | `domain.qnt` `take` passes `_ => onFailure` to the package's `decide` as today |
| `revisionsAccounted`, `terminalsAbsorbing`, `eventsNeverIdentity`, `decisionsValid`, `taskIdentitiesValid`, `stuckSubsetCovered`, `stageAdvanceNever`, `completionExclusive`, `revokedNeverCompletes` | `domain.qnt` over the package's graph (prev-state ghost as today) |
| `evaluationsWellFormed`/`Monotone`, `idsAccounted`, `artifactWellFormed`, `completions` | need history: a chuggy ledger var beside `tickets`, folded from events (A), or retired and derived from the journal in refinement (B) |
| dependencies/`TicketGraph` shape | package's (`graphInvariant` has acyclicity and closure); chuggy's `depsAcyclic`, `waitsOn`, `depArtifacts` retire or rename |
| stale-failure guard | journal legality (refinement + `journal.ts`) or accepted |
| `Phase`/`Resume` vocabulary for projection, desk and console | chuggy helpers over `TicketState` tags (`nativeWeb.ts:258-267`, `projectWriter.ts:183-197`) |

## 3. How Quint reaches the package

| | npm git dependency at 76c95a9 | vendored copy + digest gate | submodule |
|---|---|---|---|
| model | imports rewritten to `../node_modules/@kasofsk/chug-ticket-domain/model/...`; delete both copies | add `model/ticket-domain/ticket.qnt` verbatim; imports resolve unchanged (verified) | as npm, under `vendor/` |
| `check-model` | new precondition: package present, pinned → else exit 2 | typecheck already covers `model/**` (`check-model.sh:46`); add a digest check | init precondition |
| `check-model-api` / `emit-goldens` | same precondition (both compile through `node_modules`) | none | same |
| `check-conformance` | package traces from `node_modules`; `_ci-select` must add the lockfile | vendor `traces/` beside the model and digest them | same |
| `check-paths` | deleted copies turn every surviving mention into an R2 finding (wanted); `node_modules` paths are skipped | nothing moves | as npm |
| the pin | lock `resolved` sha checked by a gate; no npm integrity for git deps | committed sha256 list for the vendored files | gitlink |
| cost | GitHub + TS 7 `prepare` per clone, worktree and phase 1; image layer changes (lockfile) | no network, no image change | worktree and agent friction |

Whichever option is taken, the gate must hold that the pin cannot drift: sha256 of each
package file chuggy uses, checked by the model gate and run red against a one-byte edit.
The package's `ticket_tests.qnt` can run in `check-model` as its own stage (~4 s).

## 4. TypeScript

- **`src/domain`** (about 3,900 lines): `ticket.ts`, `evolve.ts`, `deciders.ts`,
  `enablement.ts`, `invariants.ts`, `equality.ts`, `decisionValid.ts`, `phase.ts` and
  `derived.ts` all move to `TicketState`. The deciders and `evolve` become arm-for-arm
  mirrors of the package's text. `generated/modelTypes.ts` and `src/generated/model-api.ts`
  regenerate.
- **`src/actor`**: `obligations.ts` (`completions`), plus recovery, which folds the
  ledger if the model gets one.
- **Interpreter**: 16 direct ticket reads in four files.
  - `decisionPlan.ts`: the `spawned` mint, `phase`, `escalation`.
  - `projectWriter.ts`: projection and the cap.
  - `reworkCap.ts`: the history (surprise 3).
  - `dispatchView.ts`.
- **Unchanged**: the postgres adapters, schema, wire and console. Projection literals
  hold, and `Resume` stays derived.
- **The package's `src/`**: out of scope (surprise 7).

## 5. Stored text

- **Unchanged**: journal `entry`, `operation.command`, `decision_input.refusal`,
  `ticket_definition` and every obligation identity (`"<seq>:<i>:ExecuteTask"`; the
  obligation order is the same). `TicketCreated`/`TicketUpdated` carry `ReleasedTicket`,
  already verbatim.
- **Projection `phase`/`escalation`**: derived from tags equal to today's literals.
- **Not stored**: `TicketGraph`, anywhere.
- **No-wipe claim**: holds under conditions (a)–(c) of surprise 10.

## 6. Goldens and traces

- **Chuggy's goldens**: all 20 re-emit, because the state shape changes. The manifest's
  aims read `lastEvent`, `lastRefusal` and `lastObligations`, which survive.
  `journal-before-update.itf.json` needs an old→new state map or retirement.
- **Package traces**: 26, replayed evolve-first over the package graph, with decide where
  the command can be rebuilt, under the package's invariants only (surprise 6).
- **Conformance afterwards**: chuggy's goldens compare the package graph plus chuggy's
  extension. The package's traces compare the package graph alone.
- **Tests**: `model/tests/*.qnt` (2,880 lines, about 160 record-field sites) and
  `test/domain` (4,171 lines) are rewritten on the record, not re-emitted.

## Size

Residual diff by module: `task` 0, `evaluation` 0, `ticket` about 1,265 lines / about 60
definitions package-equivalent, to be deleted, plus about 1,100 lines of chuggy machine
restated over `TicketState`.

| | model | TS domain/actor/generated | schema | interpreter | console |
|---|---|---|---|---|---|
| 7b | +1995/−1008 | +1880/−719 | 012 wipe | yes | yes |
| 8a | +937/−533 | +844/−392 | 013 wipe | yes | no |
| 8b | +1787/−1371 | +2098/−1290 | 014 wipe | yes | no |
| 8c-1 | +1053/−659 | +1174/−569 | 015 wipe | yes | yes |
| 8c-2 | +348/−45 | +353/−30 | 016 | yes | yes |
| **9 (est.)** | about +1500/−2300 (excl. a vendored file) | about +2500/−2000 | none | 4 files | none |

PR 9's model and domain halves are the size of 8b's. It has no schema, wire or console
half, so it is well under 8b's 135 files overall. The risk is concentrated in one failure
mode: state and `evolve` equivalence.

## Split

**Two PRs, in a forced order. Neither needs a migration or the wipe.**

**9a — "The ticket is a TicketState"** (chuggy's own text, no import yet).
- `Ticket` becomes the package's four fields. `WorkInput`/`WorkExecution`/escalation
  payloads/`FinalizationOperation` go into the variants. The deciders and `evolve` become
  textually the package's.
- The history question (surprise 2) is decided and built: ledger or journal derivation.
  The mint must stay formula-identical.
- The cap is re-based (surprise 3). The stale-failure guard moves to legality or is
  accepted (surprise 5). Chuggy's divergent names are renamed (surprise 4).
- 18 invariants are restated. Goldens re-emit.
- TypeScript: `src/domain`/`src/actor` mirror it, plus the four interpreter files and the
  replay-equivalence test (no-wipe proof, semantics 8).
- Schema, wire and console: none.
- Fails by: replay or state drift.

**9b — "Import ticket_domain".**
- Model: delete everything in `ticket.qnt`/`domain.qnt` that `diff`s equal to the package
  and import the package. The deleted text diff-equals `pkg/.../ticket.qnt`, which makes
  this piece reviewable mechanically.
- Pin gate, gate preconditions, `_ci-select` lockfile rows, `model/AGENTS.md`.
- The package-trace replay harness in `test/`.
- No `src/` change beyond the harness.
- Fails by: tooling, pin or supply chain.

**The order is forced.** The package's names cannot be imported while chuggy's clashing
definitions stand (surprise 4), and its traces cannot replay until the TypeScript state
is the package's shape.

**If one PR is the budget**: fold 9b into 9a as its last commits. Do not start with the
import.

## Release coupling

- **9a**: a code release without the wipe (8c-2's shape). The interpreter's projection
  derivation, mint and cap move, so fabric gets a mechanical digests PR. Before the
  release, confirm semantics is still 8 and no ticket is in flight (surprise 10 b).
  Worker, fabric manifests and console: no change.
- **9b, vendored**: model, tests and gates only. `package.json` is untouched, so the image
  digest is unchanged and there is nothing to deploy.
- **9b, npm git dependency**: the lockfile enters the api image's dependency layer
  (`Dockerfile:20-24`), so a new digest and a mechanical fabric PR, but no behaviour
  change. Phase 1 on the release host also needs GitHub access and a TS 7 `prepare`.
