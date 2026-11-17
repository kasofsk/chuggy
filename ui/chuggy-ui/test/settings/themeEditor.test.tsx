/**
 * The theme editor opened from Appearance: a new theme starts as a copy of
 * the theme in use and is saved as one of the reader's own without being
 * worn; a pairing that fails keeps Save from being pressed, says which
 * pairing it is, and offers the value that mends it; the preview draws the
 * draft and nothing else changes; Edit is offered only on a theme of the
 * reader's own and writes it whole; and deleting one asks first and leaves
 * the reader on what applies once it is gone.
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  builtInThemes,
  themeRoles,
} from "../../../../src/contract/appearance.ts";
import type {
  ThemeChoice,
  ThemeDocument,
} from "../../../../src/contract/appearance.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { PreferencesPage } from "../../app/browser/settings/PreferencesPage.tsx";
import { ThemeFollowed } from "../../app/browser/ThemeFollowed.tsx";
import { themeColourAssignmentsOf } from "../../app/core/themeTokens.ts";
import {
  answer,
  drawnStrict,
  press,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { SentRequest } from "../screenHarness.tsx";
import { atlas } from "../shellRouter.tsx";
import { viewportAtEm, viewportDeskEm } from "../viewport.ts";
import { siteAbilitiesNone, siteAbilitiesPath } from "./permissionsFixture.tsx";
import type * as RouterModule from "@tanstack/react-router";

vi.mock("@tanstack/react-router", async (importOriginal) =>
  (await import("../shellRouter.tsx")).routerDouble(
    await importOriginal<typeof RouterModule>(),
    {
      outlet: () => null,
      params: () => ({ tenant: atlas.tenant }) as PartitionIdentity,
    },
  ),
);

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
});

const choicePath = "/api/v1/appearance/choice";
const ownedPath = "/api/v1/appearance/themes";
const minePath = `${ownedPath}/7`;

const { harbour } = builtInThemes;
const mine: ThemeDocument = { ...builtInThemes.ember, name: "Mine" };

/** What the server holds for the reader. */
interface Held {
  global: ThemeChoice | undefined;
  themes: { theme: number; document: ThemeDocument }[];
}

function pathOf(request: SentRequest): string {
  return new URL(request.url, "http://console.test").pathname;
}

/** The server's writes as it keeps them: a theme made, written or deleted,
 * the choice naming a deleted one taken with it. */
function editorWritten(held: Held, request: SentRequest): Response {
  const path = pathOf(request);
  if (request.method === "POST" && path === ownedPath) {
    const created = {
      theme: 8,
      document: request.body as ThemeDocument,
    };
    held.themes.push(created);
    return answer(created, 201);
  }
  const theme = held.themes.find(
    (held) => `${ownedPath}/${String(held.theme)}` === path,
  );
  if (theme === undefined) return answer({}, 404);
  if (request.method === "PUT") {
    theme.document = request.body as ThemeDocument;
    return answer(undefined, 204);
  }
  held.themes = held.themes.filter((other) => other !== theme);
  if (held.global?.kind === "Owned" && held.global.theme === theme.theme)
    held.global = undefined;
  return answer(undefined, 204);
}

async function editorDrawn(held: Held): Promise<readonly SentRequest[]> {
  viewportAtEm(viewportDeskEm);
  const drawn = await drawnStrict(
    <>
      <ThemeFollowed />
      <PreferencesPage />
    </>,
    (request) => {
      const path = pathOf(request);
      if (request.method !== "GET") return editorWritten(held, request);
      if (path === siteAbilitiesPath) return answer(siteAbilitiesNone);
      if (path === choicePath)
        return answer(held.global === undefined ? {} : { choice: held.global });
      if (path === ownedPath) return answer({ themes: held.themes });
      const theme = held.themes.find(
        (owned) => `${ownedPath}/${String(owned.theme)}` === path,
      );
      if (theme !== undefined) return answer(theme);
      return answer({}, 404);
    },
  );
  await settled();
  return drawn.sent;
}

function writesOf(sent: readonly SentRequest[]): readonly unknown[] {
  return sent
    .filter((request) => request.method !== "GET")
    .map((request) => [request.method, pathOf(request), request.body]);
}

