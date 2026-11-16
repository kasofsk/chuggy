/**
 * The preferences page: Appearance always, Wording for a site administrator
 * alone, and Chat position in a project where the viewport divides, a titled
 * section each in that order; and the chat pane's placement, chosen on it,
 * applied to the pane the shell holds and kept for the next load.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { AccessSiteAbilities } from "../../../../src/contract/accessPlane.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { PreferencesPage } from "../../app/browser/settings/PreferencesPage.tsx";
import { viewportTwoColumnEm } from "../../app/browser/shell/viewport.ts";
import { chatPaneStoreKey } from "../../app/core/chatPane.ts";
import { answer, drawnStrict, settled, turned } from "../screenHarness.tsx";
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
