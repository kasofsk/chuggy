/**
 * An epic's graph on its Graph tab: each card and what it says, the row of
 * members with no edge, the edges met and not, the chain a card traces, the
 * ticket selected and the side panel showing it, its dispatch, the key, the
 * toggle for the tickets outside the epic, the states before and without a
 * graph, and the reads that draw it again.
 */

import { onlineManager } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { EpicGraphTab } from "../app/browser/epic/EpicGraphTab.tsx";
import {
  epicGraphMemberHeight,
  epicGraphMemberWidth,
  epicGraphRootPixels,
} from "../app/core/epicGraph.ts";
import { epicGraphQuery } from "../app/core/epics.ts";
import { landingQueuesQuery } from "../app/core/ticketQueries.ts";
import {
  epicGraph,
  epicPageDrawn,
  epicRow,
  epicServing,
  epicServingReset,
  epicView,
} from "./epicPageFixture.tsx";
import { leadPartition } from "./leadFixture.ts";
import { abilitiesEvery, abilitiesNone } from "./projectAbilitiesFixture.ts";
import { settled } from "./screenHarness.tsx";

vi.mock(
  "@tanstack/react-router",
  async () => (await import("./epicPageRouter.tsx")).epicRouterDouble,
);

afterEach(() => {
  cleanup();
  document.documentElement.style.fontSize = "";
  vi.unstubAllGlobals();
  epicServingReset();
  onlineManager.setOnline(true);
});

/** The tab under an address that starts at the ticket given, and is written
 * where a selection asks, as the route writes its search. */
function EpicGraphTabAddressed(props: {
  readonly ticket?: number;
  readonly written?: number[];
}): ReactNode {
  const [ticket, setTicket] = useState(props.ticket);
  return (
    <EpicGraphTab
      ticket={ticket}
      onTicket={(selected) => {
        props.written?.push(selected);
        setTicket(selected);
      }}
    />
  );
}

async function graphic(): Promise<SVGSVGElement> {
  return (await screen.findByRole("group", {
    name: "Tickets of the epic and what they wait on",
  })) as unknown as SVGSVGElement;
}

function card(ticket: number): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `.epic-card[data-ticket="${String(ticket)}"]`,
  );
  if (found === null) throw new Error(`#${String(ticket)} is drawn`);
  return found;
}

function cardButton(ticket: number): HTMLButtonElement {
  const found = card(ticket).querySelector("button");
  if (found === null) throw new Error("a card is a button");
  return found;
}

function lit(): readonly number[] {
  return [
    ...document.querySelectorAll<HTMLElement>('.epic-card[data-trace="lit"]'),
  ]
    .map((each) => Number(each.dataset["ticket"]))
    .sort((left, right) => left - right);
}

function litEdges(): readonly string[] {
  return [
    ...document.querySelectorAll<SVGPathElement>(
      'path.epic-graph-edge[data-trace="lit"]',
    ),
  ]
    .map((edge) => `${edge.dataset["from"] ?? ""}-${edge.dataset["to"] ?? ""}`)
    .sort();
}

function side(): HTMLElement {
  return screen.getByRole("complementary", { name: "Selected ticket" });
}

function pressed(): readonly number[] {
  return [
    ...document.querySelectorAll('.epic-card button[aria-pressed="true"]'),
  ].map((button) =>
    Number(button.closest<HTMLElement>(".epic-card")?.dataset["ticket"]),
  );
}

/** A chain 4 → 5 → 6 → 7 with a branch 5 → 8, ticket 2 outside the epic
 * that 5 waits on, and member 9 that touches nothing. */
const chained = {
  nodes: [
    { ticket: 2, title: "Schema", phase: "Work", member: false },
    { ticket: 4, title: "Charge", phase: "Done", member: true },
    { ticket: 5, title: "Refund", phase: "Work", member: true },
    { ticket: 6, title: "Ledger", phase: "Pending", member: true },
    { ticket: 7, title: "Report", phase: "Pending", member: true },
    { ticket: 8, title: "Export", phase: "Pending", member: true },
    { ticket: 9, title: "Audit", phase: "Pending", member: true },
  ],
  edges: [
    { from: 2, to: 5 },
    { from: 4, to: 5 },
    { from: 5, to: 6 },
    { from: 6, to: 7 },
    { from: 5, to: 8 },
  ],
};

