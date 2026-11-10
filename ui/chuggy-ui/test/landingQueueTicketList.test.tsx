/**
 * The ticket list's rows over the project's landing queues: a queued row draws
 * its place beside its state chip, a row in no queue draws none, and a queue
 * read that fails leaves every row drawn.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ProjectTable } from "../app/browser/ProjectTable.tsx";
import type { TicketListQuery } from "../app/core/ticketListView.ts";
import { renderCopied } from "./copied.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { ticketInstants } from "./ticketInstants.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => atlas,
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const repository = "https://github.com/acme/widgets.git";

function listed(ticket: number, phase: string): unknown {
  return {
    ticket,
    title: `Row ${String(ticket)}`,
    repository,
    phase,
    sequence: ticket,
    ...ticketInstants,
  };
}

const tickets = [
  listed(11, "Finalization"),
  listed(12, "Work"),
  listed(13, "Pending"),
];

const queued = {
  queues: [{ repository, holder: 11, waiting: [12] }],
  truncated: false,
};

async function listDrawn(queues: () => Response): Promise<void> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: () => answer({ partition: atlas, sequence: 8, tickets }),
    queues,
  });
  vi.stubGlobal("fetch", api.fetch);
  function Addressed(): ReactNode {
    const [query, setQuery] = useState<TicketListQuery>({});
    return <ProjectTable query={query} onQuery={setQuery} />;
  }
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <Addressed />
    </ScreenHarness>,
  );
  await settled();
}

function rowOf(ticket: number): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `.ticket-list-item[data-ticket="${String(ticket)}"]`,
  );
  if (row === null) throw new Error(`no row for #${String(ticket)}`);
  return row;
}

test("a queued row draws its place just before its state chip, and a row in no queue draws none", async () => {
  await listDrawn(() => answer(queued));
  const holding = within(rowOf(11)).getByRole("img", {
    name: "Lands next: #11 holds the target, 1 of 2 in its queue",
  });
  expect(holding.textContent).toBe("1/2");
  expect(holding.nextElementSibling?.className).toContain(
    "ticket-list-standing",
  );
  expect(
    within(rowOf(12)).getByRole("img", {
      name: "Waiting 2 of 2 to land: #11 holds the target",
    }).textContent,
  ).toBe("2/2");
  expect(rowOf(13).querySelector(".landing-queue-chip")).toBeNull();
  expect(
    rowOf(13).querySelector(".ticket-list-foot-standing")?.children,
  ).toHaveLength(1);
});

test("a queue read that fails draws no chip and leaves every row drawn", async () => {
  let asked = 0;
  await listDrawn(() => {
    asked += 1;
    return answer({ error: { code: "InternalError" } }, 500);
  });
  expect(asked).toBeGreaterThan(0);
  expect(screen.getByText("Row 11")).toBeTruthy();
  expect(screen.getByText("Row 13")).toBeTruthy();
  expect(document.querySelector(".landing-queue-chip")).toBeNull();
});