function editor(): HTMLElement {
  return screen.getByRole("dialog");
}

function field(name: string): HTMLInputElement {
  return within(editor()).getByRole<HTMLInputElement>("textbox", { name });
}

async function typed(name: string, value: string): Promise<void> {
  await turned(() => {
    fireEvent.change(field(name), { target: { value } });
  });
}

function saveButton(): HTMLButtonElement {
  return within(editor()).getByRole<HTMLButtonElement>("button", {
    name: "Save",
  });
}

function checkedTheme(): string | undefined {
  return within(screen.getByRole("radiogroup", { name: "Theme" }))
    .getAllByRole("radio")
    .find((radio) => radio.getAttribute("aria-checked") === "true")
    ?.textContent;
}

function rootAccent(): string {
  return document.documentElement.style.getPropertyValue("--accent");
}

test("a new theme starts as a copy of the theme in use, under a name of its own, and is saved as one of the reader's own without being worn", async () => {
  const held: Held = {
    global: { kind: "BuiltIn", theme: "harbour" },
    themes: [],
  };
  const sent = await editorDrawn(held);
  const worn = rootAccent();
  expect(screen.queryByRole("button", { name: /^Edit/u })).toBeNull();
  await press("New theme");
  expect(within(editor()).getByRole("heading").textContent).toBe("New theme");
  expect(field("Name").value).toBe("Harbour copy");
  if (harbour.palette.schemes !== "Both")
    throw new Error("Harbour carries both schemes");
  for (const role of ["surface-0", "ink-1", "accent"] as const)
    expect(
      field(
        { "surface-0": "Page", "ink-1": "Main text", accent: "Accent" }[role],
      ).value,
    ).toBe(harbour.palette.light[role]);
  await typed("Name", "Mine too");
  await press("Save");
  expect(writesOf(sent)).toStrictEqual([
    ["POST", ownedPath, { ...harbour, name: "Mine too" }],
  ]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    within(screen.getByRole("radiogroup", { name: "Theme" }))
      .getAllByRole("radio")
      .map((radio) => radio.textContent),
  ).toContain("Mine too");
  expect(checkedTheme()).toBe("Harbour");
  expect(rootAccent()).toBe(worn);
});

