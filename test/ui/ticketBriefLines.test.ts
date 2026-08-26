/**
 * The console's count of an intent's printed lines, held against the count the
 * interpreter stores one by.
 *
 * `ui/chuggy-ui/app/core/ticketCreation.ts` restates that count because the
 * wire's parser does not carry it and a browser reaches only `src/contract/`.
 * This is the arrangement `no-console-sees-another` names for a rule two trees
 * both need: the copy is written twice and a suite outside both holds them
 * equal, over the newline a browser sends and the blank line neither prints.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { briefIntentLinesMax } from "../../src/contract/brief.ts";
import {
  asBriefIntent,
  briefIntentLines,
} from "../../src/interpreter/ticketBrief.ts";
import { creationIntentLines } from "../../ui/chuggy-ui/app/core/ticketCreation.ts";

const intents = [
  "one line",
  "a\r\n\r\n b \n",
  "first\nsecond\n\n\nthird",
  "  padded  \n also padded ",
  "trailing\n",
];

test("the console counts an intent's lines as the store that bounds them does", () => {
  for (const intent of intents)
    assert.deepEqual(creationIntentLines(intent), [
      ...briefIntentLines(asBriefIntent(intent)),
    ]);
});

test("the bound the console refuses at is the bound the store refuses at", () => {
  const lines = (count: number): string =>
    Array.from({ length: count }, (_, at) => `line ${String(at)}`).join("\n\n");
  const allowed = lines(briefIntentLinesMax);
  assert.equal(creationIntentLines(allowed).length, briefIntentLinesMax);
  assert.doesNotThrow(() => asBriefIntent(allowed));
  const refused = lines(briefIntentLinesMax + 1);
  assert.ok(creationIntentLines(refused).length > briefIntentLinesMax);
  assert.throws(() => asBriefIntent(refused));
});
