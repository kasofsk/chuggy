/**
 * A row the phase page did not carry — named only by an open action or a held
 * proposal — drawn from the ticket's own read: its title, a dash where it never
 * ran, and "not read" only while that read has not answered or has failed.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
import {
  abilitiesAnswered,
  abilitiesEvery,
} from "./projectAbilitiesFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import type { StreamServer } from "./streamDouble.ts";
import { frame } from "./streamDouble.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

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
});

const proposed = {
  ticket: 7,
  title: "README: how changes land through chuggy",
  phase: "Pending",
  sequence: 5,
  ...ticketInstants,
};

const finalizing = {
  ticket: 11,
  title: "Land the release notes",
  phase: "Finalization",
  sequence: 6,
  ...ticketInstants,
};

const escalated = {
  ticket: 4,
  title: "Serve the reason",
  phase: "Escalated",
  sequence: 9,
  ...ticketInstants,
};

const approval = {
  action: "action-eleven",
  kind: "FinalizationApproval",
  authorizingSequence: 51,
  admits: ["Approve", "Decline"],
};

/** A ticket's own read that never answers. */
const unanswered = Symbol("unanswered");

/** A project whose rows come from the reads the case names, nothing having
 * run. A ticket's own read answers with its body in `tickets`, never answers
 * where that is `unanswered`, and fails where it has none. */
function drawInbox(served: {
  readonly phase?: readonly unknown[];
  readonly actions?: readonly unknown[];
  readonly proposed?: readonly number[];
  readonly tickets: Readonly<Record<number, unknown>>;
}): { readonly read: readonly string[]; readonly server: StreamServer } {
  const read: string[] = [];
  const respond = (url: string): Response | undefined => {
    const own = /\/tickets\/(?<ticket>\d+)$/u.exec(url)?.groups?.["ticket"];
    if (own !== undefined) {
      read.push(own);
      const body = served.tickets[Number(own)];
      if (body === unanswered) return undefined;
      return body === undefined
        ? answer({ error: { code: "InternalError", message: "fault" } }, 500)
        : answer(body);
    }
    const abilities = abilitiesAnswered(url, abilitiesEvery);
    if (abilities !== undefined) return abilities;
    if (url.includes("/selector-proposals"))
      return answer({
        proposals:
          served.proposed === undefined
            ? []
            : [{ decision: "dec-one", tickets: served.proposed }],
        more: false,
      });
    if (url.includes("/agentic-refusals"))
      return answer({ refusals: [], more: false });
    if (url.includes("/native-actions"))
      return answer({ actions: served.actions ?? [] });
    if (url.includes("/executions")) return answer({ executions: [] });
    return answer({
      partition: atlas,
      sequence: 9,
      tickets: served.phase ?? [],
    });
  };
  vi.stubGlobal("fetch", (url: string) => {
    const answered = respond(url);
    return answered === undefined
      ? new Promise<never>(() => undefined)
      : Promise.resolve(answered);
  });
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <InboxScreen partition={atlas} />
    </ScreenHarness>,
  );
  return { read, server };
}

/** The row a ticket's number link sits in. */
function row(ticket: number): HTMLElement {
  const found = screen
    .getByRole("link", { name: String(ticket) })
    .closest("tr");
  if (found === null) throw new Error(`no row for ticket ${String(ticket)}`);
  return found;
}

/** One row's cell under the column the table names `column`. */
function cell(ticket: number, column: string): string {
  const columns = screen
    .getAllByRole("columnheader")
    .map((header) => header.textContent);
  const at = columns.indexOf(column);
  if (at < 0) throw new Error(`no column ${column}`);
  return row(ticket).children[at]?.textContent ?? "";
}

test("a proposed ticket's row names it, and says it never ran", async () => {
  drawInbox({ proposed: [7], tickets: { 7: proposed } });
  await settled();
  expect(cell(7, "title")).toBe(`${proposed.title}7`);
  expect(cell(7, "last execution")).toBe("—");
  expect(cell(7, "last activity")).not.toBe("—");
});

/** The read draws the row; what the row answers is still the proposal's alone. */
test("a proposed ticket's own read adds no answer to its row", async () => {
  drawInbox({ proposed: [7], tickets: { 7: proposed } });
  await settled();
  expect(
    within(row(7))
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toStrictEqual(["approve", "reject"]);
});

test("a ticket only an open action names is named, and says it never ran", async () => {
  drawInbox({
    actions: [{ ticket: 11, ...approval }],
    tickets: { 11: finalizing },
  });
  await settled();
  expect(cell(11, "title")).toBe(`${finalizing.title}11`);
  expect(cell(11, "last execution")).toBe("—");
  expect(cell(11, "last activity")).not.toBe("—");
});

test("a ticket whose own read failed or has not answered says not read", async () => {
  drawInbox({ proposed: [7, 8], tickets: { 8: unanswered } });
  await settled();
  for (const ticket of [7, 8]) {
    expect(cell(ticket, "title")).toBe(`—${String(ticket)}`);
    expect(cell(ticket, "last execution")).toBe("not read");
    expect(cell(ticket, "last activity")).toBe("—");
  }
});

test("a ticket the phase page carries is not read again on its own", async () => {
  const drawn = drawInbox({
    phase: [escalated],
    actions: [{ ticket: 4, ...approval }],
    proposed: [7],
    tickets: { 7: proposed },
  });
  await settled();
  expect(cell(4, "title")).toBe(`${escalated.title}4`);
  expect(drawn.read).toStrictEqual(["7"]);
});

/** The same frame that folds the phase page writes the ticket's own key. */
test("a Ticket frame redraws a row the phase page did not carry", async () => {
  const drawn = drawInbox({ proposed: [7], tickets: { 7: proposed } });
  await settled();
  await turned(() => {
    drawn.server.push(
      frame("Ticket", "12", {
        version: 1,
        resource: "7",
        representation: { ...proposed, title: "Retitled", sequence: 12 },
      }),
    );
  });
  expect(cell(7, "title")).toBe("Retitled7");
});
