/**
 * The footer every page ends on. The landing route builds its own shell markup
 * and never mounts `Shell`, so the two are checked separately rather than
 * trusting one to stand for both.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
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
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  Outlet: () => null,
  useNavigate: () => () => undefined,
  useParams: () => atlas,
  // `routes.tsx` builds the route tree at module scope to reach `Landing`, so
  // the router calls it makes there need a return rather than a ReferenceError.
  createRootRoute: () => ({ addChildren: () => undefined }),
  createRoute: () => ({ addChildren: () => undefined }),
  createRouter: () => undefined,
}));
// jscpd:ignore-end

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Nothing in the inbox phase and nothing open, so the shell asks two routes
 * that both answer empty, the same as an idle project. */
function serving(url: string): Response {
  if (url.includes("/native-actions")) return answer({ actions: [] });
  if (url.includes("/tenants/"))
    return answer({ partition: atlas, sequence: 9, tickets: [] });
  return answer({ projects: [atlas] });
}

function mounted(children: ReactNode): void {
  const api = apiDouble({ operation: { operation: "op-one" }, route: serving });
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

test("the shell drawn around a partition page carries the footer", async () => {
  mounted(<Shell partition={atlas} />);
  await settled();
  expect(screen.getByText("Copyright 2026. Chuggy")).toBeDefined();
});

test("the landing route, which builds its own markup rather than mounting the shell, carries the footer too", async () => {
  mounted(<Landing />);
  await settled();
  expect(screen.getByText("Copyright 2026. Chuggy")).toBeDefined();
});
