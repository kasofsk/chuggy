/**
 * A tenant's display name as the contract holds it: what a tenant is renamed
 * to, held to the display name a project is, and what a tenant is answered as
 * named, which also admits the id it is named by until it is renamed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessTenantDisplayNameChangeSchema,
  accessTenantDisplayNameSchema,
} from "../../src/contract/accessPlane.ts";
import { nativeHttpPathSegmentCharsMax } from "../../src/contract/http.ts";
import { projectDisplayNameCharsMax } from "../../src/contract/requests.ts";

test("a rename carries its display name, trimmed, up to the bound, and nothing else", () => {
  assert.deepEqual(
    accessTenantDisplayNameChangeSchema.parse({ displayName: " Acme " }),
    { displayName: "Acme" },
  );
  const widest = "n".repeat(projectDisplayNameCharsMax);
  assert.deepEqual(
    accessTenantDisplayNameChangeSchema.parse({ displayName: widest }),
    { displayName: widest },
  );
  for (const body of [
    {},
    { displayName: "" },
    { displayName: " \t " },
    { displayName: `${widest}n` },
    { displayName: "two\nlines" },
    { displayName: "Acme", tenant: "other" },
  ])
    assert.equal(
      accessTenantDisplayNameChangeSchema.safeParse(body).success,
      false,
      JSON.stringify(body),
    );
});

test("a tenant is answered named by a display name, or by an id up to an id's bound where it was never renamed", () => {
  assert.equal(accessTenantDisplayNameSchema.parse("Acme Co."), "Acme Co.");
  const id = "t".repeat(nativeHttpPathSegmentCharsMax);
  assert.equal(accessTenantDisplayNameSchema.parse(id), id);
  for (const name of ["", "t".repeat(nativeHttpPathSegmentCharsMax + 1)])
    assert.equal(accessTenantDisplayNameSchema.safeParse(name).success, false);
});
