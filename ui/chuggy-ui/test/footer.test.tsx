/**
 * The footer: at the foot of a page outside every project, under its bar rather
 * than among the bar's controls, and nowhere in the shell around a project.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { Landing } from "../app/browser/routes.tsx";
import { Shell } from "../app/browser/Shell.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { viewportAtEm } from "./viewport.ts";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import type * as RouterModule from "@tanstack/react-router";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  Outlet: () => null,
  useNavigate: () => () => undefined,
  useParams: () => atlas,
  useRouterState: (options: {
    readonly select: (state: {
      readonly location: { readonly pathname: string };
    }) => unknown;
  }) => options.select({ location: { pathname: "/acme/atlas" } }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const footerText = "Copyright 2026. Chuggy";

function mount(children: ReactNode): void {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: () => answer({ projects: [atlas] }),
  });
  viewportAtEm(viewportDeskEm);
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      {children}
    </ScreenHarness>,
  );
}

test("the shell around a project draws no footer, in its bar or anywhere", async () => {
  mount(<Shell partition={atlas} />);
  await settled();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
  expect(screen.queryByText(footerText)).toBeNull();
});

test("the landing ends on the footer, outside the bar", async () => {
  mount(<Landing />);
  await settled();
  const footer = screen.getByRole("contentinfo");
  expect(footer.textContent).toBe(footerText);
  expect(footer.closest("header")).toBeNull();
  expect(
    screen.getByRole("main").compareDocumentPosition(footer) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
