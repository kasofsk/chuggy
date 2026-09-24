/**
 * Rows stored before the ticket became a `TicketState` replay under this image
 * to what the previous image derived from them: the same projection rows, the
 * same durable identities and the same task numbers. That is why the change
 * needed neither a wipe nor a new decision semantics.
 *
 * THE ROWS AND WHAT WAS DERIVED FROM THEM ARE THE PREVIOUS IMAGE'S, PINNED.
 * `stored-before-ticket-state.json` was written by the image at f8998a22. For
 * every golden the manifest names it holds the decided rows that image's
 * golden recorded, each entry and obligation in the text a store keeps; and
 * one more journal, driven through that image's deciders under the writer's
 * rework cap, which reworks under the cap, parks at it and resumes, resumes a
 * blocked evaluator and a finalization, reworks from a finalization and
 * completes, then revokes a ticket mid-run. Beside each row it holds what that
 * image derived: the projection rows the decision changed, its materialization
 * with every request, action and finalization identity and every task number
 * minted, the source a spawn ran at, and the dispatch candidates at their
 * ticket versions. Nothing here re-derives the previous image's answer.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { commandSubject } from "../../src/actor/command.ts";
import { decisionSemanticsVersionCurrent } from "../../src/actor/decisionSemantics.ts";
import {
  genesis,
  replayStep,
  storedJournalLegalOn,
  type Replayed,
  type StoredEntry,
} from "../../src/actor/journal.ts";
import type { Config } from "../../src/domain/config.ts";
import { commandTaken, decide } from "../../src/domain/deciders.ts";
import type {
  Entry,
  Obligation,
  TicketCommand,
} from "../../src/domain/generated/modelTypes.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { genesisLedgers, ledgerAt } from "../../src/domain/ledger.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import {
  decodeEntry,
  decodeObligation,
  decodeTicketCommand,
  encodeEntry,
  encodeObligation,
} from "../../src/generated/model-api.ts";
import { materializationOf } from "../../src/interpreter/decisionPlan.ts";
import {
  deriveDispatchCandidates,
  type DispatchContractPin,
} from "../../src/interpreter/dispatchView.ts";
import type { DecisionInput } from "../../src/interpreter/projectDiscovery.ts";
import {
  projectionChanges,
  projectionOf,
  projectWriterSpawnSourceRef,
} from "../../src/interpreter/projectWriter.ts";
import { reworkPolicy } from "../../src/interpreter/reworkCap.ts";
import { decodeTrace, stateValue } from "../itf/decode.ts";
import { decodeLastDecision } from "../itf/vocabulary.ts";

/** One stored row, as the previous image's store kept it. */
interface StoredRow {
  readonly entry: unknown;
  readonly obligations: readonly unknown[];
}

/** One journal and what the previous image derived from it, row by row and at its end. */
interface Pinned {
  readonly commands?: readonly unknown[];
  readonly rows: readonly StoredRow[];
  readonly expected: readonly {
    readonly projection: unknown;
    readonly materialization: unknown;
    readonly spawnSource?: number;
    readonly candidates: readonly (readonly [number, number])[];
  }[];
  readonly final: unknown;
}

const pinned = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "stored-before-ticket-state.json"),
    "utf8",
  ),
) as {
  readonly cyclesMax: number;
  readonly config: Config;
  readonly result: Readonly<Record<string, Pinned>>;
};

const goldenDir = join(import.meta.dirname, "..", "golden");
const goldenNames = (
  JSON.parse(readFileSync(join(goldenDir, "manifest.json"), "utf8")) as {
    goldens: readonly { name: string }[];
  }
).goldens.map((row) => row.name);

const drivenName = "stored-rework-and-finalization-resume";

/** The one contract every released ticket was pinned under when the rows were derived. */
const contract: DispatchContractPin = {
  configurationRevision: "r",
  configurationDigest: "d",
  configurationCanonical: "c",
};

/** The input the rows were materialized under: no answer, no finalization evidence. */
const input = { source: {} } as unknown as DecisionInput;

/** A value as the pin holds it: through JSON, so an absent field and an undefined one agree. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** The rows of one journal, read through this image's decoders. */
function storedOf(journal: Pinned): readonly {
  readonly entry: Entry;
  readonly obligations: readonly Obligation[];
}[] {
  return journal.rows.map((row) => ({
    entry: decodeEntry(row.entry),
    obligations: row.obligations.map(decodeObligation),
  }));
}

/** Each journal's rows as a store hands them to recovery. */
function storedEntries(journal: Pinned): readonly StoredEntry[] {
  return storedOf(journal).map(({ entry }) => ({
    entry,
    semantics: decisionSemanticsVersionCurrent,
  }));
}