const chainedRows = [
  epicRow(4, "Done"),
  epicRow(5, "Work", { status: "Running", cycle: 2 }),
  {
    ...(epicRow(6, "Pending") as object),
    openDependencies: [{ ticket: 5, phase: "Work" }],
  },
  {
    ...(epicRow(7, "Pending") as object),
    openDependencies: [{ ticket: 6, phase: "Pending" }],
  },
  {
    ...(epicRow(8, "Pending") as object),
    openDependencies: [{ ticket: 5, phase: "Work" }],
  },
  epicRow(9, "Pending"),
];

function chainServed(): void {
  epicServing.view = { ...epicView, tickets: [4, 5, 6, 7, 8, 9] };
  epicServing.graph = chained;
  epicServing.rows = chainedRows;
}

test("a card is a button holding its state's mark, its number, its state's word and its title, and no dispatch nor run", async () => {
  chainServed();
  await epicPageDrawn(abilitiesEvery, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const running = card(5);
  const head = running.querySelector(".epic-card-head");
  expect(
    [...(head?.children ?? [])].map((child) => child.className),
  ).toStrictEqual(["epic-card-mark", "epic-card-number", "epic-card-word"]);
  expect(
    head?.querySelector(".epic-card-mark svg.ticket-state-mark"),
  ).not.toBeNull();
  expect(running.querySelector(".epic-card-number")?.textContent).toBe("#5");
  expect(running.querySelector(".epic-card-title")?.textContent).toBe("Refund");
  expect(running.dataset["standing"]).toBe("Work");
  expect(running.dataset["tone"]).toBe("live");
  expect(card(4).dataset["standing"]).toBe("Done");
  expect(card(6).dataset["standing"]).toBe("Blocked");
  expect(card(2).dataset["standing"]).toBe("Work");
  expect(cardButton(2).getAttribute("aria-label")).toMatch(
    /^#2 Schema: .+, outside the epic$/u,
  );
  for (const each of document.querySelectorAll(".epic-card"))
    expect(each.querySelectorAll("button")).toHaveLength(1);
  expect(document.querySelector(".epic-card a")).toBeNull();
  expect(screen.queryByText("Work in cycle 2")).toBeNull();
});

test("a draft takes its state from the graph, and an untitled card says Untitled", async () => {
  epicServing.graph = {
    ...epicGraph,
    nodes: [...epicGraph.nodes, { ticket: 6, member: true }],
    edges: [...epicGraph.edges, { from: 4, to: 6 }],
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(card(6).dataset["standing"]).toBe("Draft");
  expect(card(6).querySelector(".epic-card-title")?.textContent).toBe(
    "Untitled",
  );
  expect(card(6).querySelector(".epic-card-word")?.textContent).toBe("Draft");
});

test("a member with no edge either way is drawn in the row under the graph, not in it", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  const drawing = await graphic();
  expect(drawing.querySelector('.epic-card[data-ticket="9"]')).toBeNull();
  const row = screen.getByRole("list", { name: "Unlinked tickets" });
  expect(
    [...row.querySelectorAll<HTMLElement>(".epic-card")].map(
      (each) => each.dataset["ticket"],
    ),
  ).toStrictEqual(["9"]);
  expect(
    drawing.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("under a root larger than the graph is stated at, every card grows with the text it holds", async () => {
  document.documentElement.style.fontSize = `${String(epicGraphRootPixels * 1.25)}px`;
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const placedOf = (ticket: number) =>
    [
      ...document.querySelectorAll<SVGForeignObjectElement>("foreignObject"),
    ].find((each) => each.contains(card(ticket)));
  const placed = placedOf(5);
  expect(Number(placed?.getAttribute("width"))).toBe(
    epicGraphMemberWidth * 1.25,
  );
  expect(Number(placed?.getAttribute("height"))).toBe(
    epicGraphMemberHeight * 1.25,
  );
  const unlinked = placedOf(9);
  expect(Number(unlinked?.getAttribute("width"))).toBe(
    epicGraphMemberWidth * 1.25,
  );
});

test("an edge out of a Done ticket is drawn met, and the rest are not", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  const drawing = await graphic();
  const met = [
    ...drawing.querySelectorAll<SVGPathElement>("path.epic-graph-edge"),
  ]
    .filter((edge) => edge.hasAttribute("data-met"))
    .map((edge) => `${edge.dataset["from"] ?? ""}-${edge.dataset["to"] ?? ""}`);
  expect(met).toStrictEqual(["4-5"]);
  expect(drawing.querySelectorAll("path.epic-graph-edge")).toHaveLength(5);
});

test("hovering and focusing a card trace the same chain, all the way along, and dim the rest", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(lit()).toStrictEqual([]);
  expect(document.querySelector("[data-trace]")).toBeNull();
  fireEvent.mouseEnter(cardButton(6));
  const hovered = { cards: lit(), edges: litEdges() };
  expect(hovered).toStrictEqual({
    cards: [2, 4, 5, 6, 7],
    edges: ["2-5", "4-5", "5-6", "6-7"],
  });
  expect(card(8).dataset["trace"]).toBe("dim");
  expect(card(9).dataset["trace"]).toBe("dim");
  expect(
    document
      .querySelector('path[data-from="5"][data-to="8"]')
      ?.getAttribute("data-trace"),
  ).toBe("dim");
  fireEvent.mouseLeave(cardButton(6));
  expect(document.querySelector("[data-trace]")).toBeNull();
  fireEvent.focus(cardButton(6));
  expect({ cards: lit(), edges: litEdges() }).toStrictEqual(hovered);
  fireEvent.blur(cardButton(6));
  expect(document.querySelector("[data-trace]")).toBeNull();
});

test("with none named, the first running member is selected, and the side panel shows it", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(pressed()).toStrictEqual([5]);
  const panel = side();
  expect(panel.dataset["ticket"]).toBe("5");
  expect(within(panel).getByRole("heading", { level: 3 }).textContent).toBe(
    "Refund",
  );
  expect(panel.querySelector(".epic-graph-side-number")?.textContent).toBe(
    "#5",
  );
  expect(
    within(panel)
      .getByRole("list", { name: "Depends on" })
      .querySelectorAll("button").length,
  ).toBe(2);
  expect(
    within(within(panel).getByRole("list", { name: "Blocks" }))
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toStrictEqual(["#6 Ledger", "#8 Export"]);
  expect(
    within(panel)
      .getByRole("link", { name: "Open ticket" })
      .getAttribute("href"),
  ).toBe(`/${leadPartition.tenant}/${leadPartition.project}/tickets/5`);
});

test("with nothing running the first Ready member is selected, and with nothing Ready the topmost", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  const first = await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed />,
  });
  await graphic();
  expect(pressed()).toStrictEqual([5]);
  cleanup();
  epicServing.rows = [];
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed />,
    client: first.client,
  });
  await graphic();
  const cards = [
    ...document.querySelectorAll<SVGForeignObjectElement>("foreignObject"),
  ]
    .map((each) => ({
      ticket: Number(
        each.querySelector<HTMLElement>(".epic-card")?.dataset["ticket"],
      ),
      y: Number(each.getAttribute("y")),
      x: Number(each.getAttribute("x")),
    }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  expect(pressed()).toStrictEqual([cards[0]?.ticket]);
});

