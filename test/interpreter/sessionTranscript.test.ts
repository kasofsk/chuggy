/**
 * The transcript walk, against a real agent runtime's stored bytes.
 *
 * THE FIXTURES ARE A CAPTURED STORE, NOT A HAND-WRITTEN SHAPE, because a walk
 * proved against a fixture the walk's author invented proves that the author
 * agrees with themselves. `test/fixtures/sessionStore/` holds three streams a
 * spike drove through the SDK's own custom-store hook: a resumed session, the
 * same conversation after a manual compaction, and a fork of it. One token in
 * each file's skill listing is redacted, and nothing the walk reads is: every
 * entry's type, uuid, `parentUuid` and `compactMetadata` are the runtime's.
 *
 * The resumed stream's chain is the count `getSessionMessages` answered for the
 * same bytes, which is what makes this walk a substitute for that accessor
 * rather than a second opinion about it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  sessionStoreEntries,
  sessionTranscriptChain,
  sessionTranscriptCompaction,
  sessionTranscriptHeld,
  type SessionStoreEntry,
} from "../../src/interpreter/sessionTranscript.ts";

const streams = {
  resumed: "1ffa6adc-2acf-4f98-a642-f2de9acd0623",
  compacted: "489c5211-ca5d-4031-acc7-4e8014ea966d",
  forked: "09ea97c5-877e-4dd8-b6ed-168e0f154375",
};

function storedEntries(stream: string): readonly SessionStoreEntry[] {
  const text = readFileSync(
    new URL(`../fixtures/sessionStore/${stream}.jsonl`, import.meta.url),
    "utf8",
  );
  const entries = sessionStoreEntries(text);
  assert.ok(entries.length > 0, `${stream} holds entries`);
  return entries;
}

function uuids(entries: readonly SessionStoreEntry[]): readonly string[] {
  return entries.map((entry) => {
    assert.ok(entry.uuid !== undefined, "a chained entry carries a uuid");
    return entry.uuid;
  });
}

test("the chain is the store's parent links, not its file order", () => {
  const entries = twiceCompacted();
  const chain = sessionTranscriptChain(entries);
  const chained = new Set(uuids(chain));
  const byUuid = new Map(
    entries.flatMap((entry) =>
      entry.uuid === undefined ? [] : [[entry.uuid, entry] as const],
    ),
  );
  const reaches = (from: string | undefined, target: string): boolean => {
    const seen = new Set<string>();
    let current = from;
    while (current !== undefined && !seen.has(current)) {
      if (current === target) return true;
      seen.add(current);
      const at = byUuid.get(current);
      current = at?.parentUuid ?? at?.logicalParentUuid;
    }
    return false;
  };
  const tip = entries.at(-1)?.uuid;
  const anchor = sessionTranscriptCompaction(entries)?.anchor;
  const orphaned = entries.filter(
    (entry) =>
      (entry.type === "user" || entry.type === "assistant") &&
      entry.isMeta !== true &&
      entry.uuid !== undefined &&
      !chained.has(entry.uuid),
  );
  assert.ok(
    orphaned.length > 0,
    "the twice-compacted stream holds a user entry on neither live branch",
  );
  for (const entry of chain) {
    assert.ok(entry.uuid !== undefined);
    assert.ok(
      reaches(tip, entry.uuid) || reaches(anchor, entry.uuid),
      "a chained entry is reached from the tip or from the summary",
    );
  }
  for (const entry of orphaned)
    assert.ok(
      !reaches(tip, entry.uuid ?? "") && !reaches(anchor, entry.uuid ?? ""),
      "an entry off both branches is reached from neither",
    );
});

test("the chain drops the runtime's bookkeeping entries", () => {
  const entries = storedEntries(streams.resumed);
  const chain = sessionTranscriptChain(entries);
  assert.deepEqual([...new Set(chain.map((entry) => entry.type))].sort(), [
    "assistant",
    "user",
  ]);
  assert.ok(
    entries.some(
      (entry) => entry.type !== "user" && entry.type !== "assistant",
    ),
    "the stream holds entries the chain must drop",
  );
  assert.ok(
    entries.some((entry) => entry.uuid === undefined),
    "the stream holds entries carrying no uuid",
  );
  assert.equal(chain.length, 12);
});

/**
 * The stored stream with a second compaction laid over it, built from the real
 * boundary's own shape: its uuids are rewritten so the case has two, and every
 * field the walk reads keeps the value the runtime wrote. The real store holds
 * one compaction, so a stream that has compacted twice can only be composed.
 */
function twiceCompacted(): readonly SessionStoreEntry[] {
  const entries = [...storedEntries(streams.compacted)];
  const first = sessionTranscriptCompaction(entries);
  assert.ok(first?.anchor !== undefined);
  const tip = entries.at(-1);
  const boundary: SessionStoreEntry = {
    ...first.boundary,
    uuid: "second-boundary",
    logicalParentUuid: tip?.uuid ?? "",
    compactMetadata: {
      preservedMessages: {
        anchorUuid: "second-summary",
        uuids: [first.anchor],
      },
    },
  };
  const summary: SessionStoreEntry = {
    type: "user",
    uuid: "second-summary",
    parentUuid: "second-boundary",
    message: { role: "user", content: "This session is being continued." },
  };
  const next: SessionStoreEntry = {
    type: "user",
    uuid: "second-turn",
    parentUuid: tip?.uuid ?? "",
    message: { role: "user", content: "and again" },
  };
  return [...entries, boundary, summary, next];
}

