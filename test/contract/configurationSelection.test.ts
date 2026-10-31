/**
 * What a ticket selects from its catalog: the entries it names, and which
 * revision of its configuration it follows, resolved from the ticket, then
 * the catalog, then the revision it was released on.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  configurationFollowings,
  workloadDefaultsSchema,
} from "../../src/contract/configurationDocument.ts";
import {
  configurationFollowingOf,
  configurationSelectionEmpty,
  configurationSelectionSchema,
} from "../../src/contract/configurationSelection.ts";

const defaults = { work: "build", evaluation: "standard" };

test("a selection and a catalog's defaults each take Pinned or Latest, and nothing else", () => {
  for (const configuration of configurationFollowings) {
    assert.deepEqual(configurationSelectionSchema.parse({ configuration }), {
      configuration,
    });
    assert.deepEqual(
      workloadDefaultsSchema.parse({ ...defaults, configuration }),
      { ...defaults, configuration },
    );
  }
  for (const configuration of ["Newest", "latest", "", null, true]) {
    assert.equal(
      configurationSelectionSchema.safeParse({ configuration }).success,
      false,
    );
    assert.equal(
      workloadDefaultsSchema.safeParse({ ...defaults, configuration }).success,
      false,
    );
  }
});

test("a selection and defaults naming no revision read back without one", () => {
  assert.deepEqual(configurationSelectionSchema.parse({ work: "build" }), {
    work: "build",
  });
  assert.deepEqual(workloadDefaultsSchema.parse(defaults), defaults);
});

test("the revision followed is the ticket's, then its catalog's, then Pinned", () => {
  for (const ticket of configurationFollowings)
    for (const catalog of [...configurationFollowings, undefined])
      assert.equal(
        configurationFollowingOf(
          { configuration: ticket },
          catalog === undefined
            ? defaults
            : { ...defaults, configuration: catalog },
        ),
        ticket,
      );
  for (const catalog of configurationFollowings) {
    assert.equal(
      configurationFollowingOf({}, { ...defaults, configuration: catalog }),
      catalog,
    );
    assert.equal(
      configurationFollowingOf(undefined, {
        ...defaults,
        configuration: catalog,
      }),
      catalog,
    );
  }
  assert.equal(configurationFollowingOf({ work: "build" }, defaults), "Pinned");
  assert.equal(configurationFollowingOf(undefined, undefined), "Pinned");
});

test("a selection naming only the revision it follows names something", () => {
  assert.equal(configurationSelectionEmpty({ configuration: "Pinned" }), false);
  assert.equal(configurationSelectionEmpty({ configuration: "Latest" }), false);
  assert.equal(configurationSelectionEmpty({}), true);
  assert.equal(configurationSelectionEmpty(undefined), true);
});
