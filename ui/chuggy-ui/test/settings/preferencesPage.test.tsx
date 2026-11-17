/**
 * The preferences page: Appearance always, Wording for a site administrator
 * alone, and Chat position in a project where the viewport divides, a titled
 * section each in that order; and the chat pane's placement, chosen on it,
 * applied to the pane the shell holds and kept for the next load; and in
 * Appearance, projects' banners shown or hidden, kept for the next load.
 *
 * In Appearance, the theme controls: the global picker everywhere, a radio
 * group of the built-ins and then the reader's own, a choice worn and marked
 * before its write answers; the project's row only inside a project, saying
 * which layer applies, with the override set and cleared; the note under the
 * global picker where the project's default covers it; the arrows moving the
 * choice; a refused write putting the picker and the page back and saying
 * why; and the last of several presses the one that stays, however their
 * answers arrive, with a press another to the same write replaced before it
 * was sent never sent.
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { AccessSiteAbilities } from "../../../../src/contract/accessPlane.ts";
import { builtInThemes } from "../../../../src/contract/appearance.ts";
import type {
  ThemeChoice,
  ThemeDocument,
} from "../../../../src/contract/appearance.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ProjectAppearanceResponse } from "../../../../src/contract/responses.ts";
import { PreferencesPage } from "../../app/browser/settings/PreferencesPage.tsx";
import { viewportTwoColumnEm } from "../../app/browser/shell/viewport.ts";
import { ThemeFollowed } from "../../app/browser/ThemeFollowed.tsx";
import { projectBannersStoreKey } from "../../app/browser/projectBanners.ts";
import { chatPaneStoreKey } from "../../app/core/chatPane.ts";
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

/** The address's parameters: a project's settings, or a workspace's alone,
 * which names no project however the router's double types it. */
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

async function preferencesDrawn(
  em: number,
  abilities: AccessSiteAbilities = siteAbilitiesNone,
): Promise<void> {
  viewportAtEm(em);
  await drawnStrict(<PreferencesPage />, (request) =>
    request.url === siteAbilitiesPath ? answer(abilities) : answer({}, 404),
  );
  await settled();
}

function sectionsDrawn(): readonly string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent);
}

test("in a project where the viewport divides the page holds Appearance and Chat position, and Wording only for a site administrator", async () => {
  await preferencesDrawn(viewportDeskEm);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Preferences",
  );
  expect(sectionsDrawn()).toStrictEqual(["Appearance", "Chat position"]);
  cleanup();
  await preferencesDrawn(viewportDeskEm, {
    ...siteAbilitiesNone,
    administer: true,
  });
  expect(sectionsDrawn()).toStrictEqual([
    "Appearance",
    "Wording",
    "Chat position",
  ]);
});

test("below two columns the page offers no chat position", async () => {
  await preferencesDrawn(viewportTwoColumnEm - 1);
  expect(sectionsDrawn()).toStrictEqual(["Appearance"]);
  expect(screen.queryByRole("radio", { name: "Left" })).toBeNull();
});

test("in a workspace outside every project, which has no chat pane, the page offers no chat position", async () => {
  routeParams = { tenant: atlas.tenant } as PartitionIdentity;
  await preferencesDrawn(viewportDeskEm);
  expect(sectionsDrawn()).toStrictEqual(["Appearance"]);
});

test("a chat position chosen is checked at once and is the one the next load reads", async () => {
  await preferencesDrawn(viewportDeskEm);
  const group = screen.getByRole("radiogroup", { name: "Chat position" });
  expect(group).toBeDefined();
  expect(
    screen.getByRole("radio", { name: "Right" }).getAttribute("aria-checked"),
  ).toBe("true");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Left" }));
  });
  expect(
    screen.getByRole("radio", { name: "Left" }).getAttribute("aria-checked"),
  ).toBe("true");
  expect(localStorage.getItem(chatPaneStoreKey)).toContain('"Left"');
  cleanup();
  await preferencesDrawn(viewportDeskEm);
  expect(
    screen.getByRole("radio", { name: "Left" }).getAttribute("aria-checked"),
  ).toBe("true");
});

test("Appearance offers projects' banners shown or hidden, shown where nothing is kept, and a choice is the one the next load reads", async () => {
  await preferencesDrawn(viewportDeskEm);
  const appearance = screen.getByRole("region", { name: "Appearance" });
  const banners = within(appearance).getByRole("radiogroup", {
    name: "Project banners",
  });
  expect(
    within(banners).getByRole("radio", { name: "Shown" }).getAttribute(
      "aria-checked",
    ),
  ).toBe("true");
  await turned(() => {
    fireEvent.click(within(banners).getByRole("radio", { name: "Hidden" }));
  });
  expect(localStorage.getItem(projectBannersStoreKey)).toBe("Hidden");
  cleanup();
  await preferencesDrawn(viewportDeskEm);
  expect(
    screen.getByRole("radio", { name: "Hidden" }).getAttribute("aria-checked"),
  ).toBe("true");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Shown" }));
  });
  expect(localStorage.getItem(projectBannersStoreKey)).toBeNull();
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

