/**
 * A journal stored before tickets had revisions replays under this image, legal
 * and to the graph it wrote, with every ticket at revision 1. That is why the
 * update needs no wipe and no new decision semantics.
 *
 * THE ROWS ARE THE PREVIOUS IMAGE'S, NOT REBUILT BY THIS ONE.
 * `journal-before-update.itf.json` is
 * `test/golden/evaluation-blocked-resume.itf.json` byte for byte as the image
 * before the update emitted it. Each row is the decided event its state
 * records, written as the text a store keeps without passing through this
 * image's encoder, and read back through this image's decoder. The graph each
 * prefix must replay to is that state's own ticket map, which has no revision
 * field, so the field is added at 1 and nothing else changes.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { decisionSemanticsVersionCurrent } from "../../src/actor/decisionSemantics.ts";
import {
  storedJournalLegalOn,
  storedReplayGraph,
  type StoredEntry,
} from "../../src/actor/journal.ts";
import { graphEquals } from "../../src/domain/equality.ts";
import type { TicketGraph } from "../../src/domain/generated/modelTypes.ts";
import {
  decodeEntry,
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

/** A ticket map the previous image wrote, with each ticket at the revision a release lands. */
function atFirstRevision(tickets: unknown): TicketGraph {
  const entries = tickets as readonly (readonly [unknown, object])[];
  return decodeTicketGraph({
    tickets: entries.map(([key, ticket]) => [key, { ...ticket, revision: 1 }]),
  });
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

test("every prefix replays to the graph its state wrote, each ticket at revision 1", () => {
  written.forEach(({ tickets }, at) => {
    const replayed = storedReplayGraph(stored.slice(0, at + 1));
    assert.ok(
      graphEquals(replayed, atFirstRevision(tickets)),
      `row ${String(at + 1)} replays to another graph`,
    );
    for (const ticket of replayed.tickets.values())
      assert.equal(ticket.revision, 1);
  });
});
