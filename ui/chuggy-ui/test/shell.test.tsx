/**
 * The shell's footer: drawn on every screen it wraps, so a mount with nothing
 * behind the inbox badge is enough to see it — the ticket asked for a text
 * that appears on every page, not a shell-specific one.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { Shell } from "../app/browser/Shell.tsx";
import { answer, apiDouble, openedStream, ScreenHarness, settled } from "./screenHarness.tsx";
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
// jscpd:ignore-end

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the shell draws the copyright footer beneath the body", async () => {
  const api = apiDouble({
    operation: { operation: "op-one", acceptedAt: "2026-08-26T10:00:00Z", state: "Pending" },
    route: (url) => {
      if (url.includes("/native-actions")) return answer({ actions: [] });
      if (url.includes("/executions")) return answer({ executions: [] });
      if (url.includes("/tenants/"))
        return answer({ partition: atlas, sequence: 9, tickets: [] });
      return answer({ projects: [atlas] });
    },
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
  await settled();

  expect(screen.getByText("Copyright 2026. Chuggy").tagName).toBe("FOOTER");
});
