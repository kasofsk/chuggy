/**
 * The shell every screen is mounted inside carries a footer beneath the body,
 * on every page rather than a fixture chosen per screen — mounting `Shell`
 * alone through the same harness the other shell coverage uses is the
 * regression that the footer stays there.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
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
  operationAt,
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
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The routes a mounted shell reads: nothing open in the inbox and one project
 * for the switcher, so the render settles clean. */
function served(url: string): Response {
  if (url.includes("/native-actions")) return answer({ actions: [] });
  if (url.includes("/executions")) return answer({ executions: [] });
  if (url.includes("/tenants/"))
    return answer({ partition: atlas, sequence: 9, tickets: [] });
  return answer({ projects: [atlas] });
}

test("the shell carries the copyright footer beneath the body", async () => {
  const api = apiDouble({ operation: operationAt("Pending"), route: served });
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
  expect(screen.getByText("Copyright 2026. Chuggy").tagName).toBe("FOOTER");
});
