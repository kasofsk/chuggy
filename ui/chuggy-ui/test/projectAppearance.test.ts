/**
 * What a project's Appearance settings decide alone: which option the default
 * theme's picker marks for the document the project keeps, and when the
 * reader's own theme is offered to update it from; and whether a file is
 * taken for an icon or a banner, and in which words it is refused, before
 * anything is sent and after the server answered.
 */

import { expect, test } from "vitest";

import { builtInThemes } from "../../../src/contract/appearance.ts";
import type { ThemeDocument } from "../../../src/contract/appearance.ts";
import {
  projectBannerBytesMax,
  projectIconBytesMax,
} from "../../../src/contract/http.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import type { ApiFailure } from "../app/core/apiRequest.ts";
import {
  projectImageOffered,
  projectImageRefusalOf,
  projectThemeKept,
  projectThemeNone,
  projectThemeSettingsOf,
  projectThemesSame,
} from "../app/core/projectAppearance.ts";
import { themePickerOptions } from "../app/core/themePreferences.ts";

const mine: ThemeDocument = { ...builtInThemes.ember, name: "Mine" };

const options = themePickerOptions([
  { theme: 7, document: mine },
  { theme: 8, document: { ...builtInThemes.harbour, name: "Other" } },
]);

test("a project keeping no theme marks None and offers nothing", () => {
  expect(projectThemeSettingsOf(undefined, options)).toStrictEqual({
    chosen: projectThemeNone,
    kept: undefined,
    drifted: undefined,
  });
});

test("a kept document is marked as the option holding the same values, however its keys are ordered", () => {
  const reordered = Object.fromEntries(
    Object.entries(builtInThemes.harbour).reverse(),
  ) as ThemeDocument;
  expect(projectThemesSame(reordered, builtInThemes.harbour)).toBe(true);
  expect(projectThemeSettingsOf(reordered, options)).toStrictEqual({
    chosen: "built-in:harbour",
    kept: undefined,
    drifted: undefined,
  });
});

test("a kept copy of the reader's theme that has since changed is a card of its own, and that theme is the one offered", () => {
  const kept: ThemeDocument = { ...mine, font: "Serif" };
  const settings = projectThemeSettingsOf(kept, options);
  expect(settings.chosen).toBe(projectThemeKept);
  expect(settings.kept).toBe(kept);
  expect(settings.drifted?.key).toBe("owned:7");
});

test("a kept document no option is and no theme of the reader's is named after is a card of its own and offers nothing", () => {
  const kept: ThemeDocument = { ...builtInThemes.chuggy, name: "Theirs" };
  expect(projectThemeSettingsOf(kept, options)).toStrictEqual({
    chosen: projectThemeKept,
    kept,
    drifted: undefined,
  });
});

test("a kept document named after two themes of the reader's offers neither, since it cannot say which it came from", () => {
  const twice = themePickerOptions([
    { theme: 7, document: mine },
    { theme: 9, document: { ...mine, textSize: "Small" } },
  ]);
  expect(
    projectThemeSettingsOf({ ...mine, font: "Serif" }, twice).drifted,
  ).toBeUndefined();
});

test("a file is taken up to its role's bound in one of the types the roles take, and refused past it or in any other", () => {
  expect(
    projectImageOffered("icon", {
      type: "image/png",
      size: projectIconBytesMax,
    }),
  ).toStrictEqual({ kind: "Taken", mediaType: "image/png" });
  expect(
    projectImageOffered("banner", {
      type: "image/jpeg",
      size: projectBannerBytesMax,
    }),
  ).toStrictEqual({ kind: "Taken", mediaType: "image/jpeg" });
  const said = (offer: ReturnType<typeof projectImageOffered>): string =>
    offer.kind === "Refused" ? copyTextEn(offer.refused) : "taken";
  expect(
    said(
      projectImageOffered("icon", {
        type: "image/png",
        size: projectIconBytesMax + 1,
      }),
    ),
  ).toBe("Not saved: the file is larger than 256 KiB.");
  expect(
    said(
      projectImageOffered("banner", {
        type: "image/webp",
        size: projectBannerBytesMax + 1,
      }),
    ),
  ).toBe("Not saved: the file is larger than 2 MiB.");
  for (const type of ["image/gif", "image/svg+xml", ""])
    expect(said(projectImageOffered("icon", { type, size: 1 }))).toBe(
      "Not saved: only PNG, JPEG, WEBP can be used.",
    );
});

function rejected(code: string): ApiFailure {
  return { outcome: "Rejected", code, status: 422, body: {} };
}

test("the server's refusal of a type or a size is said as the page says it, and any other in the words every refusal is", () => {
  const said = (code: string): string =>
    copyTextEn(projectImageRefusalOf("banner", rejected(code)));
  expect(said("ImageTypeNotAdmitted")).toBe(
    "Not saved: only PNG, JPEG, WEBP can be used.",
  );
  expect(said("UnsupportedMediaType")).toBe(
    "Not saved: only PNG, JPEG, WEBP can be used.",
  );
  expect(said("ImageTooLarge")).toBe(
    "Not saved: the file is larger than 2 MiB.",
  );
  expect(said("ArtifactTooLarge")).toBe(
    "Not saved: the file is larger than 2 MiB.",
  );
  expect(said("ImageNotFound")).toBe("Not saved · Refused");
});
