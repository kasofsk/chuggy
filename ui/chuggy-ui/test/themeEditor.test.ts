/**
 * What the theme editor decides: every role shown once, the lead roles first;
 * a draft that starts as a copy of the theme in use, in both schemes; a colour
 * typed in any case, and a text that is no colour held aside and blocking the
 * save; what is dirty; each pairing's verdict the contract's own; a failing
 * pairing blocking the save; and the nearest value offered for a role at
 * fault passing without failing another pairing.
 */

import { expect, test } from "vitest";

import {
  builtInThemeIds,
  builtInThemes,
  contrastRatio,
  themeContrastFailures,
  themeContrastPairs,
  themeRoles,
} from "../../../src/contract/appearance.ts";
import type { ThemeDocument } from "../../../src/contract/appearance.ts";
import {
  themeDraftDocument,
  themeDraftOf,
  themeEditingColourText,
  themeEditingColourTyped,
  themeEditingDirty,
  themeEditingOf,
  themeEditorColourRead,
  themeEditorContrasts,
  themeEditorFailingRoles,
  themeEditorGroupsOf,
  themeEditorNearest,
  themeEditorRatioText,
  themeEditorRolesLead,
  themeEditorSavingOf,
} from "../app/core/themeEditor.ts";
import { themeColoursOf } from "../app/core/themeTokens.ts";

const { chuggy, harbour } = builtInThemes;

test("every role is shown exactly once, the lead roles in the first groups and the rest under them, in the roster's order", () => {
  const lead = themeEditorGroupsOf(true);
  const rest = themeEditorGroupsOf(false);
  const shown = [...lead, ...rest].flatMap((group) => group.roles);
  expect([...shown].sort()).toStrictEqual([...themeRoles].sort());
  expect(lead.flatMap((group) => group.roles)).toStrictEqual(
    themeRoles.filter((role) => themeEditorRolesLead.includes(role)),
  );
  expect(lead.map((group) => group.group)).toStrictEqual([
    "Surfaces",
    "Text",
    "Accent",
  ]);
  expect(rest.map((group) => group.group)).toStrictEqual([
    "Surfaces",
    "Text",
    "Edges",
  ]);
});

test("a draft starts as a copy of the theme in both schemes, a scheme the theme does not carry being the one the console draws for it, and is saved as a theme of both", () => {
  const lightOnly: ThemeDocument = {
    name: "Light only",
    palette: {
      schemes: "Light",
      light: themeColoursOf(harbour, "Light"),
    },
    textSize: "Large",
    font: "Serif",
  };
  const draft = themeDraftOf(lightOnly, "Light only copy");
  expect(draft.colours.Light).toStrictEqual(themeColoursOf(harbour, "Light"));
  expect(draft.colours.Dark).toStrictEqual(themeColoursOf(chuggy, "Dark"));
  expect(themeDraftDocument({ ...draft, name: "  Mine  " })).toStrictEqual({
    name: "Mine",
    palette: {
      schemes: "Both",
      light: themeColoursOf(harbour, "Light"),
      dark: themeColoursOf(chuggy, "Dark"),
    },
    textSize: "Large",
    font: "Serif",
  });
});

test("a colour is read in any case with or without its #, and nothing else is a colour", () => {
  expect(themeEditorColourRead("#1F5F99")).toBe("#1f5f99");
  expect(themeEditorColourRead(" 1f5f99 ")).toBe("#1f5f99");
  for (const typed of ["#1f5", "#1f5f9g", "", "url(x)", "red", "#1f5f9900"])
    expect(themeEditorColourRead(typed)).toBeUndefined();
});

test("a field that reads as no colour keeps what was typed, leaves the draft as it was, is dirty and blocks the save until it reads", () => {
  const start = themeEditingOf(themeDraftOf(harbour, "Mine"));
  const typed = themeEditingColourTyped(start, "Dark", "accent", "#12");
  expect(themeEditingColourText(typed, "Dark", "accent")).toBe("#12");
  expect(typed.draft).toBe(start.draft);
  expect(themeEditingDirty(typed)).toBe(true);
  expect(themeEditorSavingOf(typed, true)).toStrictEqual({ kind: "Unread" });
  const read = themeEditingColourTyped(typed, "Dark", "accent", "#7AB4EA");
  expect(read.unread).toStrictEqual([]);
  expect(themeEditingColourText(read, "Dark", "accent")).toBe("#7ab4ea");
  expect(themeEditingDirty(read)).toBe(false);
});

