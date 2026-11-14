/**
 * A display name as the contract holds it: what a tenant is renamed to, trimmed,
 * within its bound in code points, and with no control character or half of a
 * pair; and what a tenant is answered as named, which also admits the id it is
 * named by until it is renamed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessTenantDisplayNameChangeSchema,
  accessTenantDisplayNameSchema,
} from "../../src/contract/accessPlane.ts";
import { nativeHttpPathSegmentCharsMax } from "../../src/contract/http.ts";
import {
  displayNameCharsMax,
  displayNameSchema,
} from "../../src/contract/requests.ts";

test("a display name is free text, trimmed, up to its bound in code points", () => {
  assert.equal(displayNameSchema.parse("  Acme Co.  "), "Acme Co.");
  assert.equal(displayNameSchema.parse("Ünïcödé · 名前"), "Ünïcödé · 名前");
  const widest = "\u{1F600}".repeat(displayNameCharsMax);
  assert.equal(displayNameSchema.parse(widest), widest);
  assert.equal(
    displayNameSchema.parse(` ${"n".repeat(displayNameCharsMax)} `),
    "n".repeat(displayNameCharsMax),
  );
});

test("a display name empty once trimmed, past its bound, holding a control character or half of a pair is refused", () => {
  for (const name of [
    "",
    " \t ",
    "n".repeat(displayNameCharsMax + 1),
    "\u{1F600}".repeat(displayNameCharsMax + 1),
    "two\nlines",
    "tab\tbed",
    "nul\u0000",
    "del\u007f",
    "c1\u0085",
    "half\ud800",
  ])
    assert.equal(displayNameSchema.safeParse(name).success, false, name);
});

test("a rename carries its display name and nothing else", () => {
  assert.deepEqual(
    accessTenantDisplayNameChangeSchema.parse({ displayName: " Acme " }),
    { displayName: "Acme" },
  );
  for (const body of [
    {},
    { displayName: "" },
    { displayName: "Acme", tenant: "other" },
  ])
    assert.equal(
      accessTenantDisplayNameChangeSchema.safeParse(body).success,
      false,
    );
});

test("a tenant is answered named by a display name, or by an id up to an id's bound where it was never renamed", () => {
  assert.equal(accessTenantDisplayNameSchema.parse("Acme Co."), "Acme Co.");
  const id = "t".repeat(nativeHttpPathSegmentCharsMax);
  assert.equal(accessTenantDisplayNameSchema.parse(id), id);
  for (const name of ["", "t".repeat(nativeHttpPathSegmentCharsMax + 1)])
    assert.equal(accessTenantDisplayNameSchema.safeParse(name).success, false);
});
