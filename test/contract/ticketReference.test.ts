/**
 * The grammar a ticket is named by, read from both ends: what the console
 * writes is what the splitter reads back, the loose spellings an agent may
 * write are forgiven, and everything that only looks like a reference stays the
 * text it is.
 *
 * The round trip is the case that matters most. The console serializes a
 * mention and the console draws the turn that comes back, so a serializer and a
 * splitter that disagreed would lose a reference between the member pressing
 * send and the member reading what they sent.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ticketReferenceDigitsMax,
  ticketReferenceInstruction,
  ticketReferenceNames,
  ticketReferenceSerialize,
  ticketReferenceSplit,
} from "../../src/contract/ticketReference.ts";

test("what the console writes is what the splitter reads back", () => {
  for (const ticket of [1, 15, 4096, Number.MAX_SAFE_INTEGER]) {
    const written = ticketReferenceSerialize(ticket);
    assert.deepEqual(ticketReferenceSplit(written), [
      { kind: "Ticket", ticket },
    ]);
    assert.equal(ticketReferenceNames(written), true);
  }
});

test("a reference is read out of the prose around it", () => {
  assert.deepEqual(
    ticketReferenceSplit(
      "filed [[ticket:15]] for that, see also [[ticket:16]]",
    ),
    [
      { kind: "Text", text: "filed " },
      { kind: "Ticket", ticket: 15 },
      { kind: "Text", text: " for that, see also " },
      { kind: "Ticket", ticket: 16 },
    ],
  );
});

test("two references running together leave no empty run between them", () => {
  assert.deepEqual(ticketReferenceSplit("[[ticket:1]][[ticket:2]]"), [
    { kind: "Ticket", ticket: 1 },
    { kind: "Ticket", ticket: 2 },
  ]);
});

test("the case and the inner spaces an agent may write are forgiven", () => {
  for (const written of [
    "[[Ticket:15]]",
    "[[TICKET:15]]",
    "[[ticket: 15]]",
    "[[ ticket : 15 ]]",
  ])
    assert.deepEqual(
      ticketReferenceSplit(written),
      [{ kind: "Ticket", ticket: 15 }],
      written,
    );
});

test("what only looks like a reference stays the text it is", () => {
  for (const written of [
    "#15",
    "[15]",
    "[[15]]",
    "[[ticket:]]",
    "[[ticket:0]]",
    "[[ticket:015]]",
    "[[ticket:-1]]",
    "[[ticket:15",
    "[[run:15]]",
    "[[ticket:1.5]]",
    `[[ticket:${"9".repeat(ticketReferenceDigitsMax)}]]`,
    `[[ticket:${"9".repeat(ticketReferenceDigitsMax + 1)}]]`,
  ]) {
    assert.deepEqual(
      ticketReferenceSplit(written),
      [{ kind: "Text", text: written }],
      written,
    );
    assert.equal(ticketReferenceNames(written), false, written);
  }
});

test("a text naming nothing is one segment, and an empty text is none", () => {
  assert.deepEqual(ticketReferenceSplit("nothing here"), [
    { kind: "Text", text: "nothing here" },
  ]);
  assert.deepEqual(ticketReferenceSplit(""), []);
});

test("the objectives state the very form the console writes", () => {
  assert.ok(ticketReferenceInstruction.includes(ticketReferenceSerialize(15)));
  assert.deepEqual(
    ticketReferenceSplit(ticketReferenceInstruction).filter(
      (segment) => segment.kind === "Ticket",
    ),
    [{ kind: "Ticket", ticket: 15 }],
  );
});
