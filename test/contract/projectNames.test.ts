/**
 * What a project is called beside the name that addresses it: the display
 * name's bounds as a creation is held to them, and the project as the wire
 * answers it, named.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  projectCreationSchema,
  projectDisplayNameCharsMax,
  projectDisplayNameSchema,
} from "../../src/contract/requests.ts";
import {
  namedProjectSchema,
  projectCreatedSchema,
  projectInventoryResponseSchema,
} from "../../src/contract/responses.ts";

test("a display name is any text but a control character, read trimmed", () => {
  for (const name of ["Acme Billing", "Bob's API v2", "Café — 東京", "x"])
    assert.equal(projectDisplayNameSchema.parse(name), name);
  assert.equal(
    projectDisplayNameSchema.parse("  Acme Billing \t"),
    "Acme Billing",
  );
});

test("a display name empty once trimmed is refused", () => {
  for (const name of ["", " ", " 　"])
    assert.equal(
      projectDisplayNameSchema.safeParse(name).success,
      false,
      JSON.stringify(name),
    );
});

test("a display name holding a control character is refused, wherever it sits", () => {
  for (const name of [
    "Acme\u0000",
    "Ac\nme",
    "Ac\tme",
    "Acme\u007f",
    "Acme\u0085Billing",
  ])
    assert.equal(
      projectDisplayNameSchema.safeParse(name).success,
      false,
      JSON.stringify(name),
    );
});

test("a display name is bounded once trimmed, and the bound is taken whole", () => {
  const longest = "n".repeat(projectDisplayNameCharsMax);
  assert.equal(projectDisplayNameSchema.parse(longest), longest);
  assert.equal(projectDisplayNameSchema.parse(` ${longest} `), longest);
  assert.equal(
    projectDisplayNameSchema.safeParse(`${longest}n`).success,
    false,
  );
});

test("a creation names its display name beside its tenant and project", () => {
  assert.deepEqual(
    projectCreationSchema.parse({
      tenant: "acme",
      project: "billing",
      name: "Acme Billing",
    }),
    { tenant: "acme", project: "billing", name: "Acme Billing" },
  );
  assert.equal(
    projectCreationSchema.safeParse({ tenant: "acme", project: "billing" })
      .success,
    false,
  );
});

test("a project is answered named, created and listed alike", () => {
  const project = { tenant: "acme", project: "billing", name: "Acme Billing" };
  assert.deepEqual(projectCreatedSchema.parse(project), project);
  assert.deepEqual(
    projectInventoryResponseSchema.parse({ projects: [project] }).projects,
    [project],
  );
  for (const name of [
    undefined,
    "",
    "n".repeat(projectDisplayNameCharsMax + 1),
  ])
    assert.equal(
      namedProjectSchema.safeParse({ tenant: "acme", project: "billing", name })
        .success,
      false,
      JSON.stringify(name),
    );
});