/** What the project's row says applies, and why, as the group it describes. */
function appliesHere(): readonly string[] {
  const said = document.getElementById(
    group("In this project").getAttribute("aria-describedby") ?? "",
  );
  return [...(said?.children ?? [])].map((part) => part.textContent);
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

const refusedNotFound = (): Response =>
  answer(
    {
      error: {
        code: "ThemeNotFound",
        message: "The choice names no theme the caller owns.",
      },
    },
    422,
  );

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
    "This project shows its own default theme in place of yours.",
  );
  expect(group("Theme").getAttribute("aria-describedby")).toBe(note.id);
  expect(appliesHere()).toStrictEqual(["Ember", "The project's default"]);
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
  expect(appliesHere()).toStrictEqual([
    "Harbour",
    "Your choice for this project",
  ]);
  expect(screen.queryByText(/in place of yours/u)).toBeNull();
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
  expect(appliesHere()).toStrictEqual(["Ember", "The project's default"]);
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
  expect(appliesHere()).toStrictEqual(["Harbour", "Your own theme"]);
  await turned(() => {
    fireEvent.click(
      within(group("Theme")).getByRole("radio", { name: "High contrast" }),
    );
  });
  expect(appliesHere()).toStrictEqual(["High contrast", "Your own theme"]);
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
    held.release(refusedNotFound());
  });
  await settled();
  expect(checkedIn("Theme")).toBe("Ember");
  expect(rootAccent()).toBe(accentOf(builtInThemes.ember));
  expect(document.querySelector(".notice")?.textContent).toBe(
    "Theme not saved · that theme is no longer one of yours",
  );
});

/** Each write answered by the next of `answers`, in the order sent. */
function answeredInTurn(
  answers: readonly Promise<Response>[],
): () => Promise<Response> {
  let sent = 0;
  return async () => {
    const answered = answers[sent];
    sent += 1;
    return answered ?? answer(undefined, 204);
  };
}

test("two presses whose answers are released last first leave the last press chosen, worn and kept", async () => {
  routeParams = { tenant: atlas.tenant } as PartitionIdentity;
  const harbour = heldAnswer();
  const ember = heldAnswer();
  const held: Held = {
    global: undefined,
    override: undefined,
    projectDefault: undefined,
  };
  const sent = await themeDrawn(
    held,
    answeredInTurn([harbour.answered, ember.answered]),
  );
  const chuggy = within(group("Theme")).getByRole("radio", { name: "Chuggy" });
  await turned(() => {
    chuggy.focus();
    fireEvent.keyDown(chuggy, { key: "ArrowRight" });
  });
  await turned(() => {
    fireEvent.keyDown(document.activeElement ?? chuggy, { key: "ArrowRight" });
  });
  expect(checkedIn("Theme")).toBe("Ember");
  expect(rootAccent()).toBe(accentOf(builtInThemes.ember));
  await turned(() => {
    ember.release(answer(undefined, 204));
  });
  await turned(() => {
    harbour.release(answer(undefined, 204));
  });
  await settled();
  expect(writesOf(sent)).toStrictEqual([
    ["PUT", choicePath, { kind: "BuiltIn", theme: "harbour" }],
    ["PUT", choicePath, { kind: "BuiltIn", theme: "ember" }],
  ]);
  expect(held.global).toStrictEqual({ kind: "BuiltIn", theme: "ember" });
  expect(checkedIn("Theme")).toBe("Ember");
  expect(rootAccent()).toBe(accentOf(builtInThemes.ember));
});

/** Harbour pressed and then Ember, outside any project, each write held
 * until its answer is released. */
async function harbourThenEmberPressed(): Promise<{
  readonly harbour: ReturnType<typeof heldAnswer>;
  readonly ember: ReturnType<typeof heldAnswer>;
}> {
  routeParams = { tenant: atlas.tenant } as PartitionIdentity;
  const harbour = heldAnswer();
  const ember = heldAnswer();
  await themeDrawn(
    { global: undefined, override: undefined, projectDefault: undefined },
    answeredInTurn([harbour.answered, ember.answered]),
  );
  await turned(() => {
    fireEvent.click(
      within(group("Theme")).getByRole("radio", { name: "Harbour" }),
    );
  });
  await turned(() => {
    fireEvent.click(
      within(group("Theme")).getByRole("radio", { name: "Ember" }),
    );
  });
  return { harbour, ember };
}

test("an earlier press refused leaves a later one standing", async () => {
  const { harbour, ember } = await harbourThenEmberPressed();
  await turned(() => {
    harbour.release(refusedNotFound());
  });
  expect(checkedIn("Theme")).toBe("Ember");
  expect(rootAccent()).toBe(accentOf(builtInThemes.ember));
  await turned(() => {
    ember.release(answer(undefined, 204));
  });
  await settled();
  expect(checkedIn("Theme")).toBe("Ember");
  expect(rootAccent()).toBe(accentOf(builtInThemes.ember));
});