test("a pairing that fails keeps Save from being pressed, says which pairing and scheme it is, and the value it offers mends it", async () => {
  const sent = await editorDrawn({ global: undefined, themes: [] });
  await press("New theme");
  expect(saveButton().disabled).toBe(false);
  const accent = field("Accent").value;
  await typed("Text on accent", accent);
  expect(saveButton().disabled).toBe(true);
  const faults = within(editor()).getByText(
    "Not saved until every pairing passes:",
  ).parentElement;
  expect(faults).not.toBeNull();
  const fault = within(faults ?? editor());
  expect(fault.getByText("Text on accent, Light")).toBeDefined();
  expect(fault.getByText("Text on accent on Accent")).toBeDefined();
  expect(fault.getByText("Needs 4.5:1")).toBeDefined();
  const offer = fault.getByRole("button", { name: /^Use #[0-9a-f]{6}$/u });
  const offered = offer.textContent.slice("Use ".length);
  await turned(() => {
    fireEvent.click(offer);
  });
  expect(field("Text on accent").value).toBe(offered);
  expect(
    within(editor()).queryByText("Not saved until every pairing passes:"),
  ).toBeNull();
  expect(saveButton().disabled).toBe(false);
  expect(writesOf(sent)).toStrictEqual([]);
});

test("a colour that does not read as one is said under its field and keeps Save from being pressed", async () => {
  await editorDrawn({ global: undefined, themes: [] });
  await press("New theme");
  await typed("Page", "url(x)");
  expect(field("Page").getAttribute("aria-invalid")).toBe("true");
  expect(within(editor()).getByText("Six hex digits after a #")).toBeDefined();
  expect(saveButton().disabled).toBe(true);
});

test("the preview is drawn in the draft and nothing outside it changes until a theme is saved and chosen", async () => {
  await editorDrawn({
    global: { kind: "BuiltIn", theme: "harbour" },
    themes: [],
  });
  const root = document.documentElement.getAttribute("style");
  await press("New theme");
  await typed("Accent", "#aa3300");
  const preview = within(editor()).getByRole("region", { name: "Preview" });
  const sample = preview.querySelector(".theme-preview");
  if (!(sample instanceof HTMLElement)) throw new Error("no sample drawn");
  expect(sample.style.getPropertyValue("--accent")).toBe("#aa3300");
  expect(sample.getAttribute("data-scheme")).toBe("light");
  expect(document.documentElement.getAttribute("style")).toBe(root);
  await turned(() => {
    fireEvent.click(within(editor()).getByRole("radio", { name: "Dark" }));
  });
  expect(sample.getAttribute("data-scheme")).toBe("dark");
  if (harbour.palette.schemes !== "Both")
    throw new Error("Harbour carries both schemes");
  expect(sample.style.getPropertyValue("--accent")).toBe(
    harbour.palette.dark.accent,
  );
  expect(field("Accent").value).toBe(harbour.palette.dark.accent);
  expect(document.documentElement.getAttribute("style")).toBe(root);
});

test("every token the sample draws is the draft's, the retired tone the sheet takes from the quiet text among them", async () => {
  await editorDrawn({ global: undefined, themes: [] });
  await press("New theme");
  await turned(() => {
    fireEvent.click(
      within(editor()).getByRole("button", { name: "More colours" }),
    );
  });
  await typed("Quiet text", "#445566");
  const sample = within(editor())
    .getByRole("region", { name: "Preview" })
    .querySelector(".theme-preview");
  if (!(sample instanceof HTMLElement)) throw new Error("no sample drawn");
  expect(sample.style.getPropertyValue("--ink-3")).toBe("#445566");
  expect(sample.style.getPropertyValue("--tone-retired")).toBe("#445566");
});

test("every role is a field, the lead ones shown and the rest under one disclosure", async () => {
  await editorDrawn({ global: undefined, themes: [] });
  await press("New theme");
  const shown = (): number =>
    within(editor()).getAllByLabelText(/^Pick /u).length;
  expect(shown()).toBe(5);
  await turned(() => {
    fireEvent.click(
      within(editor()).getByRole("button", { name: "More colours" }),
    );
  });
  expect(shown()).toBe(themeRoles.length);
});

test("Edit is offered on the reader's own theme in use, starts from it as kept, and writes it whole once it differs", async () => {
  const held: Held = {
    global: { kind: "Owned", theme: 7 },
    themes: [{ theme: 7, document: mine }],
  };
  const sent = await editorDrawn(held);
  await press("Edit Mine");
  expect(within(editor()).getByRole("heading").textContent).toBe("Edit Mine");
  expect(field("Name").value).toBe("Mine");
  expect(saveButton().disabled).toBe(true);
  await typed("Name", "Mine, warmer");
  await press("Save");
  expect(writesOf(sent)).toStrictEqual([
    ["PUT", minePath, { ...mine, name: "Mine, warmer" }],
  ]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(checkedTheme()).toBe("Mine, warmer");
});

test("deleting the reader's own theme in use asks first, and once it lands the reader is on the theme that applies without it", async () => {
  const held: Held = {
    global: { kind: "Owned", theme: 7 },
    themes: [{ theme: 7, document: mine }],
  };
  const sent = await editorDrawn(held);
  const mineAccent = themeColourAssignmentsOf(mine).find(
    ({ property }) => property === "--accent",
  )?.value;
  expect(rootAccent()).toBe(mineAccent);
  expect(checkedTheme()).toBe("Mine");
  await press("Edit Mine");
  await press("Delete");
  expect(writesOf(sent)).toStrictEqual([]);
  const asked = screen.getByRole("dialog", { name: "Delete Mine?" });
  await turned(() => {
    fireEvent.click(within(asked).getByRole("button", { name: "Delete" }));
  });
  await settled();
  expect(writesOf(sent)).toStrictEqual([["DELETE", minePath, undefined]]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(checkedTheme()).toBe("Chuggy");
  expect(rootAccent()).toBe("");
  expect(screen.queryByRole("radio", { name: "Mine" })).toBeNull();
});
