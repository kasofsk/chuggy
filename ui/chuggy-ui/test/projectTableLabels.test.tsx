// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ProjectTable } from "../app/browser/ProjectTable.tsx";
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
  useParams: () => atlas,
}));
// jscpd:ignore-end

/**
 * The columns of the project table that draw a label, on what
 * `projectTableRows.ts` cannot say about the markup: that the full value is
 * on the cell's own `title` attribute, and that the cell still clips.
 *
 * Both are properties of the markup and of nothing else. A `title` attribute
 * dropped at a call site loses the ticket's title or the image with no way
 * back to it, and a `clipped` class dropped lets a long value — a title at its
 * bound, or a full digest reference — take the column apart. Neither shows up
 * in a row's own value, so neither is provable above this tier.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const revision = "repository:cfaca0a0f14ec03845a4e01458ac6c3a56d52a23:chuggy";

const image =
  "registry.chuggy.internal/chuggy/worker@sha256:9949c442a2f0a5cd0f0a5b1c8b6e0a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f";

const title = "Carry the fix all the way through to done";

const ticket = { ticket: 11, phase: "Working", sequence: 7, title };

const execution = {
  execution: "e1",
  ticket: 11,
  task: 1,
  taskKind: "Work",
  cluster: "rig",
  configurationRevision: revision,
  configurationVersion: { name: "chuggy", number: 12 },
  requirementIdentity: "requirement-a",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image,
  },
  requirementDigest: "b".repeat(64),
  requirementSource: "TicketDefault",
  worker: { name: "chuggy-worker", version: "v3" },
  platformDefaultVersion: 1,
  status: "Running",
  retriesSpent: 0,
  registeredAt: "2026-08-26T10:00:00.000Z",
};

/** The table with one running ticket, joined to the execution above. */
async function drawTable(): Promise<void> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/executions"))
        return answer({ executions: [execution] });
      return answer({ partition: atlas, sequence: 8, tickets: [ticket] });
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <ProjectTable />
    </ScreenHarness>,
  );
  await settled();
}

test("the title cell carries the whole title on hover, and keeps clipping it", async () => {
  await drawTable();
  const cell = screen.getByText(title);
  expect(cell.getAttribute("title")).toBe(title);
  expect(cell.className).toContain("clipped");
});

test("the runs-on cell keeps the image reference, and keeps clipping it", async () => {
  await drawTable();
  const cell = screen.getByText("chuggy-worker v3");
  expect(cell.getAttribute("title")).toBe(image);
  expect(cell.className).toContain("clipped");
});