test("a click, an Enter and the address each select a card, which the address is written with", async () => {
  chainServed();
  const written: number[] = [];
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed ticket={7} written={written} />,
  });
  await graphic();
  expect(pressed()).toStrictEqual([7]);
  expect(side().dataset["ticket"]).toBe("7");
  expect(cardButton(7).getAttribute("aria-pressed")).toBe("true");
  expect(cardButton(4).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(cardButton(4));
  expect(pressed()).toStrictEqual([4]);
  expect(side().dataset["ticket"]).toBe("4");
  fireEvent.keyDown(cardButton(8), { key: "Enter" });
  expect(pressed()).toStrictEqual([8]);
  expect(written).toStrictEqual([4, 8]);
});

test("a ticket the side panel lists selects that ticket when pressed", async () => {
  chainServed();
  const written: number[] = [];
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed ticket={6} written={written} />,
  });
  await graphic();
  const dependsOn = within(side()).getByRole("list", { name: "Depends on" });
  fireEvent.click(within(dependsOn).getByRole("button", { name: "#5 Refund" }));
  expect(side().dataset["ticket"]).toBe("5");
  fireEvent.click(
    within(within(side()).getByRole("list", { name: "Depends on" })).getByRole(
      "button",
      { name: /^#2 / },
    ),
  );
  expect(side().dataset["ticket"]).toBe("2");
  expect(within(side()).getByText("None")).toBeTruthy();
  expect(written).toStrictEqual([5, 2]);
});

