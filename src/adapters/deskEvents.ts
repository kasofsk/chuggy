/**
 * The desk over SQLite: the four instructions a decision hands the desk,
 * absorbed into one table this adapter creates and solely owns.
 *
 * THE PRIMARY KEY IS THE EMISSION KEY, which is the whole of the absorption the
 * port promises: a second delivery of an emission already stored conflicts and
 * changes nothing, so at-least-once delivery costs a row that already exists
 * rather than a second instruction. The key comes from `emissionKey` rather
 * than from a rendering of the pair written out again here — a copied key
 * function is two keys inside a year.
 *
 * THE BOARD IS NOT IN THIS TABLE. What a person reads is the live core joined
 * with the annex, derived on every render; what is stored here is only what the
 * machine told the desk, which the core does not carry and cannot re-derive.
 * The row order is the store's own insertion order, which is the order the desk
 * was first told each thing — a re-delivery lands on the row it already holds
 * and does not move it.
 */

import type { DatabaseSync, StatementSync } from "node:sqlite";

import { effectFromLabel, effectLabel, type Effect } from "../domain/effect.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";
import {
  emissionKey,
  type DeskPort,
  type Emission,
} from "../interpreter/ports.ts";
import type { DeskEvent, DeskLog } from "../interpreter/registry.ts";

/** The one table this adapter creates and owns; the ticket is a column because the log is read per ticket. */
const deskEventsSchema = `
  CREATE TABLE IF NOT EXISTS desk_events (
    emission_key TEXT PRIMARY KEY,
    effect TEXT NOT NULL,
    ticket INTEGER NOT NULL
  ) STRICT;
`;

/** Reads one ticket's stored instructions back, refusing a label this machine does not emit. */
function deskEventsRead(
  select: StatementSync,
  ticket: TicketId,
): readonly DeskEvent[] {
  return select.all(ticket).map((row) => ({
    key: String(row["emission_key"]),
    effect: effectFromLabel(String(row["effect"])),
    ticket: asTicketId(Number(row["ticket"])),
  }));
}

/** The desk over an open connection, whose one table it creates here and owns alone. */
export function deskEvents(db: DatabaseSync): DeskPort & DeskLog {
  db.exec(deskEventsSchema);
  const absorb = db.prepare(
    "INSERT INTO desk_events (emission_key, effect, ticket) VALUES (?, ?, ?) ON CONFLICT (emission_key) DO NOTHING",
  );
  const selectForTicket = db.prepare(
    "SELECT emission_key, effect, ticket FROM desk_events WHERE ticket = ? ORDER BY rowid",
  );
  const post = (effect: Effect, emission: Emission): Promise<void> => {
    absorb.run(emissionKey(emission), effectLabel(effect), emission.ticket);
    return Promise.resolve();
  };
  return {
    createDraft: (emission) => post("CreateDraft", emission),
    revoke: (emission) => post("Revoke", emission),
    openHumanTask: (emission) => post("OpenHumanTask", emission),
    complete: (emission) => post("Complete", emission),
    eventsFor: (ticket) =>
      Promise.resolve(deskEventsRead(selectForTicket, ticket)),
  };
}
