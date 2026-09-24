/**
 * Every literal the projection and the desk write for a reachable ticket is
 * the one the image before the ticket state wrote, over every golden's states.
 *
 * THE OLD LITERALS ARE PINNED, NOT RECOMPUTED. `projection-before-ticket-state.json`
 * was written by the image at f8998a22 from its own goldens: for every state,
 * each ticket's projected phase and escalation, the resume its escalation
 * offered, and the finalization generation its record held. This image's
 * goldens decide the same steps, so state `i` of each is the same ticket
 * history, and the table compares them row for row. The record kept its last
 * generation after an attempt ended where the state keeps none, so the
 * generation is compared wherever the state holds an attempt.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { escalationTags } from "../../src/domain/generated/modelTypes.ts";
import { phaseTags } from "../../src/domain/phase.ts";
import {
  attemptGeneration,
  finalizationOf,
  resumeOf,
} from "../../src/domain/ticket.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import { ticketEscalationResumeAt } from "../../src/interpreter/nativeWeb.ts";
import { projectionOf } from "../../src/interpreter/projectWriter.ts";
import { decodeTrace, stateValue } from "../itf/decode.ts";
import { decodeTicketGraph } from "../itf/vocabulary.ts";

/** One ticket as the previous image projected it: id, phase, escalation, resume, generation. */
type OldRow = readonly [number, string, string, string, number];

const pinned = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "projection-before-ticket-state.json"),
    "utf8",
  ),
) as Readonly<Record<string, readonly (readonly OldRow[])[]>>;

const goldenDir = join(import.meta.dirname, "..", "golden");
const names = (
  JSON.parse(readFileSync(join(goldenDir, "manifest.json"), "utf8")) as {
    goldens: readonly { name: string }[];
  }
).goldens.map((row) => row.name);

const reached = { phases: new Set<string>(), escalations: new Set<string>() };

test("the pin covers every golden the manifest names", () => {
  assert.deepEqual(Object.keys(pinned).sort(), [...names].sort());
});

for (const name of names) {
  test(`${name}: every state projects the literals the previous image wrote`, () => {
    const trace = decodeTrace(
      JSON.parse(
        readFileSync(join(goldenDir, `${name}.itf.json`), "utf8"),
      ) as unknown,
    );
    const ticketsVar = trace.vars.find((v) => v.endsWith("::tickets"));
    assert.ok(ticketsVar, `${name} records no tickets`);
    const states = pinned[name];
    assert.ok(states, `${name} has no pin`);
    assert.equal(trace.states.length, states.length);
    trace.states.forEach((state, at) => {
      const graph = decodeTicketGraph(stateValue(state, ticketsVar));
      const old = states[at] ?? [];
      const rows = projectionOf(graph);
      assert.deepEqual(
        rows.map((row) => row.ticket),
        old.map(([ticket]) => ticket),
      );
      rows.forEach((row, index) => {
        const where = `${name} state ${String(at)} ticket ${String(row.ticket)}`;
        const [, phase, escalation, resume, generation] = old[index] ?? [];
        const ticket = ticketAt(graph, row.ticket);
        assert.equal(row.phase, phase, where);
        assert.equal(row.escalation, escalation, where);
        assert.equal(resumeOf(ticket.state), resume, where);
        if (row.escalation !== "NoEscalation")
          assert.equal(ticketEscalationResumeAt(row.escalation), resume, where);
        if (finalizationOf(ticket) !== undefined)
          assert.equal(attemptGeneration(ticket), generation, where);
        reached.phases.add(row.phase);
        reached.escalations.add(row.escalation);
      });
    });
  });
}

test("the table reaches every phase and every wall", () => {
  assert.deepEqual([...reached.phases].sort(), [...phaseTags].sort());
  assert.deepEqual(
    [...reached.escalations].sort(),
    ["NoEscalation", ...escalationTags].sort(),
  );
});
