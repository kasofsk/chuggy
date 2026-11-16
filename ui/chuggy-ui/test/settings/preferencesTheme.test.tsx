/**
 * The theme controls of the Appearance section: the global picker everywhere,
 * a radio group of the built-ins and then the reader's own, a choice worn and
 * marked before its write answers; the project's row only inside a project,
 * saying which layer applies, with the override set and cleared; the note
 * under the global picker where the project's default covers it; the arrows
 * moving the choice; and a refused write putting the picker and the page back
 * and saying why.
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { builtInThemes } from "../../../../src/contract/appearance.ts";
import type {
  ThemeChoice,
  ThemeDocument,
} from "../../../../src/contract/appearance.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ProjectAppearanceResponse } from "../../../../src/contract/responses.ts";
import { PreferencesPage } from "../../app/browser/settings/PreferencesPage.tsx";
import { ThemeFollowed } from "../../app/browser/ThemeFollowed.tsx";
import { themeColourAssignmentsOf } from "../../app/core/themeTokens.ts";
import {
  answer,
  drawnStrict,
  heldAnswer,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { SentRequest } from "../screenHarness.tsx";
import { atlas } from "../shellRouter.tsx";
import { viewportAtEm, viewportDeskEm } from "../viewport.ts";
import { siteAbilitiesNone, siteAbilitiesPath } from "./permissionsFixture.tsx";
import type * as RouterModule from "@tanstack/react-router";

let routeParams: PartitionIdentity = atlas;

vi.mock("@tanstack/react-router", async (importOriginal) =>
  (await import("../shellRouter.tsx")).routerDouble(
    await importOriginal<typeof RouterModule>(),
    { outlet: () => null, params: () => routeParams },
  ),
);

afterEach(() => {
  cleanup();
  routeParams = atlas;
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
});

const choicePath = "/api/v1/appearance/choice";
const ownedPath = "/api/v1/appearance/themes";
const appearancePath = `/api/v1/tenants/${atlas.tenant}/projects/${atlas.project}/appearance`;
const overridePath = `${appearancePath}/override`;

const mine: ThemeDocument = { ...builtInThemes.ember, name: "Mine" };

/** What the server holds for the reader, and how a write is answered. */
interface Held {
  global: ThemeChoice | undefined;
  override: ThemeChoice | undefined;
  projectDefault: ThemeDocument | undefined;
}

function documentOf(choice: ThemeChoice): ThemeDocument {
  return choice.kind === "BuiltIn" ? builtInThemes[choice.theme] : mine;
}

/** The server's own resolution, written out layer by layer. */
function appearanceOf(held: Held): ProjectAppearanceResponse {
  const layers = {
    ...(held.override === undefined ? {} : { override: held.override }),
    ...(held.projectDefault === undefined
      ? {}
      : { projectDefault: held.projectDefault }),
    ...(held.global === undefined ? {} : { global: held.global }),
  };
  if (held.override !== undefined)
    return {
      theme: documentOf(held.override),
      layer: "ProjectOverride",
      layers,
    };
  if (held.projectDefault !== undefined)
    return { theme: held.projectDefault, layer: "ProjectDefault", layers };
  if (held.global !== undefined)
    return { theme: documentOf(held.global), layer: "Global", layers };
  return { theme: builtInThemes.chuggy, layer: "BuiltInDefault", layers };
}

