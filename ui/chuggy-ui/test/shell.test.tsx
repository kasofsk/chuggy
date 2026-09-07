/**
 * The frame: the rail beside the page or behind a menu, the bar a page fills,
 * the details beside the page or instead of it, and the slot under it.
 *
 * Every case ends by asserting `styleless()`, because the served policy
 * refuses a `<style>` element and the drawer is the console's first
 * modal-shaped control: a primitive that appends a sheet passes every other
 * assertion here and is refused by the browser.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { Shell } from "../app/browser/Shell.tsx";
import { DetailsSlot, TopBarSlot } from "../app/browser/shell/slots.tsx";
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

function styleless(): void {
  expect(document.querySelectorAll("style")).toHaveLength(0);
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
  styleless();
});

test("under it the rail is a drawer the menu opens, and no sheet is appended", async () => {
  await mounted(viewportTwoColumnEm - 1);
  expect(railDrawn()).toBeNull();
  styleless();
  await turned(() => {
    screen.getByRole("button", { name: "Menu" }).click();
  });
  await settled();
  expect(railDrawn()).not.toBeNull();
  styleless();
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
  styleless();
});

test("a page that hands the shell no details gets no toggle", async () => {
  pageDrawn = () => <p>page</p>;
  await mounted(viewportDeskEm);
  expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  expect(screen.getByRole("heading", { name: "acme / atlas" })).toBeDefined();
  styleless();
});

/** A page's own middle row pins a composer to its foot with `flex-1`, which
 * needs the wrapper to stretch and claim a height for it — only when the
 * page draws a `role="region"`, so a plain listing keeps its own height and
 * scrolls past its trailing padding instead of losing it. jsdom draws no
 * boxes; this reads the declaration, not the effect. */
test("the page column only stretches its wrapper for a page that fills it", async () => {
  pageDrawn = () => <p>page</p>;
  await mounted(viewportDeskEm);
  const wrapper = screen.getByText("page").parentElement;
  expect(wrapper?.className).toContain("self-start");
  expect(wrapper?.className).toContain("has-[[role=region]]:self-stretch");
  styleless();
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
  styleless();
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
  const hiddenScroller = screen.getByText("page").closest("[hidden]");
  expect(hiddenScroller).not.toBeNull();
  expect(hiddenScroller?.className ?? "").not.toContain("grid");
  styleless();
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
  styleless();
});

test("the drawer closes when a rail entry is followed", async () => {
  await mountedDrawer();
  expect(railDrawn()).not.toBeNull();
  await turned(() => {
    screen.getByRole("link", { name: "Overview" }).click();
  });
  await settled();
  expect(railDrawn()).toBeNull();
  styleless();
});
