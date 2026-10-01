/**
 * The word a forge return brings back, which the page returned to takes once
 * and only for the project it was held for.
 */

import { expect, test } from "vitest";

import {
  forgeReturnHold,
  forgeReturnKey,
  forgeReturnTake,
} from "../app/core/forgeReturn.ts";
import { keyValueDouble } from "./keyValueDouble.ts";

const partition = { tenant: "vteng", project: "chuggy" };

const word = { standing: "Failed", status: "Refused" } as const;

test("a held word is taken once by its own project", () => {
  const transient = keyValueDouble();
  forgeReturnHold(transient, partition, word);
  expect(forgeReturnTake(transient, partition)).toStrictEqual(word);
  expect(forgeReturnTake(transient, partition)).toBeUndefined();
});

test("a word held for another project is dropped unread", () => {
  for (const elsewhere of [
    { ...partition, tenant: "other" },
    { ...partition, project: "other" },
  ]) {
    const transient = keyValueDouble();
    forgeReturnHold(transient, elsewhere, word);
    expect(forgeReturnTake(transient, partition)).toBeUndefined();
    expect(transient.held.has(forgeReturnKey)).toBe(false);
  }
});

test("a held word with a standing this console does not know is none", () => {
  const transient = keyValueDouble();
  transient.write(
    forgeReturnKey,
    JSON.stringify({ ...partition, standing: "Connected", status: "Refused" }),
  );
  expect(forgeReturnTake(transient, partition)).toBeUndefined();
  transient.write(forgeReturnKey, "{");
  expect(forgeReturnTake(transient, partition)).toBeUndefined();
});
