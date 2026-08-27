/**
 * The footer every page draws, drawn twice in this source: once inside
 * `Shell`, and once again in `Landing`, which builds its own shell markup
 * and never mounts `Shell`. Both are asserted here so a change to either
 * markup is caught rather than only the one under test elsewhere.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { Landing } from "../app/browser/routes.tsx";
import { Shell } from "../app/browser/Shell.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type * as ReactRouter from "@tanstack/react-router";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** `routes.tsx` builds the router at module scope, so the mock keeps the real
 * `createRootRoute`/`createRoute`/`createRouter` and overrides only what a
 * component rendered outside a `RouterProvider` cannot call. */
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  Outlet: () => null,
  useNavigate: () => () => undefined,
}));

/** The runner has no globals, so a case's tree is torn down here rather than by
 * the library's own hook — a second case would otherwise read the first's. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(child: ReactNode): void {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: () => answer({ projects: [atlas] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      {child}
    </ScreenHarness>,
  );
}

test("the shell around a partition page carries the footer", async () => {
  mount(<Shell partition={atlas} />);
  await settled();
  expect(screen.getByText("Copyright 2026. Chuggy")).toBeDefined();
});

test("the landing page, which never mounts Shell, carries the footer too", async () => {
  mount(<Landing />);
  await settled();
  expect(screen.getByText("Copyright 2026. Chuggy")).toBeDefined();
});
