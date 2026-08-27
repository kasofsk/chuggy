/**
 * The shell drawn around every screen: the footer is fixed text, present no
 * matter what partition or route it is mounted under.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { Shell } from "../app/browser/Shell.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
} from "./screenHarness.tsx";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  Outlet: () => null,
  useNavigate: () => () => undefined,
  useParams: () => atlas,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the shell's footer carries the copyright line", () => {
  const api = apiDouble({
    operation: undefined,
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
      <Shell partition={atlas} />
    </ScreenHarness>,
  );
  expect(screen.getByText("Copyright 2026. Chuggy")).toBeDefined();
});
