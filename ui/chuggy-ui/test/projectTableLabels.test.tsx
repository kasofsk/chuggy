// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ProjectTable } from "../app/browser/ProjectTable.tsx";
import { cellExecutionUnread } from "../app/browser/TicketCells.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

const fixedNowMs = Date.parse("2026-08-27T03:00:00Z");

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  nowMs: () => fixedNowMs,
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => atlas,
}));
// jscpd:ignore-end

/**
 * The two columns of the project table that draw a long value, on the two
 * things `projectTableRows.ts` cannot say about them: that the whole value is
 * on the cell, and that the cell still clips.
 *
 * Both are properties of the markup and of nothing else. A `title` dropped at
 * either call site loses the image or the ticket's own words with no way back
 * to them, and `max-w-aside` dropped lets a value the length of a full digest
 * reference take the column apart. Neither shows up in a row's own value, so
 * neither is provable above this tier.
 *
 * The last activity column is the same tier for a different reason: that it
 * draws the relative reading and carries the absolute one on hover is a fact
 * about `Figure`'s tooltip, not about `activityAt` itself.
 */

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const revision = "repository:cfaca0a0f14ec03845a4e01458ac6c3a56d52a23:chuggy";

const image =
  "registry.chuggy.internal/chuggy/worker@sha256:9949c442a2f0a5cd0f0a5b1c8b6e0a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f";

const title =
  "Serve the escalation reason on the ticket resource, and on the table beside it";

const ticket = {
  ticket: 11,
  title,
  phase: "Working",
  sequence: 7,
  ...ticketInstants,
};

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

/** An escalated ticket with nothing joined to it, whose row answers why on the
 * phase chip's hover rather than in a column of its own. */
const escalatedTicket = {
  ticket: 12,
  title: "Serve the reason on the phase chip",
  phase: "Escalated",
  sequence: 8,
  reason: "WorkFailed",
  ...ticketInstants,
};

/** The table drawn from whatever a case wants the server holding, the one
 * seam every case in this file shares. */
async function drawTableWith(route: (url: string) => Response): Promise<void> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route,
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

/** The table with one running ticket, joined to the execution above. */
async function drawTable(): Promise<void> {
  await drawTableWith((url) => {
    if (url.includes("/executions")) return answer({ executions: [execution] });
    return answer({ partition: atlas, sequence: 8, tickets: [ticket] });
  });
}

test("the title cell keeps the whole title, keeps clipping it, and links", async () => {
  await drawTable();
  const cell = screen.getByText(title).parentElement;
  expect(cell?.className).toContain("max-w-aside");
  expect(screen.getByText(title).tagName).toBe("A");
  fireEvent.focus(cell as Element);
  expect((await screen.findByRole("tooltip")).textContent).toBe(title);
});

test("the last activity column draws the relative reading and answers the absolute on hover", async () => {
  await drawTable();
  const cell = screen.getByText("3h ago");
  fireEvent.focus(cell);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "2026-08-27 00:00",
  );
});

test("the runs-on cell keeps the image reference, and keeps clipping it", async () => {
  await drawTable();
  const cell = screen.getByText("chuggy-worker v3");
  expect(cell.className).toContain("max-w-aside");
  const trigger = cell.closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around runs-on");
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe(image);
});

test("a ticket's row draws its phase as a chip", async () => {
  await drawTable();
  expect(screen.getByText("Working").className).toContain("pill");
});

test("an escalated row answers why on the phase chip's hover", async () => {
  await drawTableWith((url) => {
    if (url.includes("/executions")) return answer({ executions: [] });
    return answer({
      partition: atlas,
      sequence: 9,
      tickets: [escalatedTicket],
    });
  });
  const chip = screen.getByText("Escalated");
  const trigger = chip.closest('[tabindex="0"]');
  if (trigger === null)
    throw new Error("no tooltip trigger around the phase chip");
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe("work failed");
});

test("a row whose index was truncated draws no chip for its execution", async () => {
  await drawTableWith((url) => {
    if (url.includes("/executions")) return answer({}, 500);
    return answer({ partition: atlas, sequence: 8, tickets: [ticket] });
  });
  const unread = screen.getAllByText(cellExecutionUnread);
  expect(unread).toHaveLength(2);
  for (const cell of unread)
    expect(cell.closest("td")?.querySelector(".pill")).toBeNull();
});

/** The served policy refuses `style-src` but `'self'`, so nothing this table
 * draws — a tooltip open included — may append a runtime style element. */
test("nothing the project table draws is a runtime style element", async () => {
  await drawTable();
  expect(document.querySelectorAll("style").length).toBe(0);
  const trigger = screen
    .getByText("chuggy-worker v3")
    .closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around runs-on");
  fireEvent.focus(trigger);
  await screen.findByRole("tooltip");
  expect(document.querySelectorAll("style").length).toBe(0);
});
