/**
 * The artifact vocabulary's parse, held to the same standard as the journal's:
 * every accepted shape round-trips through wire text, and every refusal is a
 * reason rather than an exception.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseDeclaration,
  workBranch,
  type CompletionDeclaration,
} from "../../src/interpreter/artifact.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import { id } from "../domain/fixtures.ts";

/** Through wire text and back, which is the path every real declaration takes. */
function roundTrip(declared: CompletionDeclaration): unknown {
  return JSON.parse(JSON.stringify(declared));
}

test("each body kind round-trips through the parse", () => {
  const declared: readonly CompletionDeclaration[] = [
    {
      verdict: "VPass",
      artifact: { body: "BGitRef", branch: workBranch(id(1), asTaskId(1)) },
    },
    { verdict: "VFail", artifact: { body: "BNote", text: "what went wrong" } },
    { verdict: "VPass", artifact: { body: "BNone" } },
  ];
  for (const one of declared) {
    assert.deepEqual(parseDeclaration(roundTrip(one)), {
      parsed: "Ok",
      value: one,
    });
  }
});

test("a declaration outside the vocabulary is refused with its reason", () => {
  const refused: readonly unknown[] = [
    { verdict: "VMaybe", artifact: { body: "BNone" } },
    { verdict: "VPass", artifact: { body: "BGitRef", branch: "" } },
    { verdict: "VPass" },
    { artifact: { body: "BNone" } },
    { verdict: "VPass", artifact: { body: "BTarball", digest: "abc" } },
  ];
  for (const raw of refused) {
    const parsed = parseDeclaration(raw);
    assert.equal(parsed.parsed, "Refused", JSON.stringify(raw));
    assert.ok(parsed.parsed === "Refused" && parsed.why.length > 0);
  }
});

test("the branch convention is one name every side re-forms identically", () => {
  assert.equal(workBranch(id(3), asTaskId(7)), "chug/t3/k7");
});
