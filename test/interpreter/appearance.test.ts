/**
 * A person's own appearance as the service decides it: a document the
 * contrast rule refuses never reaches the store, a creation is held to the
 * bound the contract names, and each answer is the store's for the caller's
 * own principal.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  builtInThemes,
  themeContrastFailures,
  themesOwnedMax,
  type ThemeDocument,
} from "../../src/contract/appearance.ts";
import {
  appearanceService,
  type AppearanceStore,
} from "../../src/interpreter/appearance.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";

const caller = asPrincipal("issuer-subject");

/** Harbour's palette, which carries both schemes. */
const harbourPalette = (() => {
  const palette = builtInThemes.harbour.palette;
  assert.equal(palette.schemes, "Both");
  return palette;
})();

const passing: ThemeDocument = { ...builtInThemes.harbour, name: "Mine" };

/** Harbour with its faintest ink drawn in its panel's own colour, which the contrast rule refuses. */
const faint: ThemeDocument = {
  ...passing,
  palette: {
    schemes: "Light",
    light: {
      ...harbourPalette.light,
      "ink-3": harbourPalette.light["surface-1"],
    },
  },
};

/** A store answering `created` to every creation and true to every write, recording each call. */
function recordingStore(
  calls: string[],
  created: number | undefined,
): AppearanceStore {
  return {
    themes: () => Promise.resolve([]),
    theme: () => Promise.resolve(undefined),
    create: (principal, document, themesMax) => {
      calls.push(`create:${principal}:${document.name}:${String(themesMax)}`);
      return Promise.resolve(created);
    },
    write: (principal, theme, document) => {
      calls.push(`write:${principal}:${String(theme)}:${document.name}`);
      return Promise.resolve(theme === 7);
    },
    delete: (principal, theme) => {
      calls.push(`delete:${principal}:${String(theme)}`);
      return Promise.resolve(theme === 7);
    },
    choice: () => Promise.resolve(undefined),
    choose: (principal, choice) => {
      calls.push(`choose:${principal}:${JSON.stringify(choice ?? null)}`);
      return Promise.resolve(choice?.kind !== "Owned" || choice.theme === 7);
    },
  };
}

test("the fixture the refusals are written against is one the contrast rule refuses, and the passing one it passes", () => {
  assert.notDeepEqual(themeContrastFailures(faint), []);
  assert.deepEqual(themeContrastFailures(passing), []);
});

test("a document the contrast rule refuses is answered with every failure and reaches no store", async () => {
  const calls: string[] = [];
  const service = appearanceService(recordingStore(calls, 7));
  const failures = themeContrastFailures(faint);
  assert.deepEqual(await service.create(caller, faint), {
    result: "ContrastInsufficient",
    failures,
  });
  assert.deepEqual(await service.write(caller, 7, faint), {
    result: "ContrastInsufficient",
    failures,
  });
  assert.deepEqual(calls, [], "the store was asked nothing");
});

test("a creation is held to the contract's bound, and one the store keeps nothing of is the bound reached", async () => {
  const calls: string[] = [];
  assert.deepEqual(
    await appearanceService(recordingStore(calls, 7)).create(caller, passing),
    { result: "Created", theme: { theme: 7, document: passing } },
  );
  assert.deepEqual(
    await appearanceService(recordingStore(calls, undefined)).create(
      caller,
      passing,
    ),
    { result: "LimitReached" },
  );
  assert.deepEqual(calls, [
    `create:${caller}:Mine:${String(themesOwnedMax)}`,
    `create:${caller}:Mine:${String(themesOwnedMax)}`,
  ]);
});

test("a write, a delete and a choice answer what the store found of the caller's own", async () => {
  const calls: string[] = [];
  const service = appearanceService(recordingStore(calls, 7));
  assert.deepEqual(await service.write(caller, 7, passing), {
    result: "Written",
  });
  assert.deepEqual(await service.write(caller, 8, passing), {
    result: "NotFound",
  });
  assert.equal(await service.delete(caller, 7), "Deleted");
  assert.equal(await service.delete(caller, 8), "NotFound");
  assert.equal(
    await service.choose(caller, { kind: "Owned", theme: 7 }),
    "Chosen",
  );
  assert.equal(
    await service.choose(caller, { kind: "Owned", theme: 8 }),
    "ThemeNotFound",
  );
  assert.equal(await service.choose(caller, undefined), "Chosen");
  assert.deepEqual(calls, [
    `write:${caller}:7:Mine`,
    `write:${caller}:8:Mine`,
    `delete:${caller}:7`,
    `delete:${caller}:8`,
    `choose:${caller}:{"kind":"Owned","theme":7}`,
    `choose:${caller}:{"kind":"Owned","theme":8}`,
    `choose:${caller}:null`,
  ]);
});