/** The decided rows a golden this image emitted records, as a store would keep them. */
function reemitted(name: string): readonly StoredRow[] {
  const trace = decodeTrace(
    JSON.parse(
      readFileSync(join(goldenDir, `${name}.itf.json`), "utf8"),
    ) as unknown,
  );
  const stepVar = trace.vars.find((v) => v.endsWith("::lastStep"));
  assert.ok(stepVar, `${name} records no decision`);
  const rows: StoredRow[] = [];
  trace.states.forEach((state, at) => {
    if (at === 0 || stateValue(state, "mbt::actionTaken") === "settle") return;
    const last = decodeLastDecision(stateValue(state, stepVar));
    if (last !== "NoDecision" && last.type === "Decided")
      rows.push({
        entry: encodeEntry({ seq: rows.length + 1, event: last.value.event }),
        obligations: last.value.obligations.map(encodeObligation),
      });
  });
  return rows;
}

test("the pin covers every golden the manifest names and the driven journal", () => {
  assert.equal(decisionSemanticsVersionCurrent, 8);
  assert.deepEqual(
    Object.keys(pinned.result).sort(),
    [...goldenNames, drivenName].sort(),
  );
  assert.ok(pinned.result[drivenName]?.commands?.length);
});

for (const [name, journal] of Object.entries(pinned.result)) {
  test(`${name}: the stored journal is legal and derives what the previous image derived`, () => {
    assert.ok(storedJournalLegalOn(storedEntries(journal)));
    let held: Replayed = { graph: genesis, ledgers: genesisLedgers };
    const versions = new Map<number, number>();
    const contracts = new Map<number, DispatchContractPin>();
    storedOf(journal).forEach(({ entry, obligations }, at) => {
      const expected = journal.expected[at];
      assert.ok(expected, `${name} row ${String(at + 1)} has no pin`);
      const post = replayStep(held, entry.event);
      const projection = projectionChanges(held.graph, post.graph);
      for (const row of projection) versions.set(row.ticket, entry.seq);
      if (entry.event.type === "TicketCreated")
        contracts.set(entry.event.value.id, contract);
      const where = `${name} row ${String(at + 1)} (${entry.event.type})`;
      assert.deepEqual(plain(projection), expected.projection, where);
      assert.deepEqual(
        plain(materializationOf(input, held, post, entry, obligations)),
        expected.materialization,
        where,
      );
      const spawn = obligations.find(
        (obligation) => obligation.type === "ExecuteTask",
      );
      assert.equal(
        spawn === undefined
          ? undefined
          : projectWriterSpawnSourceRef(
              ticketAt(post.graph, asTicketId(spawn.value.ticket)).state,
            ),
        expected.spawnSource,
        where,
      );
      assert.deepEqual(
        deriveDispatchCandidates(post.graph, versions, contracts).map(
          (candidate) => [candidate.ticket, candidate.ticketVersion],
        ),
        expected.candidates,
        where,
      );
      held = post;
    });
    assert.deepEqual(plain(projectionOf(held.graph)), journal.final);
  });
}

for (const name of goldenNames) {
  test(`${name}: this image's golden decides the rows the previous one stored`, () => {
    const journal = pinned.result[name];
    assert.ok(journal, `${name} has no pin`);
    assert.deepEqual(plain(reemitted(name)), journal.rows);
  });
}

test("the driven journal's commands decide its rows again under the rework cap", () => {
  const journal = pinned.result[drivenName];
  assert.ok(journal?.commands);
  let held: Replayed = { graph: genesis, ledgers: genesisLedgers };
  const rows = journal.commands.map((text, at): StoredRow => {
    const command: TicketCommand = decodeTicketCommand(text);
    assert.ok(commandTaken(pinned.config, command));
    const subject = commandSubject(command);
    const ticket = held.graph.tickets.get(subject);
    const policy =
      ticket === undefined
        ? () => "EscalateEvaluationFailure" as const
        : reworkPolicy(
            ticket,
            ledgerAt(held.ledgers, subject),
            pinned.cyclesMax,
          );
    const decision = decide(held.graph, command, policy);
    assert.equal(decision.type, "TicketDecided", `command ${String(at + 1)}`);
    if (decision.type !== "TicketDecided") throw new Error("unreachable");
    held = replayStep(held, decision.value.event);
    return {
      entry: encodeEntry({ seq: at + 1, event: decision.value.event }),
      obligations: decision.value.obligations.map(encodeObligation),
    };
  });
  assert.deepEqual(plain(rows), journal.rows);
});