async function themeDrawn(
  held: Held,
  written: (request: SentRequest) => Response | Promise<Response> = () =>
    answer(undefined, 204),
): Promise<readonly SentRequest[]> {
  viewportAtEm(viewportDeskEm);
  const drawn = await drawnStrict(
    <>
      <ThemeFollowed />
      <PreferencesPage />
    </>,
    async (request) => {
      const path = new URL(request.url, "http://console.test").pathname;
      if (request.method !== "GET") {
        const response = await written(request);
        if (response.ok) {
          const body = request.body as ThemeChoice | undefined;
          if (path === choicePath) held.global = body;
          if (path === overridePath)
            held.override = request.method === "DELETE" ? undefined : body;
        }
        return response;
      }
      if (path === siteAbilitiesPath) return answer(siteAbilitiesNone);
      if (path === choicePath)
        return answer(held.global === undefined ? {} : { choice: held.global });
      if (path === ownedPath)
        return answer({ themes: [{ theme: 7, document: mine }] });
      if (path === appearancePath) return answer(appearanceOf(held));
      return answer({}, 404);
    },
  );
  await settled();
  return drawn.sent;
}

function group(name: string): HTMLElement {
  return screen.getByRole("radiogroup", { name });
}

function checkedIn(name: string): string | undefined {
  return within(group(name))
    .getAllByRole("radio")
    .find((radio) => radio.getAttribute("aria-checked") === "true")
    ?.textContent;
}

function rootAccent(): string {
  return document.documentElement.style.getPropertyValue("--accent");
}

function accentOf(theme: ThemeDocument): string | undefined {
  return themeColourAssignmentsOf(theme).find(
    ({ property }) => property === "--accent",
  )?.value;
}

function writesOf(sent: readonly SentRequest[]): readonly unknown[] {
  return sent
    .filter((request) => request.method !== "GET")
    .map((request) => [
      request.method,
      new URL(request.url, "http://console.test").pathname,
      request.body,
    ]);
}

test("the global picker offers the built-ins and then the reader's own, a radio each named by its theme, with the built-in default marked where nothing is chosen", async () => {
  routeParams = { tenant: atlas.tenant } as PartitionIdentity;
  await themeDrawn({
    global: undefined,
    override: undefined,
    projectDefault: undefined,
  });
  expect(
    within(group("Theme"))
      .getAllByRole("radio")
      .map((radio) => radio.textContent),
  ).toStrictEqual(["Chuggy", "Harbour", "Ember", "High contrast", "Mine"]);
  expect(checkedIn("Theme")).toBe("Chuggy");
  expect(screen.queryByRole("radiogroup", { name: "In this project" })).toBe(
    null,
  );
});

test("a theme chosen is marked and worn before its write answers, and is the reader's global choice once it does", async () => {
  routeParams = { tenant: atlas.tenant } as PartitionIdentity;
  const held = heldAnswer();
  const sent = await themeDrawn(
    { global: undefined, override: undefined, projectDefault: undefined },
    () => held.answered,
  );
  expect(rootAccent()).toBe("");
  await turned(() => {
    fireEvent.click(
      within(group("Theme")).getByRole("radio", { name: "Mine" }),
    );
  });
  expect(checkedIn("Theme")).toBe("Mine");
  expect(rootAccent()).toBe(accentOf(mine));
  expect(writesOf(sent)).toStrictEqual([
    ["PUT", choicePath, { kind: "Owned", theme: 7 }],
  ]);
  await turned(() => {
    held.release(answer(undefined, 204));
  });
  await settled();
  expect(checkedIn("Theme")).toBe("Mine");
  expect(rootAccent()).toBe(accentOf(mine));
});

test("in a project the row says which layer applies, in plain words, and the global picker says where the project's default covers it", async () => {
  await themeDrawn({
    global: { kind: "BuiltIn", theme: "harbour" },
    override: undefined,
    projectDefault: builtInThemes.ember,
  });
  const note = screen.getByText(
    "This project shows its own default, Ember, in place of your theme.",
  );
  expect(group("Theme").getAttribute("aria-describedby")).toBe(note.id);
  expect(screen.getByText("Ember, the project's default.")).toBeDefined();
  expect(checkedIn("In this project")).toBe("Use the project's default");
  expect(rootAccent()).toBe(accentOf(builtInThemes.ember));
});