test("the seam is the last compaction, not the first", () => {
  const entries = twiceCompacted();
  const compaction = sessionTranscriptCompaction(entries);
  assert.equal(compaction?.boundary.uuid, "second-boundary");
  assert.equal(compaction?.anchor, "second-summary");
  const first = sessionTranscriptCompaction(storedEntries(streams.compacted));
  assert.notEqual(compaction?.boundary.uuid, first?.boundary.uuid);
  const held = uuids(sessionTranscriptHeld(entries));
  assert.deepEqual([...held].sort(), ["second-summary", "second-turn"].sort());
  assert.ok(
    !held.includes(first?.anchor ?? ""),
    "the first compaction's summary is not held after the second cut",
  );
});

test("the compaction is keyed on its own entry, not on the summary's prose", () => {
  const entries = storedEntries(streams.compacted);
  const compaction = sessionTranscriptCompaction(entries);
  assert.ok(compaction !== undefined);
  assert.equal(compaction.boundary.type, "system");
  assert.equal(compaction.boundary.subtype, "compact_boundary");
  assert.equal(
    compaction.boundary.uuid,
    "83738f97-737d-412f-8a49-3c56c4a78ef9",
  );
  assert.deepEqual(compaction.preserved, [
    "908e5b0d-97bf-4722-9b53-e0ea8a283d41",
    "155c3c01-aeea-4312-ab8a-68b553c15903",
  ]);
  const summary = entries.find(
    (entry) =>
      entry.type === "user" &&
      JSON.stringify(entry.message ?? null).includes(
        "This session is being continued",
      ),
  );
  assert.ok(summary !== undefined, "the stream holds the summary entry");
  assert.notEqual(summary.uuid, compaction.boundary.uuid);
});

/**
 * What `getSessionMessages({ sessionStore })` answered for these exact bytes,
 * measured against the SDK rather than reasoned about: the summary, the two
 * entries the cut preserved, and the two appended after it. The runtime's own
 * caveat entry is not among them, which is why a meta entry is not conversation.
 */
const sdkHeldAfterCompaction = [
  "3dac513c-ce7f-4064-852d-fa43d71830cd",
  "908e5b0d-97bf-4722-9b53-e0ea8a283d41",
  "155c3c01-aeea-4312-ab8a-68b553c15903",
  "44da818a-00ff-4b21-b967-cda5ca2c0bb1",
  "ed0c7b23-28f0-40f2-b7a9-1f9e4c0a88d3",
];

test("what the lead holds is what the runtime's own accessor answers", () => {
  const entries = storedEntries(streams.compacted);
  const chain = sessionTranscriptChain(entries);
  const held = sessionTranscriptHeld(entries);
  const compaction = sessionTranscriptCompaction(entries);
  assert.ok(compaction !== undefined);
  assert.ok(
    held.length < chain.length,
    "a compacted stream holds less than its chain",
  );
  assert.deepEqual([...uuids(held)].sort(), [...sdkHeldAfterCompaction].sort());
  assert.ok(
    uuids(held).includes(compaction.anchor ?? ""),
    "the summary the cut wrote is held",
  );
  const cut = entries.indexOf(compaction.boundary);
  for (const entry of held)
    assert.ok(
      compaction.preserved.includes(entry.uuid ?? "") ||
        entries.indexOf(entry) > cut,
      "a held entry is preserved or was appended after the cut",
    );
  const dropped = chain.filter((entry) => !held.includes(entry));
  assert.ok(dropped.length > 0, "a compaction drops something");
  for (const entry of dropped)
    assert.ok(
      entries.indexOf(entry) < cut,
      "what was dropped predates the cut",
    );
});

test("a meta entry is the runtime talking, and is not on the chain", () => {
  const entries = storedEntries(streams.compacted);
  const meta = entries.filter((entry) => entry.isMeta === true);
  assert.ok(meta.length > 0, "the compacted stream holds a meta entry");
  const chained = new Set(uuids(sessionTranscriptChain(entries)));
  for (const entry of meta)
    assert.ok(!chained.has(entry.uuid ?? ""), "a meta entry is not chained");
});

test("an uncompacted stream holds its whole chain", () => {
  const entries = storedEntries(streams.resumed);
  assert.equal(sessionTranscriptCompaction(entries), undefined);
  assert.deepEqual(
    sessionTranscriptHeld(entries),
    sessionTranscriptChain(entries),
  );
});

test("a fork's re-appended parent entries are counted once", () => {
  const parent = storedEntries(streams.resumed);
  const fork = storedEntries(streams.forked);
  const parentChain = uuids(sessionTranscriptChain(parent));
  const forkChain = uuids(sessionTranscriptChain(fork));
  const shared = forkChain.filter((uuid) => parentChain.includes(uuid));
  assert.ok(
    shared.length > 0,
    "the fork re-appends its parent's entries under their own uuids",
  );
  const together = sessionTranscriptChain([...parent, ...fork]);
  const chained = uuids(together);
  assert.equal(new Set(chained).size, chained.length);
  assert.deepEqual(chained, forkChain);
});

test("a line no reader can speak for is dropped and the rest are read", () => {
  const text = readFileSync(
    new URL(
      `../fixtures/sessionStore/${streams.resumed}.jsonl`,
      import.meta.url,
    ),
    "utf8",
  );
  const whole = sessionStoreEntries(text);
  const halfWritten = sessionStoreEntries(`${text}{"type":"user","uu`);
  assert.deepEqual(halfWritten, whole);
  assert.deepEqual(sessionStoreEntries('["not an entry"]\n{"no":"type"}'), []);
});
