/**
 * The console's copy of the model's action enablement, held against the model.
 *
 * `ui/chuggy-ui/app/core/ticketActions.ts` restates `revocableIn`,
 * `retryableIn` and `revisablesIn` because a browser reaches only
 * `src/contract/`, and this is the arrangement `no-console-sees-another` names
 * for a value two trees both need: the copy is written twice and a suite
 * outside both holds them equal. Order is not part of the claim — the offers
 * are compared as an enablement per phase.
 *
 * `retryableIn` is `hasOpenHumanTask`, free on the sum's every variant
 * (`resumeOf` is total), so the console sees exactly what the model does here:
 * a phase is the whole of what either predicate needs, and `revisablesIn` is a
 * phase alone.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { phaseRoster } from "../../src/contract/rosters.ts";
import type { TicketPhase } from "../../src/contract/rosters.ts";
import {
  retryableIn,
  revisablesIn,
  revocableIn,
} from "../../src/domain/enablement.ts";
import type {
  Ticket,
  TicketGraph,
  TicketState,
} from "../../src/domain/generated/modelTypes.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { initialWorkInput } from "../../src/domain/ticket.ts";
import { plainDefinitionOf } from "../actor/harness.ts";
import { runningInstance, workEscalatedState } from "../domain/fixtures.ts";
import {
  actionsFor,
  ticketResumable,
  ticketRevisable,
  ticketRevocable,
} from "../../ui/chuggy-ui/app/core/ticketActions.ts";

const id = asTicketId(7);

/** A state in this phase, one cycle in where the phase has run one. */
function stateIn(ticket: Ticket, phase: TicketPhase): TicketState {
  const definition = ticket.definition;
  switch (phase) {
    case "Pending":
    case "Done":
    case "Revoked":
      return phase;
    case "Work":
      return {
        type: "Work",
        value: { input: initialWorkInput(definition), source: 1 },
      };
    case "Evaluation":
      return {
        type: "Evaluation",
        value: runningInstance(
          7,
          1,
          definition.evaluationPlan.stages,
          new Set(),
        ),
      };
    case "Finalization":
      return {
        type: "Finalization",
        value: { workCycle: 1, generation: 1, input: 1, source: 1 },
      };
    case "Escalated":
      return workEscalatedState(ticket);
  }
}

function ticketIn(phase: TicketPhase): Ticket {
  const released: Ticket = {
    definition: plainDefinitionOf(7),
    revision: 1,
    workCyclesStarted: phase === "Pending" ? 0 : 1,
    state: "Pending",
  };
  return { ...released, state: stateIn(released, phase) };
}

function graphWith(ticket: Ticket): TicketGraph {
  return { tickets: new Map([[id, ticket]]) };
}

test("the console's revocable phases are the model's, phase by phase", () => {
  for (const phase of phaseRoster)
    assert.equal(
      ticketRevocable(phase),
      revocableIn(graphWith(ticketIn(phase)), id),
      `revocable disagreed at ${phase}`,
    );
});

test("the console's resumable phases are the model's, phase by phase", () => {
  for (const phase of phaseRoster)
    assert.equal(
      ticketResumable(phase),
      retryableIn(graphWith(ticketIn(phase)), id),
      `resumable disagreed at ${phase}`,
    );
});

test("the console's revisable phases are the model's, phase by phase", () => {
  for (const phase of phaseRoster)
    assert.equal(
      ticketRevisable(phase),
      revisablesIn(graphWith(ticketIn(phase))).includes(id),
      `revisable disagreed at ${phase}`,
    );
});

test("what the console offers is what the two predicates enable", () => {
  for (const phase of phaseRoster) {
    const graph = graphWith(ticketIn(phase));
    const offered = new Set(
      actionsFor({
        ticket: 7,
        phase,
        sequence: 1,
        releasedAt: "2026-08-26T00:00:00Z",
        changedAt: "2026-08-27T00:00:00Z",
        revision: 1,
        revokedDependencies: [],
      }).map((one) => one.action),
    );
    assert.equal(offered.has("Revoke"), revocableIn(graph, id), phase);
    assert.equal(offered.has("Resume"), retryableIn(graph, id), phase);
  }
});
