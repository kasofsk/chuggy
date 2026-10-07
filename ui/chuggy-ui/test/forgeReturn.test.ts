/**
 * The word a forge return brings back, which the page returned to takes once
 * and only for the tenant it was held for.
 */

import { expect, test } from "vitest";

import {
  forgeReturnHold,
  forgeReturnKey,
  forgeReturnTake,
} from "../app/core/forgeReturn.ts";
import { keyValueDouble } from "./keyValueDouble.ts";

const tenant = "vteng";

const word = { standing: "Failed", status: "Refused" } as const;

test("a held word is taken once by its own tenant", () => {
  const transient = keyValueDouble();
  forgeReturnHold(transient, tenant, word);
  expect(forgeReturnTake(transient, tenant)).toStrictEqual(word);
  expect(forgeReturnTake(transient, tenant)).toBeUndefined();
});

test("a word held for another tenant is dropped unread", () => {
  const transient = keyValueDouble();
  forgeReturnHold(transient, "other", word);
  expect(forgeReturnTake(transient, tenant)).toBeUndefined();
  expect(transient.held.has(forgeReturnKey)).toBe(false);
});

test("a held word with a standing this console does not know is none", () => {
  const transient = keyValueDouble();
  transient.write(
    forgeReturnKey,
    JSON.stringify({ tenant, standing: "Connected", status: "Refused" }),
  );
  expect(forgeReturnTake(transient, tenant)).toBeUndefined();
  transient.write(forgeReturnKey, "{");
  expect(forgeReturnTake(transient, tenant)).toBeUndefined();
});
