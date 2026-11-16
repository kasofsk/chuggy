/**
 * A project's appearance as the service decides it: the layers taken highest
 * first, one layer at a time; a layer naming a theme no longer there resolved
 * as unset; the project's default written by an administrator alone and held
 * to the contrast rule; and an override the caller's own, under `Read`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  builtInThemes,
  type ThemeDocument,
} from "../../src/contract/appearance.ts";
import { projectAppearanceResolved } from "../../src/interpreter/projectAppearance.ts";
import {
  administrator,
  atlas,
  projectAppearanceFixture,
  projectDocument,
  reader,
  stranger,
} from "./projectAppearanceFixture.ts";

const mine: ThemeDocument = { ...builtInThemes.harbour, name: "Mine" };
const globalTheme: ThemeDocument = { ...builtInThemes.ember, name: "Global" };

test("each layer, set alone, is the one worn, and none set wears the built-in default", () => {
  const owned = new Map([
    [3, mine],
    [4, globalTheme],
  ]);
  const none = {
    override: undefined,
    projectDefault: undefined,
    global: undefined,
  };
  for (const [stored, theme, layer] of [
    [
      { ...none, override: { kind: "Owned", theme: 3 } },
      mine,
      "ProjectOverride",
    ],
    [
      { ...none, override: { kind: "BuiltIn", theme: "harbour" } },
      builtInThemes.harbour,
      "ProjectOverride",
    ],
    [
      { ...none, projectDefault: projectDocument },
      projectDocument,
      "ProjectDefault",
    ],
    [{ ...none, global: { kind: "Owned", theme: 4 } }, globalTheme, "Global"],
    [none, builtInThemes.chuggy, "BuiltInDefault"],
  ] as const) {
    const resolved = projectAppearanceResolved(stored, owned);
    assert.deepEqual(
      { theme: resolved.theme, layer: resolved.layer },
      { theme, layer },
      layer,
    );
    assert.deepEqual(resolved.layers, stored);
  }
});

test("a higher layer wins over every lower one, and each lower one is still answered as its own value", () => {
  const owned = new Map([
    [3, mine],
    [4, globalTheme],
  ]);
  const all = {
    override: { kind: "Owned", theme: 3 },
    projectDefault: projectDocument,
    global: { kind: "Owned", theme: 4 },
  } as const;
  assert.equal(projectAppearanceResolved(all, owned).layer, "ProjectOverride");
  assert.deepEqual(projectAppearanceResolved(all, owned).layers, all);
  const noOverride = { ...all, override: undefined };
  assert.deepEqual(
    projectAppearanceResolved(noOverride, owned).theme,
    projectDocument,
  );
  const onlyGlobal = { ...noOverride, projectDefault: undefined };
  assert.equal(projectAppearanceResolved(onlyGlobal, owned).layer, "Global");
});

test("a layer naming a theme that no longer exists resolves as that layer unset", () => {
  const owned = new Map([[4, globalTheme]]);
  const dangling = projectAppearanceResolved(
    {
      override: { kind: "Owned", theme: 3 },
      projectDefault: undefined,
      global: { kind: "Owned", theme: 4 },
    },
    owned,
  );
  assert.equal(dangling.layer, "Global");
  assert.equal(dangling.layers.override, undefined);
  const bothGone = projectAppearanceResolved(
    {
      override: { kind: "Owned", theme: 3 },
      projectDefault: undefined,
      global: { kind: "Owned", theme: 5 },
    },
    owned,
  );
  assert.deepEqual(
    { layer: bothGone.layer, layers: bothGone.layers },
    {
      layer: "BuiltInDefault",
      layers: {
        override: undefined,
        projectDefault: undefined,
        global: undefined,
      },
    },
  );
});

test("the resolved read gathers the caller's own layers and no other person's", async () => {
  const { held, service } = projectAppearanceFixture();
  held.owned.set(reader, new Map([[3, mine]]));
  held.overrides.set(reader, { kind: "Owned", theme: 3 });
  held.overrides.set(administrator, {
    kind: "BuiltIn",
    theme: "high-contrast",
  });
  held.globals.set(reader, { kind: "BuiltIn", theme: "ember" });
  held.projectDefault = projectDocument;
  const read = await service.resolved(reader, atlas);
  assert.deepEqual(read, {
    result: "Found",
    view: {
      theme: mine,
      layer: "ProjectOverride",
      layers: {
        override: { kind: "Owned", theme: 3 },
        projectDefault: projectDocument,
        global: { kind: "BuiltIn", theme: "ember" },
      },
    },
  });
  assert.deepEqual(await service.resolved(stranger, atlas), {
    result: "NotFound",
  });
});

test("a member without administer is refused the project's default, and an administrator sets and clears it", async () => {
  const { held, service } = projectAppearanceFixture();
  assert.deepEqual(await service.writeTheme(reader, atlas, projectDocument), {
    result: "NotFound",
  });
  assert.deepEqual(await service.writeTheme(stranger, atlas, projectDocument), {
    result: "NotFound",
  });
  assert.deepEqual(held.writes, []);
  assert.deepEqual(await service.theme(reader, atlas), {
    result: "Found",
    view: { document: undefined, administers: false },
  });
  assert.deepEqual(
    await service.writeTheme(administrator, atlas, projectDocument),
    {
      result: "Written",
      view: { document: projectDocument, administers: true },
    },
  );
  assert.deepEqual(await service.writeTheme(administrator, atlas, undefined), {
    result: "Written",
    view: { document: undefined, administers: true },
  });
  assert.deepEqual(held.writes, [
    "project:administrator:Atlas",
    "project:administrator:",
  ]);
});

test("a project default the contrast rule refuses never reaches the store", async () => {
  const { held, service } = projectAppearanceFixture();
  const palette = builtInThemes.harbour.palette;
  assert.equal(palette.schemes, "Both");
  const faint: ThemeDocument = {
    ...projectDocument,
    palette: {
      schemes: "Light",
      light: { ...palette.light, "ink-3": palette.light["surface-1"] },
    },
  };
  const refused = await service.writeTheme(administrator, atlas, faint);
  assert.equal(refused.result, "ContrastInsufficient");
  assert.deepEqual(held.writes, []);
});

test("an override needs only that its person may read the project, and is theirs alone", async () => {
  const { held, service } = projectAppearanceFixture();
  held.owned.set(administrator, new Map([[9, mine]]));
  assert.equal(
    await service.chooseOverride(reader, atlas, {
      kind: "BuiltIn",
      theme: "ember",
    }),
    "Chosen",
  );
  assert.equal(
    await service.chooseOverride(reader, atlas, { kind: "Owned", theme: 9 }),
    "ThemeNotFound",
    "a theme of another person's is none of the caller's",
  );
  assert.equal(
    await service.chooseOverride(stranger, atlas, {
      kind: "BuiltIn",
      theme: "ember",
    }),
    "NotFound",
  );
  assert.deepEqual(await service.override(reader, atlas), {
    result: "Found",
    view: { kind: "BuiltIn", theme: "ember" },
  });
  assert.deepEqual(await service.override(administrator, atlas), {
    result: "Found",
    view: undefined,
  });
  assert.equal(
    await service.chooseOverride(reader, atlas, undefined),
    "Chosen",
  );
  assert.equal(held.overrides.has(reader), false);
});
