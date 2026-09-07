/**
 * The frame: the rail beside the page or behind a menu, the bar a page fills,
 * the details beside the page or instead of it, and the slot under it.
 *
 * Every case counts `<style>` elements, because the served policy refuses one
 * and the drawer is the console's first modal-shaped control: a primitive that
 * appends a sheet passes every other assertion here and is refused by the
 * browser.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { Shell } from "../app/browser/Shell.tsx";
import {
  BottomSlot,
  DetailsSlot,
  TopBarSlot,
} from "../app/browser/shell/slots.tsx";
import {
  viewportDeskEm,
  viewportTwoColumnEm,
} from "../app/browser/shell/viewport.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { viewportAtEm } from "./viewport.ts";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import type * as RouterModule from "@tanstack/react-router";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };
const borealis: PartitionIdentity = { tenant: "acme", project: "borealis" };

let pageDrawn: () => ReactNode = () => null;

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  Link: (props: {
    readonly children?: ReactNode;
    readonly onClick?: () => void;
  }) => (
    <a href="/" onClick={props.onClick}>
      {props.children}
    </a>
  ),
  Outlet: () => pageDrawn(),
  useNavigate: () => () => undefined,
  useParams: () => atlas,
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
});

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  pageDrawn = () => null;
  vi.unstubAllGlobals();
});

function sheetsDrawn(): number {
  return document.querySelectorAll("style").length;
}

async function mounted(em: number): Promise<void> {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: () => answer({ projects: [atlas] }),
  });
  viewportAtEm(em);
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <Shell partition={atlas} />
    </ScreenHarness>,
  );
  await settled();
}

function railDrawn(): HTMLElement | null {
  return screen.queryByRole("navigation", { name: "Console" });
}

/** The drawer, open under the two-column width, with a second project on
 * offer so a case can switch. */
async function mountedDrawer(): Promise<void> {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: () => answer({ projects: [atlas, borealis] }),
  });
  viewportAtEm(viewportTwoColumnEm - 1);
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <Shell partition={atlas} />
    </ScreenHarness>,
  );
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Menu" }).click();
  });
  await settled();
}

test("the rail sits beside the page at the two-column width", async () => {
  await mounted(viewportTwoColumnEm);
  expect(railDrawn()).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
  expect(sheetsDrawn()).toBe(0);
});

test("under it the rail is a drawer the menu opens, and no sheet is appended", async () => {
  await mounted(viewportTwoColumnEm - 1);
  expect(railDrawn()).toBeNull();
  expect(sheetsDrawn()).toBe(0);
  await turned(() => {
    screen.getByRole("button", { name: "Menu" }).click();
  });
  await settled();
  expect(railDrawn()).not.toBeNull();
  expect(sheetsDrawn()).toBe(0);
});

test("a page's own bar content replaces the frame's title", async () => {
  pageDrawn = () => (
    <TopBarSlot>
      <span>ticket 44</span>
    </TopBarSlot>
  );
  await mounted(viewportDeskEm);
  expect(screen.getByText("ticket 44")).toBeDefined();
  expect(screen.queryByRole("heading", { name: "acme / atlas" })).toBeNull();
});

test("a page that hands the shell no details gets no toggle", async () => {
  pageDrawn = () => <p>page</p>;
  await mounted(viewportDeskEm);
  expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  expect(screen.getByRole("heading", { name: "acme / atlas" })).toBeDefined();
});

test("at the desk width the details open beside the page", async () => {
  pageDrawn = () => (
    <>
      <p>page</p>
      <DetailsSlot openFirst>
        <p>aside</p>
      </DetailsSlot>
    </>
  );
  await mounted(viewportDeskEm);
  expect(screen.getByText("page")).toBeDefined();
  expect(screen.getByText("aside")).toBeDefined();
  await turned(() => {
    screen.getByRole("button", { name: "Details" }).click();
  });
  await settled();
  expect(screen.queryByText("aside")).toBeNull();
  expect(screen.getByText("page")).toBeDefined();
});

test("under the desk width the details take the middle from the page", async () => {
  pageDrawn = () => (
    <>
      <p>page</p>
      <DetailsSlot>
        <p>aside</p>
      </DetailsSlot>
    </>
  );
  await mounted(viewportDeskEm - 1);
  expect(screen.getByText("page")).toBeDefined();
  await turned(() => {
    screen.getByRole("button", { name: "Details" }).click();
  });
  await settled();
  expect(screen.getByText("aside")).toBeDefined();
  expect(screen.getByText("page").closest("[hidden]")).not.toBeNull();
});

test("the bottom slot draws under the page", async () => {
  pageDrawn = () => (
    <BottomSlot>
      <p>composer</p>
    </BottomSlot>
  );
  await mounted(viewportDeskEm);
  expect(screen.getByText("composer")).toBeDefined();
});

test("the drawer closes when its own project switcher navigates", async () => {
  await mountedDrawer();
  expect(railDrawn()).not.toBeNull();
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: /^Project /u }), {
      key: "ArrowDown",
    });
  });
  await screen.findByRole("menu");
  await turned(() => {
    screen.getByRole("menuitemradio", { name: "acme / borealis" }).click();
  });
  await settled();
  expect(railDrawn()).toBeNull();
});

test("the drawer closes when a rail entry is followed", async () => {
  await mountedDrawer();
  expect(railDrawn()).not.toBeNull();
  await turned(() => {
    screen.getByRole("link", { name: "Overview" }).click();
  });
  await settled();
  expect(railDrawn()).toBeNull();
});