test("dispatch is offered for a Ready ticket to a reader who may dispatch, and nowhere else", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  await epicPageDrawn(abilitiesEvery, {
    tab: <EpicGraphTabAddressed ticket={5} />,
  });
  await graphic();
  const dispatch = await within(side()).findByRole("button", {
    name: "Dispatch",
  });
  expect(dispatch.hasAttribute("disabled")).toBe(false);
  act(() => {
    onlineManager.setOnline(false);
  });
  expect(dispatch.hasAttribute("disabled")).toBe(true);
  act(() => {
    onlineManager.setOnline(true);
  });
  fireEvent.click(cardButton(4));
  await settled();
  expect(within(side()).queryByRole("button", { name: "Dispatch" })).toBeNull();
  cleanup();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed ticket={5} />,
  });
  await graphic();
  expect(side().dataset["ticket"]).toBe("5");
  expect(within(side()).queryByRole("button", { name: "Dispatch" })).toBeNull();
});

test("the key holds Done, Running, Ready and Blocked, and Escalated where a member is", async () => {
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const key = () =>
    within(screen.getByRole("list", { name: "Key" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
  expect(key()).toStrictEqual(["Done", "Running", "Ready", "Blocked"]);
  expect(
    screen.getByText("Arrows run from a ticket to what waits on it"),
  ).toBeTruthy();
  cleanup();
  epicServing.graph = {
    ...epicGraph,
    nodes: epicGraph.nodes.map((node) =>
      node.ticket === 5 ? { ...node, phase: "Escalated" } : node,
    ),
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(key()).toStrictEqual([
    "Done",
    "Running",
    "Ready",
    "Blocked",
    "Escalated",
  ]);
});

test("the tickets outside the epic are smaller dashed cards with dashed edges, and the toggle leaves them out", async () => {
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  const drawing = await graphic();
  const outside = drawing.querySelector(".epic-card[data-outside]");
  expect(outside?.getAttribute("data-ticket")).toBe("2");
  const box = (ticket: number) =>
    card(ticket).parentElement?.getAttribute("width");
  expect(Number(box(2))).toBeLessThan(Number(box(4)));
  expect(
    drawing.querySelectorAll("path.epic-graph-edge[data-outside]"),
  ).toHaveLength(1);
  const toggle = screen.getByRole("checkbox", {
    name: "Show tickets outside the epic (1)",
  });
  fireEvent.click(toggle);
  await settled();
  expect(document.querySelectorAll(".epic-card[data-outside]")).toHaveLength(0);
  expect(document.querySelectorAll("path.epic-graph-edge")).toHaveLength(1);
});

test("a graph with no tickets outside the epic offers no toggle", async () => {
  epicServing.graph = {
    nodes: epicGraph.nodes.filter((node) => node.member),
    edges: [{ from: 4, to: 5 }],
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

test("a queued member's card draws its place in the landing queue", async () => {
  epicServing.queues = {
    queues: [
      {
        repository: "https://forge.test/acme/billing",
        holder: 9,
        waiting: [5],
      },
    ],
    truncated: false,
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const chip = card(5).querySelector<HTMLElement>(".landing-queue-chip");
  expect(chip?.textContent).toBe("2/2");
  expect(chip?.getAttribute("title")).toBe(
    "Waiting 2 of 2 to land: #9 holds https://forge.test/acme/billing's default branch",
  );
  expect(card(4).querySelector(".landing-queue-chip")).toBeNull();
});

test("a queue read that fails draws no chip and leaves every card drawn", async () => {
  epicServing.queuesStatus = 500;
  const { client } = await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed />,
  });
  await vi.waitFor(() => {
    expect(
      client.getQueryState(landingQueuesQuery(leadPartition).queryKey)?.status,
    ).toBe("error");
  });
  await settled();
  await graphic();
  expect(document.querySelectorAll(".epic-card")).toHaveLength(3);
  expect(document.querySelector(".landing-queue-chip")).toBeNull();
});

test("the rendered graph carries no style attribute", async () => {
  chainServed();
  epicServing.queues = {
    queues: [
      { repository: "https://forge.test/acme/billing", holder: 5, waiting: [] },
    ],
    truncated: false,
  };
  await epicPageDrawn(abilitiesEvery, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  fireEvent.mouseEnter(cardButton(6));
  const drawn = [
    document.querySelector(".epic-graph-scroll"),
    screen.getByRole("list", { name: "Unlinked tickets" }),
    side(),
  ];
  expect(
    drawn.reduce(
      (count, part) =>
        count + (part?.querySelectorAll(".epic-card").length ?? 0),
      0,
    ),
  ).toBe(7);
  for (const part of drawn) {
    expect(part?.hasAttribute("style")).toBe(false);
    expect(
      [...(part?.querySelectorAll("[style]") ?? [])].map(
        (each) => each.outerHTML,
      ),
    ).toStrictEqual([]);
  }
});

test("an epic with no tickets draws no graph and says there is nothing to draw", async () => {
  epicServing.graph = { nodes: [], edges: [] };
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  expect(screen.getByText("This epic has no tickets to draw")).toBeTruthy();
  expect(
    screen.queryByRole("group", { name: /^Tickets of the epic/u }),
  ).toBeNull();
});

test("a graph that cannot be read says so where the graph would be", async () => {
  epicServing.graphStatus = 500;
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  expect(screen.getByText("The graph could not be read.")).toBeTruthy();
});

/** Every read but the graph's made again, as another's write would leave them. */
async function refetchedButGraph(client: QueryClient): Promise<void> {
  const graphKey = JSON.stringify(epicGraphQuery(leadPartition, 7).queryKey);
  await client.refetchQueries({
    predicate: (query) => JSON.stringify(query.queryKey) !== graphKey,
  });
  await settled();
}

function graphGets(sent: readonly { method: string; url: string }[]): number {
  return sent.filter(
    (request) => request.method === "GET" && request.url.endsWith("/graph"),
  ).length;
}

test("the graph is read again when the epic's revision moves and when the project's tickets do", async () => {
  const { sent, client } = await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed />,
  });
  await graphic();
  const first = graphGets(sent);
  await refetchedButGraph(client);
  expect(graphGets(sent)).toBe(first);
  epicServing.view = { ...epicView, revision: 4 };
  await refetchedButGraph(client);
  const afterRevision = graphGets(sent);
  expect(afterRevision).toBe(first + 1);
  epicServing.rows = [epicRow(5, "Work", { status: "Running", cycle: 1 })];
  await refetchedButGraph(client);
  expect(graphGets(sent)).toBe(afterRevision + 1);
});
