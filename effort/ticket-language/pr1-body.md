The accounts leave the ticket model: gas, the rework budget, finalization pricing and retry pricing, and with them the two escalation reasons only a spent account could reach. This is the first of the convergence steps toward chug-ticket-domain (plan: `~/claude/chuggy-effort/ticket-language/SPIKE.md`, decided with Geoff 2026-09-20).

**Model.** `model/measure.qnt` becomes `model/ticket.qnt`; the measure section goes. A failing evaluation's disposition is an input to the decider (`EvaluationFailureDisposition`, journaled on `EvalReduce` as `{ ticket, onFailure }`), not a balance the ticket carries. A failed finalization always reworks. Resume is free; dispatch needs no gas. `Config` is `{ nTickets, nTasks, maxStages }`.

**Actor.** Decision semantics version 3. Corrections stated as row facts: the v1 rework wall parks at eval resume; v1/v2 `EvalReduce` reads its disposition from the record; a record naming a removed wall is unreplayable; the v2 zero-budget rework wall replays `ResumeReworking` (a divergence left standing, stated in the header).

**Interpreter.** The rework cap is ticket-service policy (`rework.cyclesMax`), decided where the writer holds the core and journaled on the event. It counts only the reworks a failing evaluation bought, so finalizer rework is uncapped, as decided. The journal chain verifies over the stored row text rather than a re-encoding of the decoded row, which is what lets a pre-3 history load at all (and is strictly stronger than what it replaced).

**Schema.** Migration 004 drops the three balance columns and the dispatch candidate's three pricing columns, narrows the reason CHECKs, rewrites the deployment authoring policy in the encoder's key order, and re-renders the lead observation bound. Its guard refuses first, naming the relations that hold rows the migration no longer admits, and rolls back with its ledger row. The rig was checked: no gas or finalization-budget rows; the rework-wall rows it holds are replayable.

**Wire and console.** Two escalation reasons, four ticket-view fields and three authoring pages leave the contract; the console loses the budget meter, the Budgets panel, the pricing pickers and the price it drew beside every action.

**Rollout.** Needs the fabric change on `ticket-service/no-accounts` (chuggy-fabric) at the same release; the rig is at schema v1 and takes 002–004 together.

Reviews: S round 1 APPROVE; A rounds 1–2 (CHANGES, fixed); B round 1 CHANGES, round 2 APPROVE; whole-branch mutation sweep APPROVE (26 mutations, 23 red in the suite named for the behaviour, 3 unpinned and none a defect). Records under `~/claude/chuggy-effort/ticket-language/reviews/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
