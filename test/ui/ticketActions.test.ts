/**
 * The console's copy of the model's action enablement, held against the model.
 *
 * `ui/chuggy-ui/app/core/ticketActions.ts` restates `revocableIn` and
 * `retryableIn` because a browser reaches only `src/contract/`, and this is the
 * arrangement `no-console-sees-another` names for a value two trees both need:
 * the copy is written twice and a suite outside both holds them equal. Order is
 * not part of the claim — the offers are compared as an enablement per phase.
 *
 * `retryableIn` is `hasOpenHumanTask`, free on the sum's every variant
 * (`resumeOf` is total), so the console sees exactly what the model does here:
 * a phase is the whole of what either predicate needs.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { phaseRoster } from "../../src/contract/rosters.ts";
import type { TicketPhase } from "../../src/contract/rosters.ts";
import { retryableIn, revocableIn } from "../../src/domain/enablement.ts";
import type {
  Ticket,
  TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { plainDefinitionOf } from "../actor/harness.ts";
import {
  actionsFor,
  ticketResumable,
  ticketRevocable,
} from "../../ui/chuggy-ui/app/core/ticketActions.ts";

const id = asTicketId(7);

function ticketIn(phase: TicketPhase, over: Partial<Ticket> = {}): Ticket {
  return {
    phase,
    definition: plainDefinitionOf(7),
    revision: 1,
    source: 0,
    evaluations: [],
    workCyclesStarted: 0,
    spawned: 0,
    finalizationGeneration: 0,
    escalation: "NoEscalation",
    completions: 0,
    ...over,
  };
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
        revokedDependencies: [],
      }).map((one) => one.action),
    );
    assert.equal(offered.has("Revoke"), revocableIn(graph, id), phase);
    assert.equal(offered.has("Resume"), retryableIn(graph, id), phase);
  }
});
