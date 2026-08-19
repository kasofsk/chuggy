/**
 * The wire: how one journal entry is written to a store and read back.
 *
 * THE SCHEMA IS NOT WRITTEN HERE. The model's own types compile to a schema
 * and a codec pair, and this module uses them — so a constructor added to the
 * model reaches the wire without anyone editing this file, and cannot reach
 * the wire in a shape the model does not have. A hand-written schema beside a
 * generated one is two statements of the same thing, and the hand-written one
 * is the one that goes stale.
 *
 * WHAT THIS MODULE STILL OWNS is the JSON seam either side of that codec: the
 * text a store keeps, and the refusal a bad row earns. A refusal is returned
 * rather than thrown, because a caller that must handle it is a caller the
 * compiler can insist on.
 */

import {
  decodeEntry,
  encodeEntry as encodeEntryValue,
} from "../generated/model-api.ts";
import type { Entry } from "../domain/generated/modelTypes.ts";

/** Writes one `Entry` as the text a store keeps. */
export function encodeEntry(entry: Entry): string {
  return JSON.stringify(encodeEntryValue(entry));
}

/** What a parse answers: the value, or the reason it was refused. */
export type Parsed<Value> =
  | { readonly parsed: "Ok"; readonly value: Value }
  | { readonly parsed: "Refused"; readonly why: string };

/** Renders the codec's complaint as one line, so the library's own error type stops at this module. */
function parseRefusal(error: unknown): string {
  if (error instanceof Error) return error.message.replaceAll("\n", " ");
  return String(error);
}

/** Reads one wire row into an `Entry`, refusing anything the model does not describe. */
export function parseEntry(raw: unknown): Parsed<Entry> {
  try {
    return { parsed: "Ok", value: decodeEntry(raw) };
  } catch (error: unknown) {
    return { parsed: "Refused", why: parseRefusal(error) };
  }
}

/** Reads a whole stored journal, refusing the lot when any row is not one this machine writes. */
export function parseJournal(raw: unknown): Parsed<readonly Entry[]> {
  if (!Array.isArray(raw)) {
    return { parsed: "Refused", why: "$: a journal is an array of entries" };
  }
  const entries: Entry[] = [];
  for (const [index, row] of raw.entries()) {
    const parsed = parseEntry(row);
    if (parsed.parsed === "Refused") {
      return { parsed: "Refused", why: `${String(index)}: ${parsed.why}` };
    }
    entries.push(parsed.value);
  }
  return { parsed: "Ok", value: entries };
}
