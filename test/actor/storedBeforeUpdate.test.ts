/**
 * A journal stored by an image before this one replays under this image, legal
 * and to the tickets it wrote. That is why neither the update nor the ticket
 * state needed a wipe or a new decision semantics.
 *
 * THE ROWS ARE THE PREVIOUS IMAGE'S, NOT REBUILT BY THIS ONE.
 * `journal-before-update.itf.json` is
 * `test/golden/evaluation-blocked-resume.itf.json` byte for byte as the image
 * before the update emitted it. Each row is the decided event its state
 * records, written as the text a store keeps without passing through this
 * image's encoder, and read back through this image's decoder.
 *
 * THE MAP RUNS FROM THIS IMAGE'S STATE TO THAT ONE'S RECORD. The old record
 * cannot be lifted into a state, because it never kept a work cycle's input;
 * every field it did keep is a function of a replayed ticket and its ledger,
 * so `recordOf` writes that function once and each prefix is compared through
 * it. The old record held its last source and generation where the state now
 * holds none, so those two are compared only where the state carries them.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { decisionSemanticsVersionCurrent } from "../../src/actor/decisionSemantics.ts";
import {
  storedJournalLegalOn,
  storedReplay,
  type StoredEntry,
} from "../../src/actor/journal.ts";
import type {
  EvaluationInstance,
  Ticket,
  TicketLedger,
} from "../../src/domain/generated/modelTypes.ts";
import { ledgerAt } from "../../src/domain/ledger.ts";
import { phaseOf } from "../../src/domain/phase.ts";
import { attemptGeneration, ledgerInstances } from "../../src/domain/ticket.ts";
import {
  decodeEntry,
  decodeEvaluationInstance,
  decodeReleasedTicket,
  decodeTicketGraph,
} from "../../src/generated/model-api.ts";
import { decodeTrace, stateValue, type ItfTrace } from "../itf/decode.ts";
import { itfToWire } from "../itf/vocabulary.ts";

const trace: ItfTrace = decodeTrace(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "journal-before-update.itf.json"),
      "utf8",
    ),
  ),
);

function varNamed(suffix: string): string {
  const name = trace.vars.find((v) => v.endsWith(suffix));
  assert.ok(name, `the fixture has no ${suffix} variable`);
  return name;
}

const actionVar = varNamed("::actionTaken");
const stepVar = varNamed("::lastStep");
const ticketsVar = varNamed("::tickets");

/** One stored row and the ticket map the state that decided it holds, as that image wrote both. */
interface Written {
  readonly text: string;
  readonly tickets: unknown;
}

/** Every state that decided an event, in order; the stutter and refusals write no row. */
const written: readonly Written[] = trace.states.slice(1).flatMap((state) => {
  if (stateValue(state, actionVar) === "settle") return [];
  const last = itfToWire(stateValue(state, stepVar)) as {
    type: string;
    value: { event: unknown };
  };
  if (last.type !== "Decided") return [];
  return [
    {
      text: JSON.stringify({ event: last.value.event }),
      tickets: itfToWire(stateValue(state, ticketsVar)),
    },
  ];
});

const stored: readonly StoredEntry[] = written.map(({ text }, at) => ({
  entry: decodeEntry({ seq: at + 1, ...(JSON.parse(text) as object) }),
  semantics: decisionSemanticsVersionCurrent,
}));

/** The record the previous image kept for one ticket, as its wire wrote it. */
interface OldRecord {
  readonly phase: string;
  readonly definition: unknown;
  readonly source: number;
  readonly evaluations: readonly unknown[];
  readonly workCyclesStarted: number;
  readonly spawned: number;
  readonly finalizationGeneration: number;
  readonly escalation: string;
  readonly completions: number;
}

/** The source a state pins, where it pins one. */
function sourceOf(ticket: Ticket): number | undefined {
  const state = ticket.state;
  if (typeof state === "string") return undefined;
  switch (state.type) {
    case "Work":
    case "Finalization":
      return state.value.source;
    case "Evaluation":
      return state.value.input.acceptedSourceRef;
    case "Escalated": {
      const wall = state.value;
      if (wall.type === "EvaluationBlockedEscalated")
        return wall.value.input.acceptedSourceRef;
      if (wall.type === "FinalizationUnavailableEscalated")
        return wall.value.finalization.source;
      return wall.value.source;
    }
  }
}

/** A replayed ticket and its ledger, written as the previous image's record. */
function recordOf(
  ticket: Ticket,
  ledger: TicketLedger,
  old: OldRecord,
): OldRecord {
  const state = ticket.state;
  const generation = attemptGeneration(ticket);
  return {
    phase: phaseOf(state),
    definition: ticket.definition,
    source: sourceOf(ticket) ?? old.source,
    evaluations: ledgerInstances(ticket, ledger),
    workCyclesStarted: ticket.workCyclesStarted,
    spawned: ledger.spawned,
    finalizationGeneration:
      generation === 0 ? old.finalizationGeneration : generation,
    escalation:
      typeof state !== "string" && state.type === "Escalated"
        ? state.value.type
        : "NoEscalation",
    completions: ledger.completions,
  };
}

/** The previous image's record with its nested values read through this image's decoders. */
function decodedOld(old: OldRecord): OldRecord {
  return {
    ...old,
    definition: decodeReleasedTicket(old.definition),
    evaluations: old.evaluations.map((instance): EvaluationInstance =>
      decodeEvaluationInstance(instance),
    ),
  };
}

test("the fixture is a history, and was written without revisions", () => {
  assert.ok(stored.length > 0, "the fixture decided nothing");
  assert.ok(
    written.every(({ text }) => !text.includes('"revision"')),
    "a row of the previous image names a revision",
  );
  assert.throws(
    () => decodeTicketGraph({ tickets: written[0]?.tickets }),
    "a ticket map without revisions decodes, so the fixture is not the previous image's",
  );
});

test("a journal stored before the update is legal under the semantics it was stored at", () => {
  assert.equal(decisionSemanticsVersionCurrent, 8);
  assert.ok(storedJournalLegalOn(stored));
});

test("every prefix replays to the tickets its state wrote, each at revision 1", () => {
  written.forEach(({ tickets }, at) => {
    const replayed = storedReplay(stored.slice(0, at + 1));
    const entries = tickets as readonly (readonly [number, OldRecord])[];
    assert.deepEqual(
      [...replayed.graph.tickets.keys()].sort((a, b) => a - b),
      entries.map(([key]) => key),
      `row ${String(at + 1)} replays to another fleet`,
    );
    for (const [key, old] of entries) {
      const ticket = replayed.graph.tickets.get(key);
      assert.ok(ticket, `row ${String(at + 1)} lost ticket ${String(key)}`);
      assert.equal(ticket.revision, 1);
      assert.deepEqual(
        recordOf(ticket, ledgerAt(replayed.ledgers, key), old),
        decodedOld(old),
        `row ${String(at + 1)} replays ticket ${String(key)} to another record`,
      );
    }
  });
});