test("a theme being edited is saved only once it differs, a new one as it opened, and neither without a name", () => {
  const start = themeEditingOf(themeDraftOf(harbour, "Mine"));
  expect(themeEditorSavingOf(start, false)).toStrictEqual({
    kind: "Unchanged",
  });
  expect(themeEditorSavingOf(start, true)).toStrictEqual({
    kind: "Saveable",
    document: themeDraftDocument(start.draft),
  });
  const unnamed = { ...start, draft: { ...start.draft, name: "  " } };
  expect(themeEditingDirty(unnamed)).toBe(true);
  expect(themeEditorSavingOf(unnamed, false)).toStrictEqual({
    kind: "Unnamed",
  });
});

/** Harbour with its light accent's text drawn as the accent itself. */
const failing = themeEditingColourTyped(
  themeEditingOf(themeDraftOf(harbour, "Mine")),
  "Light",
  "ink-on-accent",
  "#2a6aa4",
);

test("each pairing's verdict is the contract's own and its ratio the contract's ratio, in every built-in and in a draft that fails", () => {
  for (const draft of [
    ...builtInThemeIds.map((id) => themeDraftOf(builtInThemes[id], id)),
    failing.draft,
  ])
    for (const scheme of ["Light", "Dark"] as const) {
      const contrasts = themeEditorContrasts(draft, scheme);
      expect(contrasts.map((contrast) => contrast.pair)).toStrictEqual(
        themeContrastPairs,
      );
      const failures = themeContrastFailures(themeDraftDocument(draft)).filter(
        (failure) => failure.scheme === scheme,
      );
      expect(
        contrasts
          .filter((contrast) => !contrast.passes)
          .map(({ pair }) => [pair.foreground, pair.background]),
      ).toStrictEqual(
        failures.map((failure) => [failure.foreground, failure.background]),
      );
      for (const contrast of contrasts)
        expect(contrast.passes).toBe(contrast.ratio >= contrast.pair.ratioMin);
    }
  const accent = themeEditorContrasts(failing.draft, "Light").find(
    ({ pair }) => pair.foreground === "ink-on-accent",
  );
  expect(accent?.ratio).toBe(contrastRatio("#2a6aa4", "#1f5f99"));
  expect(accent?.role).toBe("ink-on-accent");
});

test("a pairing that fails blocks the save and names itself, in the scheme it fails in", () => {
  const saving = themeEditorSavingOf(failing, true);
  expect(saving.kind).toBe("Inaccessible");
  expect(saving.kind === "Inaccessible" ? saving.failures : []).toStrictEqual(
    themeContrastFailures(themeDraftDocument(failing.draft)),
  );
  expect(
    saving.kind === "Inaccessible"
      ? saving.failures.map(({ foreground, background, scheme }) => [
          foreground,
          background,
          scheme,
        ])
      : [],
  ).toStrictEqual([["ink-on-accent", "accent", "Light"]]);
  expect(themeEditorFailingRoles(failing.draft, "Light")).toStrictEqual([
    "ink-on-accent",
  ]);
  expect(themeEditorFailingRoles(failing.draft, "Dark")).toStrictEqual([]);
});

test("the nearest value offered for a role at fault passes every pairing it changes, fails no pairing that passed, and is the first step that does", () => {
  const nearest = themeEditorNearest(failing.draft, "Light", "ink-on-accent");
  expect(nearest).toBeDefined();
  const fixed = themeEditingColourTyped(
    failing,
    "Light",
    "ink-on-accent",
    nearest ?? "",
  );
  expect(themeEditorSavingOf(fixed, true).kind).toBe("Saveable");
  const ratio = contrastRatio(nearest ?? "", "#1f5f99");
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio("#2a6aa4", "#1f5f99")).toBeLessThan(ratio);
});

/** Every role the one grey, so nearly every pairing fails. */
const flat = themeDraftOf(
  {
    ...harbour,
    palette: {
      schemes: "Light",
      light: Object.fromEntries(
        themeRoles.map((role) => [role, "#808080"]),
      ) as Record<(typeof themeRoles)[number], string>,
    },
  },
  "Flat",
);

test("a role whose every pairing one value can mend is offered that value, and one no value within the bound mends is offered none", () => {
  const ink = themeEditorNearest(flat, "Light", "ink-1");
  expect(ink).toBeDefined();
  const mended = themeEditorContrasts(
    {
      ...flat,
      colours: {
        ...flat.colours,
        Light: { ...flat.colours.Light, "ink-1": ink ?? "" },
      },
    },
    "Light",
  );
  expect(
    mended.filter((contrast) => contrast.role === "ink-1" && !contrast.passes),
  ).toStrictEqual([]);
  expect(themeEditorNearest(flat, "Light", "ink-inverse")).toBeUndefined();
});

test("a ratio is cut to one place, so one just short of its minimum never reads as meeting it", () => {
  expect(themeEditorRatioText(4.4999)).toBe("4.4");
  expect(themeEditorRatioText(4.5)).toBe("4.5");
  expect(themeEditorRatioText(21)).toBe("21.0");
});
