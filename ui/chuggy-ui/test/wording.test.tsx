/**
 * The wording: the pseudo wording over the base language, what is stored, and
 * the control in the shell that sets it for a site administrator alone.
 *
 * The control lives behind the bar's gear, and choosing closes the menu, so a
 * second reading mounts the provider again, which is also what a reload does.
 */

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { AccessSiteAbilities } from "../../../src/contract/accessPlane.ts";
import { SettingsMenu } from "../app/browser/shell/SettingsMenu.tsx";
import {
  WordingProvider,
  wordingRead,
  wordingStoreKey,
} from "../app/browser/wording.tsx";
import { copyCatalogEn, copyTextEn } from "../app/copy/catalog.ts";
import { copyTextOf } from "../app/copy/copyBundle.ts";
import { copyPseudoBundleOf, copyPseudoText } from "../app/copy/copyPseudo.ts";
import { useCopyText } from "../app/copy/CopyProvider.tsx";
import type { CopyVernaculars } from "../app/copy/copyWordings.ts";
import type { KeyValuePort } from "../app/core/sessionHolder.ts";
import { answer, drawnStrict, settled } from "./screenHarness.tsx";
import {
  siteAbilitiesNone,
  siteAbilitiesPath,
} from "./settings/permissionsFixture.tsx";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  Outlet: () => null,
  useNavigate: () => () => undefined,
  useParams: () => ({}),
  useRouterState: () => "/",
}));

/** A vernacular that calls a ticket a job, and nothing else. */
const jobs: CopyVernaculars = {
  "en-x-jobs": [
    `-tickets = { $case ->
    [upper] Jobs
   *[lower] jobs
}
`,
  ],
};

function storeDouble(held: Record<string, string>): KeyValuePort {
  return {
    read: (key) => held[key] ?? null,
    write: (key, value) => {
      held[key] = value;
    },
    remove: (key) => {
      delete held[key];
    },
  };
}

afterEach(() => {
  cleanup();
  document.documentElement.setAttribute("lang", "en");
  vi.unstubAllGlobals();
});

test("pseudo alters every word of a catalogued message and leaves its variables as they are", () => {
  const pseudo = copyTextOf(copyPseudoBundleOf(copyCatalogEn));
  const said = pseudo({ id: "shell-inbox-unread", args: { count: 37 } });
  const plain = copyTextEn({ id: "shell-inbox-unread", args: { count: 37 } });
  expect(said).toMatch(/^\[.*\]$/u);
  expect(said).toContain("37");
  expect(said.replace("37", "")).not.toMatch(/[A-Za-z]/u);
  expect(said.length).toBeGreaterThan(plain.length + 2);
  expect(
    pseudo({ id: "shell-settings-wording-vernacular", args: { name: "Jobs" } }),
  ).toBe("[Jobs]");
});

test("pseudo keeps a word's breaks and punctuation where they were", () => {
  expect(copyPseudoText("New project, 3 left")).toBe("Ƞḗḗẇ ƥřǿǿĵḗḗƈŧ, 3 ŀḗḗƒŧ");
});

test("a stored word the catalog does not hold is read as the base language", () => {
  const wordings = ["en", "en-x-pseudo"];
  expect(wordingRead(storeDouble({}), wordings)).toBe("en");
  expect(
    wordingRead(storeDouble({ [wordingStoreKey]: "en-x-gone" }), wordings),
  ).toBe("en");
  expect(
    wordingRead(storeDouble({ [wordingStoreKey]: "en-x-pseudo" }), wordings),
  ).toBe("en-x-pseudo");
});

function WordingSample(): ReactNode {
  const text = useCopyText();
  return <p data-testid="sample">{text({ id: "shell-nav-tickets" })}</p>;
}

async function wordingMenuOpened(
  store: KeyValuePort,
  abilities: AccessSiteAbilities,
): Promise<void> {
  cleanup();
  viewportAtEm(viewportDeskEm);
  await drawnStrict(
    <WordingProvider
      store={store}
      root={document.documentElement}
      vernaculars={jobs}
    >
      <WordingSample />
      <SettingsMenu partition={undefined} tenant="acme" />
    </WordingProvider>,
    (request) =>
      request.url === siteAbilitiesPath ? answer(abilities) : answer({}, 404),
  );
  fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowDown" });
  await screen.findAllByRole("menuitemradio");
  await settled();
}

function wordingOffered(): readonly string[] {
  const label = screen.queryByText(/Wording/u);
  if (label === null) return [];
  return screen
    .getAllByRole("menuitemradio")
    .map((item) => item.textContent)
    .filter((name) => !["System", "Light", "Dark"].includes(name));
}

test("the wording is offered to a site administrator and to nobody else", async () => {
  await wordingMenuOpened(storeDouble({}), siteAbilitiesNone);
  expect(wordingOffered()).toStrictEqual([]);

  await wordingMenuOpened(storeDouble({}), {
    ...siteAbilitiesNone,
    administer: true,
  });
  expect(wordingOffered()).toStrictEqual(["Standard", "Pseudo", "Jobs"]);
});

test("a wording chosen is drawn at once, says the document's language, and survives a reload", async () => {
  const held: Record<string, string> = {};
  const administrator = { ...siteAbilitiesNone, administer: true };
  await wordingMenuOpened(storeDouble(held), administrator);
  expect(screen.getByTestId("sample").textContent).toBe("Tickets");

  act(() => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Jobs" }));
  });
  expect(screen.getByTestId("sample").textContent).toBe("Jobs");
  expect(document.documentElement.getAttribute("lang")).toBe("en-x-jobs");
  expect(held[wordingStoreKey]).toBe("en-x-jobs");

  await wordingMenuOpened(storeDouble(held), administrator);
  expect(screen.getByTestId("sample").textContent).toBe("Jobs");
  expect(
    screen
      .getByRole("menuitemradio", { name: "Jobs" })
      .getAttribute("aria-checked"),
  ).toBe("true");

  act(() => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Pseudo" }));
  });
  expect(screen.getByTestId("sample").textContent).toBe("[Ŧīīƈķḗḗŧş]");
  await wordingMenuOpened(storeDouble(held), administrator);
  act(() => {
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "[Şŧȧȧƞḓȧȧřḓ]" }),
    );
  });
  expect(screen.getByTestId("sample").textContent).toBe("Tickets");
  expect(wordingStoreKey in held).toBe(false);
});
