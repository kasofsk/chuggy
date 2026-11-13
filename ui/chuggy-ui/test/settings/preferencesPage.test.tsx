/**
 * The Preferences page, mounted: its sections in order, Appearance for every
 * reader, Wording for a site administrator alone, and Chat position only
 * under a project where the viewport divides, a place chosen there kept as
 * the pane's own.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { AccessSiteAbilities } from "../../../../src/contract/accessPlane.ts";
import { PreferencesPage } from "../../app/browser/settings/PreferencesPage.tsx";
import { viewportNarrowEm } from "../../app/browser/shell/viewport.ts";
import { chatPaneStoreKey } from "../../app/core/chatPane.ts";
import { answer, drawnStrict, settled } from "../screenHarness.tsx";
import { viewportAtEm, viewportDeskEm } from "../viewport.ts";
import { siteAbilitiesNone, siteAbilitiesPath } from "./permissionsFixture.tsx";

let routeParams: { readonly tenant: string; readonly project?: string } = {
  tenant: "acme",
};

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => routeParams,
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  localStorage.clear();
  routeParams = { tenant: "acme" };
  vi.unstubAllGlobals();
});

async function preferencesDrawn(
  em: number,
  abilities: AccessSiteAbilities = siteAbilitiesNone,
): Promise<readonly string[]> {
  viewportAtEm(em);
  await drawnStrict(<PreferencesPage />, (request) =>
    request.url === siteAbilitiesPath ? answer(abilities) : answer({}, 404),
  );
  await settled();
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent);
}

test("under a project where the viewport divides a site administrator is drawn Appearance, Wording and Chat position, in that order", async () => {
  routeParams = { tenant: "acme", project: "atlas" };
  expect(
    await preferencesDrawn(viewportDeskEm, {
      ...siteAbilitiesNone,
      administer: true,
    }),
  ).toStrictEqual(["Appearance", "Wording", "Chat position"]);
});

test("a reader who does not administer the site is drawn no Wording", async () => {
  routeParams = { tenant: "acme", project: "atlas" };
  expect(await preferencesDrawn(viewportDeskEm)).toStrictEqual([
    "Appearance",
    "Chat position",
  ]);
});

test("outside every project, and below two columns, the page offers no Chat position", async () => {
  expect(await preferencesDrawn(viewportDeskEm)).toStrictEqual(["Appearance"]);
  cleanup();
  routeParams = { tenant: "acme", project: "atlas" };
  expect(await preferencesDrawn(viewportNarrowEm - 1)).toStrictEqual([
    "Appearance",
  ]);
});

test("a place chosen in Chat position is checked and kept as the pane's", async () => {
  routeParams = { tenant: "acme", project: "atlas" };
  await preferencesDrawn(viewportDeskEm);
  act(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Bottom" }));
  });
  expect(
    screen.getByRole("radio", { name: "Bottom" }).getAttribute("aria-checked"),
  ).toBe("true");
  expect(localStorage.getItem(chatPaneStoreKey)).toContain("Bottom");
});
