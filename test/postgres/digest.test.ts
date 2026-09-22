/**
 * The digest chain's pinned vectors: the exact bytes the encoder produces for
 * a known history, and the exact digests those bytes chain into under a known
 * partition.
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
 * WHY THE PARTITION IS WRITTEN DOWN TOO. The chain is bound to the tenant and
 * project that hold it, so vectors taken under identities the harness invents
 * afresh each run would pin nothing about that binding.
 *
 * A CHANGE HERE IS A FORMAT CHANGE OR A VOCABULARY ONE. Bytes arranged
 * differently are a new journal format version; the same arrangement saying a
 * word the machine renamed is the decision semantics a row declares. Neither
 * is a corrected constant.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  journalChainDigest,
  journalChainGenesis,
  journalEnvelopeDigest,
} from "../../src/adapters/postgres/digest.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { encodeEntry } from "../../src/interpreter/wire.ts";
import { postgresHarnessEntry, postgresHarnessJournal } from "./harness.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";

/** The partition these vectors were taken under, fixed so the digests can be written down. */
const pinnedPartition: Partition = {
  tenant: asTenantId("tenant-pinned"),
  project: asProjectId("project-pinned"),
};

/** That partition under another tenant, and under another project. */
const otherPartitions: readonly Partition[] = [
  { ...pinnedPartition, tenant: asTenantId("tenant-other") },
  { ...pinnedPartition, project: asProjectId("project-other") },
];

/** The digest the first entry of that partition chains onto. */
const pinnedGenesis =
  "8dc0f12f39ff19bd64e93e1909a62fa3f157c26b1c2cf345a8389d4513d83e27";

/** The wire text of the shared fixture history, entry by entry. */
const pinnedWire: readonly string[] = [
  '{"seq":1,"event":{"type":"CreateTicket","value":{"id":1,"content":21,"dependencies":[],"workConfiguration":{"workload":22,"inputs":23,"executionRequirements":24,"resultContract":25},"evaluationPlan":{"stages":[{"key":1,"evaluators":[{"key":1,"task":{"workload":1,"inputs":2,"executionRequirements":3,"resultContract":4}}]}]},"finalizationConfiguration":26}},"rec":{"label":"ticket-released","transitions":[],"effects":[]}}',
  '{"seq":2,"event":{"type":"Dispatch","value":{"ticket":1,"source":9}},"rec":{"label":"dispatch","transitions":[{"ticket":1,"from":"Pending","to":"Work"}],"effects":["SpawnWorkTasks"]}}',
];

/** The chain those bytes produce under that partition, starting from its genesis. */
const pinnedDigests: readonly string[] = [
  "65eaedb32f2e373f02e900290928568163a724cc79f04aef2cb686c43fc8178d",
  "58eea09723a89e9c0c86f446d2b81679676b5a72ef5e247cc99ecd17dfa421a1",
];

test("the encoder writes the bytes these vectors were taken from", () => {
  const journal = postgresHarnessJournal();
  assert.equal(journal.length, pinnedWire.length);
  assert.deepEqual(journal.map(encodeEntry), pinnedWire);
});

test("the genesis that partition chains from is the one written down here", () => {
  assert.equal(journalChainGenesis(pinnedPartition), pinnedGenesis);
});

test("the chain those bytes produce is the one written down here", () => {
  let previous = pinnedGenesis;
  const chained = pinnedWire.map((text) => {
    previous = journalChainDigest(pinnedPartition, previous, text);
    return previous;
  });
  assert.deepEqual(chained, pinnedDigests);
});

test("a chain built for one partition does not verify under another", () => {
  const first = encodeEntry(postgresHarnessEntry(0));
  const genesis = journalChainGenesis(pinnedPartition);
  const home = journalChainDigest(pinnedPartition, genesis, first);
  for (const other of otherPartitions) {
    assert.notEqual(journalChainGenesis(other), genesis);
    assert.notEqual(
      journalChainDigest(other, journalChainGenesis(other), first),
      home,
    );
    assert.notEqual(journalChainDigest(other, genesis, first), home);
  }
});

test("the complete envelope digest covers cause and release configuration", () => {
  const entry = postgresHarnessEntry(0);
  const previous = journalChainGenesis(pinnedPartition);
  const envelope = {
    entryText: encodeEntry(entry),
    cause: { kind: "Operation" as const, id: asOperationId("operation") },
    configuration: {
      configurationRevision: "config-1",
      configurationDigest: "digest-1",
    },
    eventSchemaVersion: 1 as const,
    decisionSemanticsVersion: 1 as const,
  };
  const digest = journalEnvelopeDigest(pinnedPartition, previous, envelope);
  assert.notEqual(
    journalEnvelopeDigest(pinnedPartition, previous, {
      ...envelope,
      cause: { kind: "Operation", id: asOperationId("other-operation") },
    }),
    digest,
  );
  assert.notEqual(
    journalEnvelopeDigest(pinnedPartition, previous, {
      ...envelope,
      configuration: {
        ...envelope.configuration,
        configurationDigest: "digest-2",
      },
    }),
    digest,
  );
  assert.notEqual(
    journalEnvelopeDigest(pinnedPartition, previous, {
      ...envelope,
      eventSchemaVersion: 2,
    }),
    digest,
  );
  assert.notEqual(
    journalEnvelopeDigest(pinnedPartition, previous, {
      ...envelope,
      decisionSemanticsVersion: 2,
    }),
    digest,
  );
});

test("the chain covers the stored text and not what it decodes to", () => {
  const stored = pinnedWire[0];
  assert.ok(stored !== undefined);
  const spaced = JSON.stringify(JSON.parse(stored), undefined, 1);
  assert.deepEqual(JSON.parse(spaced), JSON.parse(stored));
  assert.notEqual(
    journalChainDigest(pinnedPartition, pinnedGenesis, spaced),
    journalChainDigest(pinnedPartition, pinnedGenesis, stored),
  );
});
