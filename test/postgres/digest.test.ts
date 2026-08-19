/**
 * The digest chain's pinned vectors: the exact bytes the encoder produces for
 * a known history, and the exact digests those bytes chain into.
 *
 * WHY WRITTEN-DOWN VALUES AND NOT A RECOMPUTATION. A case that recomputes the
 * expected digest with `journalChainDigest` agrees with any encoder, including
 * one that changed. 006 asks for the versioned encoder to be pinned by test
 * vectors precisely because the failure is silent: regenerating
 * `src/generated/model-api.ts` with a field in a new order would leave every
 * stored digest on the old bytes and every future one on the new, and the load
 * does not verify the chain, so nothing would report it until integrity
 * containment arrives — over authoritative history.
 *
 * A CHANGE HERE IS A FORMAT CHANGE. If a legitimate encoder change lands,
 * these values move with it and the journal is a new format version, not a
 * corrected constant.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  journalChainDigest,
  journalChainGenesis,
} from "../../src/adapters/postgres/digest.ts";
import { encodeEntry } from "../../src/interpreter/wire.ts";
import { postgresHarnessJournal } from "./harness.ts";

/** The wire text of the shared fixture history, entry by entry. */
const pinnedWire: readonly string[] = [
  '{"seq":1,"event":{"type":"ReleaseTicket","value":{"ticket":1,"deps":[],"prog":[{"fanout":1,"combinator":"UnanimousPass"}],"workFanout":1,"reworkPolicy":{"type":"BudgetedRework","value":1},"finalizationPricing":{"type":"Budgeted","value":1},"resumePricing":"RetryCharged","finalizer":"ManagedFinalizer"}},"rec":{"label":"ticket-released","transitions":[],"effects":[]}}',
  '{"seq":2,"event":{"type":"Dispatch","value":1},"rec":{"label":"dispatch","transitions":[{"ticket":1,"from":"Pending","to":"Working"}],"effects":["SpawnWorkTasks"]}}',
];

/** The chain those bytes produce, starting from the genesis label. */
const pinnedDigests: readonly string[] = [
  "3de53557c97fa50ea35b543b2f5ef35c017ff84ddc667c67e519c8e07f803af4",
  "e5a8d50b9f619bb8534cf7c3ac11b8a3f96184de21c69be3fbf8d2c3310363a0",
];

test("the encoder writes the bytes these vectors were taken from", () => {
  const journal = postgresHarnessJournal();
  assert.equal(journal.length, pinnedWire.length);
  assert.deepEqual(journal.map(encodeEntry), pinnedWire);
});

test("the chain those bytes produce is the one written down here", () => {
  let previous = journalChainGenesis;
  const chained = postgresHarnessJournal().map((entry) => {
    previous = journalChainDigest(previous, entry);
    return previous;
  });
  assert.deepEqual(chained, pinnedDigests);
});

test("the genesis label is what the first entry chains onto", () => {
  const first = postgresHarnessJournal()[0];
  assert.ok(first !== undefined);
  assert.equal(
    journalChainDigest(journalChainGenesis, first),
    pinnedDigests[0],
  );
});
