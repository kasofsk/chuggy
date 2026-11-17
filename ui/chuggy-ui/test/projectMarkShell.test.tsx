/**
 * A project's mark where the shell names the project: beside the shown
 * project in the switcher's trigger and beside each project in its list, all
 * from the one inventory read, saying nothing beside a drawn name; on a phone,
 * where the trigger draws no text, the mark named for the project; and the
 * tab's icon pointed at the project's while its shell is drawn and put back
 * once it is not, or left alone where the project names none.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { viewportNarrowEm } from "../app/browser/shell/viewport.ts";
import { projectMarkRead } from "./projectMarkFixture.ts";
import { mounted, shellFrameEachCase, styleless } from "./shellFrame.tsx";
import { answer, apiDouble, operationAt, turned } from "./screenHarness.tsx";
import { viewportDeskEm } from "./viewport.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import type * as RouterModule from "@tanstack/react-router";

vi.mock("../app/browser/ports.ts", async (importOriginal) =>
  (await import("./shellRouter.tsx")).portsDouble(
    await importOriginal<typeof BrowserPorts>(),
  ),
);

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { atlas, routerDouble } = await import("./shellRouter.tsx");
  return routerDouble(await importOriginal<typeof RouterModule>(), {
    outlet: () => <h1>Page</h1>,
    params: () => atlas,
  });
});
// jscpd:ignore-end -- the case's own doubles resume here

shellFrameEachCase(() => undefined);

const iconPath = "/api/v1/tenants/acme/projects/atlas/artifacts/icon-1";

const consoleIcons = [
  { type: "image/svg+xml", href: "/chug-icon.svg" },
  { type: "image/png", href: "/chug-icon-32.png" },
];

beforeEach(() => {
  for (const icon of consoleIcons) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = icon.type;
    link.setAttribute("href", icon.href);
    document.head.append(link);
  }
});

afterEach(() => {
  for (const link of document.head.querySelectorAll("link")) link.remove();
});

/** The shell over an inventory of two projects, the shown one naming its
 * icon where `icon` says, and every URL the page asked for. */
async function shellDrawn(em: number, icon = true): Promise<readonly string[]> {
  const asked: string[] = [];
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: (url) => {
      if (url.includes("/threads")) return answer({ threads: [] });
      if (url === iconPath) return answer(projectMarkRead);
      return answer({
        projects: [
          {
            tenant: "acme",
            project: "atlas",
            name: "Atlas",
            ...(icon ? { icon: "icon-1" } : {}),
          },
          { tenant: "acme", project: "hermes", name: "Hermes" },
        ],
      });
    },
  });
  const served = ((url: string, init?: RequestInit) => {
    asked.push(url);
    return api.fetch(url, init);
  }) as typeof fetch;
  await mounted(em, served);
  return asked;
}

function trigger(): HTMLElement {
  const found = document.querySelector(".topbar-project button");
  if (!(found instanceof HTMLElement)) throw new Error("no switcher drawn");
  return found;
}

function iconLinks(): readonly (string | null)[] {
  return [...document.head.querySelectorAll('link[rel="icon"]')].map(
    (link) =>
      `${link.getAttribute("type") ?? ""} ${link.getAttribute("href") ?? ""}`,
  );
}

test("the switcher draws the shown project's icon beside its name, saying nothing of it", async () => {
  await shellDrawn(viewportDeskEm);
  const image = trigger().querySelector(".project-mark img");
  expect(image?.getAttribute("alt")).toBe("");
  expect(trigger().textContent).toContain("Atlas");
  expect(within(trigger()).queryByRole("img")).toBeNull();
  styleless();
});

test("each project in the switcher's list is drawn after its mark, all from one inventory read", async () => {
  const asked = await shellDrawn(viewportDeskEm);
  await turned(() => {
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
  });
  const menu = screen.getByRole("menu");
  const atlasItem = within(menu).getByRole("menuitemradio", {
    name: /Atlas/u,
  });
  const hermesItem = within(menu).getByRole("menuitemradio", {
    name: /Hermes/u,
  });
  expect(
    atlasItem.querySelector(".project-mark img")?.getAttribute("alt"),
  ).toBe("");
  const initial = hermesItem.querySelector(".project-mark");
  expect(initial?.textContent).toBe("H");
  expect(initial?.getAttribute("aria-hidden")).toBe("true");
  expect(asked.filter((url) => url.startsWith("/api/v1/projects"))).toEqual([
    "/api/v1/projects",
  ]);
  styleless();
});

test("on a phone the trigger's mark is named for the project, the name it draws no text of", async () => {
  await shellDrawn(viewportNarrowEm);
  const named = within(trigger()).getByRole("img", { name: "Atlas" });
  expect(named.tagName).toBe("IMG");
  expect(named.closest(".project-mark")?.classList).toContain(
    "project-mark-md",
  );
  styleless();
});

test("on a phone a project with no icon is named by its initial's mark", async () => {
  await shellDrawn(viewportNarrowEm, false);
  const named = within(trigger()).getByRole("img", { name: "Atlas" });
  expect(named.textContent).toBe("A");
});

test("the tab's icon is the project's while its shell is drawn, and the console's own once it is not", async () => {
  await shellDrawn(viewportDeskEm);
  const pointed = `data:${projectMarkRead.mediaType};base64,${projectMarkRead.content}`;
  expect(iconLinks()).toStrictEqual([` ${pointed}`, ` ${pointed}`]);
  cleanup();
  expect(iconLinks()).toStrictEqual(
    consoleIcons.map((icon) => `${icon.type} ${icon.href}`),
  );
});

test("the tab keeps the console's icon in a project that names none", async () => {
  await shellDrawn(viewportDeskEm, false);
  expect(iconLinks()).toStrictEqual(
    consoleIcons.map((icon) => `${icon.type} ${icon.href}`),
  );
});
