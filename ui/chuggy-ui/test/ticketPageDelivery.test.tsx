// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { nativeHttpBasePath } from "../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import { useTicketDelivery } from "../app/browser/ticket/TicketDelivery.tsx";
import { ticketDeliveryPolledMs } from "../app/core/ticketDelivery.ts";
import {
  answer,
  apiDouble,
  holderDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
  ticketPageAmbientRoute,
  turned,
} from "./screenHarness.tsx";
import {
  deliveryAction,
  deliveryDetail,
  deliveryEveryMark,
  deliveryFailedBare,
  deliveryFailedWhole,
  deliveryLandedWith,
  deliveryLink,
  deliveryReported,
  deliveryReportWhole,
} from "./ticketDeliveryFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { frame } from "./streamDouble.ts";
import { viewportAtEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end

/**
 * The Delivery row on a ticket's page, over what the read of the ticket's
 * action reach answers: which answers draw a row, what a line of it says, and
 * that a read which fails, is slow or is asked again leaves the rest of the
 * page as it stood.
 */

beforeEach(() => {
  resizeObserverStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const landedTicket = {
  ticket: 11,
  phase: "Done",
  sequence: 9,
  ...ticketInstants,
  brief: { intent: "Give the console a footer", links: [] },
};

/** Everything the page reads beside the reach, none of which a case is about. */
function pageRoute(url: string): Response {
  const ambient = ticketPageAmbientRoute(url);
  if (ambient !== undefined) return ambient;
  if (url.includes("/executions")) return answer({ executions: [] });
  if (url.includes("/drafts/")) return answer({}, 404);
  if (url.includes("/tickets/")) return answer(landedTicket);
  return answer({ partition: atlas, sequence: 9, tickets: [landedTicket] });
}

/** Every address the reach read was asked at by the last drawn page. */
let reachAsked: string[] = [];

/** The stream the last drawn page is listening on, for a case to push at. */
let stream = openedStream();

/** The ticket's page over a reach read that answers what the case says. */
async function drawn(
  reach: () => Response | Promise<Response>,
): Promise<HTMLElement> {
  reachAsked = [];
  const api = apiDouble({
    operation: operationAt("Succeeded"),
    route: pageRoute,
    reach: (url) => {
      reachAsked.push(url);
      return reach();
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  stream = openedStream();
  const view = render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={stream.ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
  return view.container;
}

/** The ids of the rows under the ledger, in the order the page draws them. */
function rowsDrawn(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("section.ticket-section")].map(
    (row) => row.id,
  );
}

function deliveryRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector<HTMLElement>("section#delivery");
  if (row === null) throw new Error("no Delivery row drawn");
  return row;
}

/** The Delivery row once pressed open, which the page draws closed. */
async function deliveryOpened(container: HTMLElement): Promise<HTMLElement> {
  const row = deliveryRow(container);
  await turned(() => {
    within(row).getByRole("button").click();
  });
  await settled();
  return row;
}

function linesDrawn(row: HTMLElement): readonly HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(".ticket-delivery-line")];
}

/** What one line says, part by part: its name, its word and tone, its commit. */
function lineSaid(line: HTMLElement): readonly (string | null | undefined)[] {
  const pill = line.querySelector(".pill");
  return [
    line.querySelector(".ticket-delivery-name")?.textContent,
    pill?.textContent,
    pill?.className,
    line.querySelector(".identity")?.textContent,
  ];
}

test("a ticket that has landed nowhere draws no Delivery row and no anchor to one", async () => {
  const container = await drawn(() =>
    answer({ repository: null, commit: null, actions: [] }),
  );
  expect(rowsDrawn(container)).toEqual(["brief", "usage", "provenance"]);
  expect(screen.queryByText("Delivery")).toBeNull();
  expect(
    container.querySelector('nav.sections a[href="#delivery"]'),
  ).toBeNull();
});

test("a landed ticket whose repository declares nothing draws no Delivery row", async () => {
  const container = await drawn(() => answer(deliveryLandedWith([])));
  expect(rowsDrawn(container)).toEqual(["brief", "usage", "provenance"]);
  expect(screen.queryByText("Delivery")).toBeNull();
});

test("a landed ticket draws Delivery after Provenance, closed, its lines counted by mark", async () => {
  const container = await drawn(() => answer(deliveryEveryMark));
  expect(rowsDrawn(container)).toEqual([
    "brief",
    "usage",
    "provenance",
    "delivery",
  ]);
  expect(reachAsked).toEqual([
    `${nativeHttpBasePath}/tenants/acme/projects/atlas/tickets/11/action-reach`,
  ]);
  const trigger = within(deliveryRow(container)).getByRole("button");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.textContent).toBe(
    "Delivery1 Failed · 1 Rolled back · 1 Unknown · 1 Waiting · 1 Reached",
  );
  expect(linesDrawn(deliveryRow(container))).toEqual([]);
});

test("the row opened is one line an action in the read's order: its name, its word in its tone, its report's commit", async () => {
  const row = await deliveryOpened(
    await drawn(() => answer(deliveryEveryMark)),
  );
  expect(linesDrawn(row).map(lineSaid)).toEqual([
    ["API image", "Reached", "pill pill-pass", "43a251a"],
    ["Console image", "Waiting", "pill pill-queued", undefined],
    ["Release published", "Failed", "pill pill-fail", "43a251a"],
    ["Rig", "Rolled back", "pill pill-retired", "43a251a"],
    ["Smoke", "Unknown", "pill pill-neutral", undefined],
  ]);
  expect(row.textContent).not.toContain(deliveryReported);
});

test("a failure draws its reporter's detail beneath it and its link, which opens outside the console", async () => {
  const row = await deliveryOpened(
    await drawn(() => answer(deliveryLandedWith([deliveryFailedWhole]))),
  );
  const [line] = linesDrawn(row);
  expect(line?.querySelector("p.ticket-delivery-detail")?.textContent).toBe(
    deliveryDetail,
  );
  const link = within(row).getByRole("link");
  expect(link.textContent).toBe("grafana.example.test");
  expect(link.getAttribute("href")).toBe(deliveryLink);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

test("a failure whose reporter said neither draws its word and its commit alone", async () => {
  const row = await deliveryOpened(
    await drawn(() => answer(deliveryLandedWith([deliveryFailedBare]))),
  );
  expect(linesDrawn(row).map(lineSaid)).toEqual([
    ["Rig", "Failed", "pill pill-fail", "43a251a"],
  ]);
  expect(row.querySelector(".ticket-delivery-detail")).toBeNull();
  expect(within(row).queryByRole("link")).toBeNull();
});

test("a link is drawn at every mark read from a report, and a detail at a failure alone", async () => {
  const row = await deliveryOpened(
    await drawn(() =>
      answer(
        deliveryLandedWith([
          deliveryAction("a", "A", "Reached", deliveryReportWhole),
          deliveryAction("b", "B", "RolledBack", deliveryReportWhole),
        ]),
      ),
    ),
  );
  expect(
    within(row)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")),
  ).toEqual([deliveryLink, deliveryLink]);
  expect(row.querySelector(".ticket-delivery-detail")).toBeNull();
  expect(row.textContent).not.toContain(deliveryDetail);
});

test("a reporter's words and a declared name are drawn as the text they are, never as markup", async () => {
  const detail = '<img src="x" onerror="alert(1)"><a href="/">here</a>';
  const name = "<b>Rig</b>";
  const row = await deliveryOpened(
    await drawn(() =>
      answer(
        deliveryLandedWith([
          deliveryAction("rig", name, "Failed", {
            ...deliveryReportWhole,
            outcome: "Failed",
            detail,
          }),
        ]),
      ),
    ),
  );
  expect(row.querySelector(".ticket-delivery-detail")?.textContent).toBe(
    detail,
  );
  expect(row.querySelector(".ticket-delivery-name")?.textContent).toBe(name);
  expect(row.querySelector("img, b")).toBeNull();
  expect(within(row).getAllByRole("link")).toHaveLength(1);
});

test("a read that fails is drawn as a failed read in this row, and the page around it stands", async () => {
  const container = await drawn(() =>
    answer({ error: { code: "InternalError" } }, 500),
  );
  expect(rowsDrawn(container)).toEqual([
    "brief",
    "usage",
    "provenance",
    "delivery",
  ]);
  expect(within(deliveryRow(container)).getByRole("button").textContent).toBe(
    "DeliveryNot read",
  );
  expect(screen.queryAllByText(/Failed to load/u)).toEqual([]);
  const row = await deliveryOpened(container);
  expect(within(row).getByText(/^Failed to load · /u)).toBeDefined();
  expect(linesDrawn(row)).toEqual([]);
  expect(screen.getAllByText(/Failed to load/u)).toHaveLength(1);
  expect(container.querySelector(".ticket-status")?.textContent).toContain(
    "Done",
  );
});

test("an answer that is not the read's is a failed read too, and draws no line of it", async () => {
  const container = await drawn(() =>
    answer({
      ...deliveryEveryMark,
      actions: [{ action: "rig", name: "Rig", reach: "Reached" }],
    }),
  );
  const row = await deliveryOpened(container);
  expect(within(row).getByText(/^Failed to load · /u)).toBeDefined();
  expect(linesDrawn(row)).toEqual([]);
});

test("a read still out draws no row and holds nothing else of the page back, and the row arrives with its answer", async () => {
  let answering: (response: Response) => void = () => undefined;
  const container = await drawn(
    () =>
      new Promise<Response>((resolve) => {
        answering = resolve;
      }),
  );
  expect(rowsDrawn(container)).toEqual(["brief", "usage", "provenance"]);
  expect(container.querySelector(".ticket-status")?.textContent).toContain(
    "Done",
  );
  expect(screen.queryByText(/Loading/u)).toBeNull();
  await turned(() => {
    answering(answer(deliveryLandedWith([deliveryFailedBare])));
  });
  await settled();
  expect(within(deliveryRow(container)).getByRole("button").textContent).toBe(
    "Delivery1 Failed",
  );
});

test("the details pane points at Delivery while its row is drawn, and following it opens the row", async () => {
  const container = await drawn(() => answer(deliveryEveryMark));
  const anchors = [...container.querySelectorAll("nav.sections a")];
  expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual([
    "#cycles",
    "#brief",
    "#usage",
    "#provenance",
    "#delivery",
  ]);
  const anchor = anchors.at(-1) as HTMLElement;
  expect(anchor.textContent).toBe(
    "Delivery1 Failed · 1 Rolled back · 1 Unknown · 1 Waiting · 1 Reached",
  );
  await turned(() => {
    anchor.click();
  });
  await settled();
  expect(linesDrawn(deliveryRow(container))).toHaveLength(5);
});

test("a re-read the page makes for another reason asks again whatever the row last said, and clears an Unknown", async () => {
  let reach = "Unknown" as "Unknown" | "Reached";
  const container = await drawn(() =>
    answer(deliveryLandedWith([deliveryAction("rig", "Rig", reach)])),
  );
  const trigger = within(deliveryRow(container)).getByRole("button");
  expect(trigger.textContent).toBe("Delivery1 Unknown");
  reach = "Reached";
  await turned(() => {
    stream.push(
      frame("Project", "10", {
        version: 1,
        resource: atlas.project,
        representation: atlas,
      }),
    );
  });
  await settled();
  expect(reachAsked).toHaveLength(2);
  expect(trigger.textContent).toBe("Delivery1 Reached");
});

/** The read alone, asked by nothing but its own clock. */
function polled(reach: () => Response | Promise<Response>): {
  readonly asked: () => number;
  readonly lines: () => readonly string[] | string;
} {
  let asked = 0;
  vi.stubGlobal("fetch", () => {
    asked += 1;
    return Promise.resolve(reach());
  });
  const client = new QueryClient();
  const { result } = renderHook(() => useTicketDelivery(atlas, 11), {
    wrapper: (props: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <SessionProvider holder={holderDouble()}>
          {props.children}
        </SessionProvider>
      </QueryClientProvider>
    ),
  });
  return {
    asked: () => asked,
    lines: () =>
      result.current.state === "Ready"
        ? result.current.value.map((line) => `${line.name} ${line.reach}`)
        : result.current.state,
  };
}

async function clockMoved(ms: number): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

test("the read is asked again each time its wait has passed, and never sooner", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let reach = "Unknown" as "Unknown" | "Reached";
  const held = polled(() =>
    answer(deliveryLandedWith([deliveryAction("rig", "Rig", reach)])),
  );
  await settled();
  expect(held.asked()).toBe(1);
  expect(held.lines()).toEqual(["Rig Unknown"]);
  reach = "Reached";
  await clockMoved(ticketDeliveryPolledMs - 1_000);
  expect(held.asked()).toBe(1);
  expect(held.lines()).toEqual(["Rig Unknown"]);
  await clockMoved(1_000);
  await settled();
  expect(held.asked()).toBe(2);
  expect(held.lines()).toEqual(["Rig Reached"]);
  await clockMoved(ticketDeliveryPolledMs);
  await settled();
  expect(held.asked()).toBe(3);
});

test("the row keeps what it showed while a poll is out, and after one that failed", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let next: () => Response | Promise<Response> = () =>
    answer(deliveryLandedWith([deliveryAction("rig", "Rig", "NotYet")]));
  const held = polled(() => next());
  await settled();
  expect(held.lines()).toEqual(["Rig NotYet"]);

  let answering: (response: Response) => void = () => undefined;
  next = () =>
    new Promise<Response>((resolve) => {
      answering = resolve;
    });
  await clockMoved(ticketDeliveryPolledMs);
  await settled();
  expect(held.asked()).toBe(2);
  expect(held.lines()).toEqual(["Rig NotYet"]);

  await act(async () => {
    answering(answer({ error: { code: "InternalError" } }, 500));
    await Promise.resolve();
  });
  await settled();
  expect(held.lines()).toEqual(["Rig NotYet"]);

  next = () =>
    answer(deliveryLandedWith([deliveryAction("rig", "Rig", "Reached")]));
  await clockMoved(ticketDeliveryPolledMs);
  await settled();
  expect(held.asked()).toBe(3);
  expect(held.lines()).toEqual(["Rig Reached"]);
});