test("an override chosen for the project applies above its default, and the project's default chosen clears it", async () => {
  const sent = await themeDrawn({
    global: undefined,
    override: undefined,
    projectDefault: builtInThemes.ember,
  });
  await turned(() => {
    fireEvent.click(
      within(group("In this project")).getByRole("radio", { name: "Harbour" }),
    );
  });
  await settled();
  expect(checkedIn("In this project")).toBe("Harbour");
  expect(
    screen.getByText("Harbour, your choice for this project."),
  ).toBeDefined();
  expect(screen.queryByText(/in place of your theme/u)).toBeNull();
  expect(rootAccent()).toBe(accentOf(builtInThemes.harbour));
  await turned(() => {
    fireEvent.click(
      within(group("In this project")).getByRole("radio", {
        name: "Use the project's default",
      }),
    );
  });
  await settled();
  expect(checkedIn("In this project")).toBe("Use the project's default");
  expect(screen.getByText("Ember, the project's default.")).toBeDefined();
  expect(rootAccent()).toBe(accentOf(builtInThemes.ember));
  expect(writesOf(sent)).toStrictEqual([
    ["PUT", overridePath, { kind: "BuiltIn", theme: "harbour" }],
    ["DELETE", overridePath, undefined],
  ]);
});

test("with no higher layer the row says the reader's own theme applies, and a global choice changes it", async () => {
  await themeDrawn({
    global: { kind: "BuiltIn", theme: "harbour" },
    override: undefined,
    projectDefault: undefined,
  });
  expect(screen.getByText("Harbour, your own theme.")).toBeDefined();
  await turned(() => {
    fireEvent.click(
      within(group("Theme")).getByRole("radio", { name: "High contrast" }),
    );
  });
  expect(screen.getByText("High contrast, your own theme.")).toBeDefined();
  expect(rootAccent()).toBe(accentOf(builtInThemes["high-contrast"]));
});

test("the arrows move the choice from card to card, each move a choice made, and the group is one tab stop", async () => {
  routeParams = { tenant: atlas.tenant } as PartitionIdentity;
  const sent = await themeDrawn({
    global: undefined,
    override: undefined,
    projectDefault: undefined,
  });
  const chuggy = within(group("Theme")).getByRole("radio", { name: "Chuggy" });
  await turned(() => {
    chuggy.focus();
    fireEvent.keyDown(chuggy, { key: "ArrowRight" });
  });
  await settled();
  expect(document.activeElement?.textContent).toBe("Harbour");
  expect(checkedIn("Theme")).toBe("Harbour");
  expect(
    within(group("Theme"))
      .getAllByRole("radio")
      .filter((radio) => radio.tabIndex === 0)
      .map((radio) => radio.textContent),
  ).toStrictEqual(["Harbour"]);
  expect(writesOf(sent)).toStrictEqual([
    ["PUT", choicePath, { kind: "BuiltIn", theme: "harbour" }],
  ]);
});

test("a refused write puts the picker and the page back and says why", async () => {
  routeParams = { tenant: atlas.tenant } as PartitionIdentity;
  const held = heldAnswer();
  await themeDrawn(
    {
      global: { kind: "BuiltIn", theme: "ember" },
      override: undefined,
      projectDefault: undefined,
    },
    () => held.answered,
  );
  expect(rootAccent()).toBe(accentOf(builtInThemes.ember));
  await turned(() => {
    fireEvent.click(
      within(group("Theme")).getByRole("radio", { name: "Harbour" }),
    );
  });
  expect(checkedIn("Theme")).toBe("Harbour");
  await turned(() => {
    held.release(
      answer(
        {
          error: {
            code: "ThemeNotFound",
            message: "The choice names no theme the caller owns.",
          },
        },
        422,
      ),
    );
  });
  await settled();
  expect(checkedIn("Theme")).toBe("Ember");
  expect(rootAccent()).toBe(accentOf(builtInThemes.ember));
  expect(document.querySelector(".notice")?.textContent).toBe(
    "Theme not saved · that theme is no longer one of yours",
  );
});