test("a later press refused puts back the earlier one the server kept", async () => {
  const { harbour, ember } = await harbourThenEmberPressed();
  await turned(() => {
    harbour.release(answer(undefined, 204));
  });
  expect(checkedIn("Theme")).toBe("Ember");
  await turned(() => {
    ember.release(refusedNotFound());
  });
  await settled();
  expect(checkedIn("Theme")).toBe("Harbour");
  expect(rootAccent()).toBe(accentOf(builtInThemes.harbour));
  expect(document.querySelector(".notice")?.textContent).toBe(
    "Theme not saved · that theme is no longer one of yours",
  );
});

test("presses made while a write is in flight send only the last of them once it answers", async () => {
  routeParams = { tenant: atlas.tenant } as PartitionIdentity;
  const harbour = heldAnswer();
  const held: Held = {
    global: undefined,
    override: undefined,
    projectDefault: undefined,
  };
  const sent = await themeDrawn(held, answeredInTurn([harbour.answered]));
  const chuggy = within(group("Theme")).getByRole("radio", { name: "Chuggy" });
  await turned(() => {
    chuggy.focus();
    fireEvent.keyDown(chuggy, { key: "ArrowRight" });
  });
  await turned(() => {
    fireEvent.keyDown(document.activeElement ?? chuggy, { key: "ArrowRight" });
  });
  await turned(() => {
    fireEvent.keyDown(document.activeElement ?? chuggy, { key: "ArrowRight" });
  });
  expect(checkedIn("Theme")).toBe("High contrast");
  await turned(() => {
    harbour.release(answer(undefined, 204));
  });
  await settled();
  expect(writesOf(sent)).toStrictEqual([
    ["PUT", choicePath, { kind: "BuiltIn", theme: "harbour" }],
    ["PUT", choicePath, { kind: "BuiltIn", theme: "high-contrast" }],
  ]);
  expect(held.global).toStrictEqual({
    kind: "BuiltIn",
    theme: "high-contrast",
  });
  expect(checkedIn("Theme")).toBe("High contrast");
  expect(rootAccent()).toBe(accentOf(builtInThemes["high-contrast"]));
});

test("a global choice queued behind a write is sent even when the project row is pressed after it", async () => {
  const harbour = heldAnswer();
  const held: Held = {
    global: undefined,
    override: undefined,
    projectDefault: undefined,
  };
  const sent = await themeDrawn(held, answeredInTurn([harbour.answered]));
  await turned(() => {
    fireEvent.click(
      within(group("In this project")).getByRole("radio", { name: "Harbour" }),
    );
  });
  await turned(() => {
    fireEvent.click(
      within(group("Theme")).getByRole("radio", { name: "Ember" }),
    );
  });
  await turned(() => {
    fireEvent.click(
      within(group("In this project")).getByRole("radio", {
        name: "High contrast",
      }),
    );
  });
  await turned(() => {
    harbour.release(answer(undefined, 204));
  });
  await settled();
  expect(writesOf(sent)).toStrictEqual([
    ["PUT", overridePath, { kind: "BuiltIn", theme: "harbour" }],
    ["PUT", choicePath, { kind: "BuiltIn", theme: "ember" }],
    ["PUT", overridePath, { kind: "BuiltIn", theme: "high-contrast" }],
  ]);
  expect(held.global).toStrictEqual({ kind: "BuiltIn", theme: "ember" });
  expect(checkedIn("Theme")).toBe("Ember");
  expect(checkedIn("In this project")).toBe("High contrast");
});

test("what a refusal puts back is what the server holds, even after an earlier refused press to the other write", async () => {
  const global = heldAnswer();
  const ember = heldAnswer();
  const contrast = heldAnswer();
  const held: Held = {
    global: undefined,
    override: undefined,
    projectDefault: undefined,
  };
  await themeDrawn(
    held,
    answeredInTurn([global.answered, ember.answered, contrast.answered]),
  );
  await turned(() => {
    fireEvent.click(
      within(group("Theme")).getByRole("radio", { name: "Harbour" }),
    );
  });
  await turned(() => {
    fireEvent.click(
      within(group("In this project")).getByRole("radio", { name: "Ember" }),
    );
  });
  await turned(() => {
    global.release(refusedNotFound());
  });
  await turned(() => {
    fireEvent.click(
      within(group("In this project")).getByRole("radio", {
        name: "High contrast",
      }),
    );
  });
  await turned(() => {
    ember.release(answer(undefined, 204));
  });
  await turned(() => {
    contrast.release(refusedNotFound());
  });
  await settled();
  expect(held).toStrictEqual({
    global: undefined,
    override: { kind: "BuiltIn", theme: "ember" },
    projectDefault: undefined,
  });
  expect(checkedIn("Theme")).toBe("Chuggy");
  expect(checkedIn("In this project")).toBe("Ember");
  expect(rootAccent()).toBe(accentOf(builtInThemes.ember));
});
