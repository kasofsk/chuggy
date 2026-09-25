/**
 * The ticket page after something other than its own read writes the ticket:
 * a live `Ticket` frame, and the project row an action's confirmation reads
 * back. Both land on a page that has already drawn the ticket's own read, and
 * what each case asserts is that the page keeps drawing what only that read
 * carries — the ledger grouped by the program, and the brief — while taking
 * the phase the newer arrival names.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import { ticketDispatchViewOf } from "./ticketPageFixture.ts";
import {
  ledgerPage,
  ticket21Parked,
  ticket21Program,
} from "./ticketLedgerFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { viewportAtEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "vteng", project: "chuggy" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "21" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const intent = "Give the console a footer";

/** What only the ticket's own read carries, as ticket 21 was released. */
const ownRead = {
  brief: { intent, links: [] },
  configurationRevision: "r1",
  program: ticket21Program,
};

const parkedRead = {
  ticket: 21,
  phase: "Escalated",
  sequence: 167,
  ...ticketInstants,
  escalation: { kind: "EvaluationFailureEscalated", resumeAt: "ResumeRework" },
  ...ownRead,
};

/** Ticket 21 resumed, as the project's row carries it. */
const resumedRow = {
  ticket: 21,
  phase: "Evaluation",
  sequence: 169,
  ...ticketInstants,
};

/** Ticket 21 waiting on a paused selector, where only a press dispatches it. */
const pendingRead = { ...parkedRead, phase: "Pending", escalation: undefined };

/** Ticket 21 dispatched, as the project's row carries it. */
const dispatchedRow = { ...resumedRow, phase: "Work" };

/** The page's routes; the ticket's own read answers `after` once anything has
 * been submitted, the way the API would. */
function drawn(
  held: object = parkedRead,
  after: object = resumedRow,
  dispatch: unknown = { result: "Reset" },
): ReturnType<typeof openedStream> {
  const api = apiDouble({
    operation: {
      operation: "op-one",
      acceptedAt: "2026-08-26T10:00:00Z",
      state: "Succeeded",
      decidedSequence: resumedRow.sequence,
    },
    route: (url) => {
      if (url.includes("/dispatch-view")) return answer(dispatch);
      if (url.includes("/native-actions")) return answer({ actions: [] });
      if (url.includes("/executions"))
        return answer(ledgerPage(ticket21Parked));
      if (url.includes("/configurations/") || url.includes("/drafts/"))
        return answer({}, 404);
      if (url.includes("/tickets/"))
        return answer(
          api.submitted() === undefined ? held : { ...after, ...ownRead },
        );
      return answer({ partition: atlas, sequence: 169, tickets: [after] });
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
      <TicketPage />
    </ScreenHarness>,
  );
  return server;
}

function cyclesDrawn(): number {
  return document.querySelectorAll(".ledger-group").length;
}

/** Opens the Brief row, which the page draws closed, and counts the brief. */
async function briefOpened(): Promise<number> {
  await turned(() => {
    screen.getByRole("button", { name: "Brief" }).click();
  });
  return screen.getAllByText(intent).length;
}

test("a frame carrying the project's row leaves the ledger grouped and the brief drawn", async () => {
  const server = drawn();
  await settled();
  const briefDrawn = await briefOpened();
  expect(briefDrawn).toBeGreaterThan(0);
  expect(cyclesDrawn()).toBe(3);

  await turned(() => {
    server.push(
      frame("Ticket", "200", {
        version: 1,
        resource: "21",
        representation: resumedRow,
      }),
    );
  });
  await settled();

  expect(screen.getAllByText("Evaluating").length).toBeGreaterThan(0);
  expect(screen.queryByText("Ungrouped · program not loaded")).toBeNull();
  expect(cyclesDrawn()).toBe(3);
  expect(screen.getAllByText(intent)).toHaveLength(briefDrawn);
});

test("an action's confirmed row leaves the ledger grouped and the brief drawn", async () => {
  drawn();
  await settled();
  const briefDrawn = await briefOpened();

  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  expect(screen.getAllByText("Evaluating").length).toBeGreaterThan(0);
  expect(screen.queryByText("Ungrouped · program not loaded")).toBeNull();
  expect(cyclesDrawn()).toBe(3);
  expect(screen.getAllByText(intent)).toHaveLength(briefDrawn);
});

test("a dispatch's confirmed row leaves the ledger grouped and the brief drawn", async () => {
  drawn(
    pendingRead,
    dispatchedRow,
    ticketDispatchViewOf(atlas, [
      {
        ticket: 21,
        ticketVersion: 4,
        dependencies: [],
        program: [],
        configurationRevision: "r1",
        configurationDigest: "b".repeat(64),
        configurationCanonical: "{}",
      },
    ]),
  );
  await settled();
  const briefDrawn = await briefOpened();
  expect(cyclesDrawn()).toBe(3);

  await turned(() => {
    screen.getByRole("button", { name: "Dispatch" }).click();
  });
  await settled();

  expect(screen.getAllByText("Working").length).toBeGreaterThan(0);
  expect(screen.queryByText("Ungrouped · program not loaded")).toBeNull();
  expect(cyclesDrawn()).toBe(3);
  expect(screen.getAllByText(intent)).toHaveLength(briefDrawn);
});
