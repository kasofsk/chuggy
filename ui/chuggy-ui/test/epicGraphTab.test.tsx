/**
 * An epic's graph on its Graph tab: its layers and the cards in each, what a
 * card says and its ports, the goal, the ticket in focus and what it dims,
 * the longest chain and its toggle, the ticket selected and how it is
 * cleared, the side panel with a ticket and without one, its dispatch, the
 * key, the toggle for the tickets outside the epic, the states before and
 * without a graph, and the reads that draw it again.
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
  vi.unstubAllGlobals();
  epicServingReset();
  onlineManager.setOnline(true);
});

/** The tab under an address that starts at the ticket given, and is written
 * where a selection asks, as the route writes its search. */
function EpicGraphTabAddressed(props: {
  readonly ticket?: number;
  readonly written?: (number | undefined)[];
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

async function graphic(): Promise<HTMLElement> {
  return screen.findByRole("list", {
    name: "Tickets of the epic and what they wait on",
  });
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

function dimmed(): readonly number[] {
  return [...document.querySelectorAll<HTMLElement>(".epic-card[data-dim]")]
    .map((each) => Number(each.dataset["ticket"]))
    .sort((left, right) => left - right);
}

function stepped(): readonly (readonly [number, number])[] {
  return [...document.querySelectorAll<HTMLElement>(".epic-card[data-step]")]
    .map(
      (each) =>
        [Number(each.dataset["ticket"]), Number(each.dataset["step"])] as const,
    )
    .sort((left, right) => left[1] - right[1]);
}

function side(): HTMLElement {
  return screen.getByRole("complementary", { name: "Selected ticket" });
}

function summary(): HTMLElement {
  return screen.getByRole("complementary", { name: "Epic at a glance" });
}

function chainToggle(): HTMLElement {
  return screen.getByRole("button", { name: /^Longest chain/u });
}

function listed(within_: HTMLElement, name: string): readonly string[] {
  return within(within(within_).getByRole("list", { name }))
    .getAllByRole("button")
    .map((button) => button.textContent);
}

function pressed(): readonly number[] {
  return [
    ...document.querySelectorAll('.epic-card button[aria-pressed="true"]'),
  ].map((button) =>
    Number(button.closest<HTMLElement>(".epic-card")?.dataset["ticket"]),
  );
}

/** Each layer's cards, top to bottom, by the name each list is read by. */
function layers(): readonly (readonly [string, readonly number[]])[] {
  return [...document.querySelectorAll<HTMLElement>(".epic-graph-cards")].map(
    (list) => [
      list.getAttribute("aria-label") ?? "",
      [...list.querySelectorAll<HTMLElement>(".epic-card")].map((each) =>
        Number(each.dataset["ticket"]),
      ),
    ],
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

test("a card is a button holding its state's mark and its number, then its title, and no dispatch nor run", async () => {
  chainServed();
  await epicPageDrawn(abilitiesEvery, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const running = card(5);
  const head = running.querySelector(".epic-card-head");
  expect(
    [...(head?.children ?? [])].map((child) => child.className),
  ).toStrictEqual(["epic-card-mark", "epic-card-number"]);
  expect(
    head?.querySelector(".epic-card-mark svg.ticket-state-mark"),
  ).not.toBeNull();
  expect(running.querySelector(".epic-card-number")?.textContent).toBe("5");
  expect(running.querySelector(".epic-card-title")?.textContent).toBe("Refund");
  expect(running.dataset["standing"]).toBe("Work");
  expect(running.dataset["tone"]).toBe("live");
  expect(card(4).dataset["standing"]).toBe("Done");
  expect(card(6).dataset["standing"]).toBe("Blocked");
  expect(card(2).dataset["standing"]).toBe("Work");
  expect(cardButton(5).getAttribute("aria-label")).toMatch(
    /^#5 Refund: .+, 1 of 2 dependencies done$/u,
  );
  expect(cardButton(6).getAttribute("aria-label")).toMatch(
    /^#6 Ledger: .+, 0 of 1 dependency done$/u,
  );
  expect(cardButton(2).getAttribute("aria-label")).toMatch(
    /^#2 Schema: [^,]+, outside the epic$/u,
  );
  expect(card(2).querySelector(".epic-card-outside")?.textContent).toBe(
    "outside",
  );
  expect(card(5).querySelector(".epic-card-outside")).toBeNull();
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
});

test("each layer is a list of its cards by standing then number, read with its done count, and a ticket with no edge is in the first", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(layers()).toStrictEqual([
    ["Layer 1: 1 of 3 done", [4, 2, 9]],
    ["Layer 2: 0 of 1 done", [5]],
    ["Layer 3: 0 of 2 done", [6, 8]],
    ["Layer 4: 0 of 1 done", [7]],
  ]);
  const gutter = document.querySelector('.epic-graph-layer[data-layer="1"]');
  expect(gutter?.querySelector(".epic-graph-layer-number")?.textContent).toBe(
    "1",
  );
  expect(gutter?.querySelector(".epic-graph-layer-done")?.textContent).toBe(
    "1/3",
  );
  expect(
    gutter?.querySelector(".epic-graph-spine-fill")?.getAttribute("height"),
  ).toBe(String(100 / 3));
  expect(screen.queryByRole("list", { name: "Unlinked tickets" })).toBeNull();
  expect(document.querySelector("svg.epic-graph-canvas")).toBeNull();
  expect(document.querySelector("[data-goal]")).toBeNull();
});

test("a card's ports are a dot per dependency in placed order, filled where it is Done", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const ports = (ticket: number) =>
    [...card(ticket).querySelectorAll(".epic-card-port")].map((port) =>
      port.hasAttribute("data-met"),
    );
  expect(ports(5)).toStrictEqual([true, false]);
  expect(ports(6)).toStrictEqual([false]);
  expect(card(4).querySelector(".epic-card-ports")).toBeNull();
});

test("the goal, alone on the last layer and waiting on every other member, is one card across the foot that counts what it waits on done", async () => {
  epicServing.graph = {
    nodes: [
      { ticket: 4, title: "Charge", phase: "Done", member: true },
      { ticket: 5, title: "Refund", phase: "Pending", member: true },
      { ticket: 6, title: "Ledger", phase: "Done", member: true },
      { ticket: 7, title: "Ship", phase: "Pending", member: true },
    ],
    edges: [
      { from: 4, to: 5 },
      { from: 5, to: 7 },
      { from: 6, to: 7 },
      { from: 4, to: 7 },
    ],
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(card(7).hasAttribute("data-goal")).toBe(true);
  expect(card(7).closest(".epic-graph-cards")?.hasAttribute("data-goal")).toBe(
    true,
  );
  expect(card(7).querySelector(".epic-card-goal")?.textContent).toBe(
    "2 of 3 done",
  );
  expect(document.querySelectorAll(".epic-card[data-goal]")).toHaveLength(1);
});

test("a title's label is a kicker, unless more than half the cards carry the same one", async () => {
  epicServing.graph = {
    nodes: [
      { ticket: 4, title: "API: Charge", phase: "Done", member: true },
      { ticket: 5, title: "Gate: Refund", phase: "Pending", member: true },
      { ticket: 6, title: "API: Ledger", phase: "Pending", member: true },
    ],
    edges: [{ from: 4, to: 5 }],
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const said = (ticket: number) => [
    card(ticket).querySelector(".epic-card-kicker")?.textContent,
    card(ticket).querySelector(".epic-card-title")?.textContent,
  ];
  expect(said(4)).toStrictEqual([undefined, "Charge"]);
  expect(said(5)).toStrictEqual(["Gate", "Refund"]);
  expect(cardButton(4).getAttribute("aria-label")).toMatch(/^#4 API: Charge:/u);
});

test("hovering and focusing a card keep its chain up and down as it is and dim the rest, a preview over the selection", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed ticket={8} />,
  });
  await graphic();
  expect(dimmed()).toStrictEqual([6, 7, 9]);
  fireEvent.mouseEnter(cardButton(6));
  expect(dimmed()).toStrictEqual([8, 9]);
  fireEvent.mouseLeave(cardButton(6));
  expect(dimmed()).toStrictEqual([6, 7, 9]);
  fireEvent.focus(cardButton(6));
  expect(dimmed()).toStrictEqual([8, 9]);
  fireEvent.blur(cardButton(6));
  expect(dimmed()).toStrictEqual([6, 7, 9]);
});

test("with none named nothing is selected, nothing is dimmed, and the longest chain is pressed and stepped", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(pressed()).toStrictEqual([]);
  expect(dimmed()).toStrictEqual([]);
  expect(chainToggle().getAttribute("aria-pressed")).toBe("true");
  expect(chainToggle().textContent).toBe("Longest chain 4");
  expect(stepped()).toStrictEqual([
    [2, 1],
    [5, 2],
    [6, 3],
    [7, 4],
  ]);
  expect(card(2).querySelector(".epic-card-step")?.textContent).toBe("1");
  fireEvent.click(chainToggle());
  expect(chainToggle().getAttribute("aria-pressed")).toBe("false");
  expect(stepped()).toStrictEqual([]);
});

test("with nothing selected the side panel lists the longest chain, what is running, and what is Ready, each selecting its ticket", async () => {
  chainServed();
  const written: (number | undefined)[] = [];
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed written={written} />,
  });
  await graphic();
  const panel = summary();
  expect(
    [...panel.querySelectorAll(".epic-graph-side-heading")].map(
      (heading) => heading.textContent,
    ),
  ).toStrictEqual(["Longest chain4", "Running2", "Ready1"]);
  expect(listed(panel, "Longest chain")).toStrictEqual([
    "#2 Schema",
    "#5 Refund",
    "#6 Ledger",
    "#7 Report",
  ]);
  expect(listed(panel, "Running")).toStrictEqual(["#2 Schema", "#5 Refund"]);
  expect(listed(panel, "Ready")).toStrictEqual(["#9 Audit"]);
  fireEvent.click(within(panel).getByRole("button", { name: "#9 Audit" }));
  expect(side().dataset["ticket"]).toBe("9");
  expect(written).toStrictEqual([9]);
});

test("with nothing running the summary leaves Running out, and with nothing Ready it says None", async () => {
  epicServing.graph = {
    nodes: [
      { ticket: 4, title: "Charge", phase: "Done", member: true },
      { ticket: 5, title: "Refund", phase: "Pending", member: true },
      { ticket: 6, title: "Ledger", phase: "Pending", member: true },
    ],
    edges: [
      { from: 4, to: 5 },
      { from: 6, to: 5 },
    ],
  };
  epicServing.rows = [];
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(within(summary()).queryByRole("list", { name: "Running" })).toBeNull();
  expect(listed(summary(), "Ready")).toStrictEqual(["#6 Ledger"]);
  cleanup();
  epicServing.graph = {
    nodes: [{ ticket: 4, title: "Charge", phase: "Done", member: true }],
    edges: [],
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(within(summary()).getAllByText("None")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /^Longest chain/u })).toBeNull();
});

test("a click, an Enter and the address each select a card, which the address is written with", async () => {
  chainServed();
  const written: (number | undefined)[] = [];
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

test("pressing the selected card again and Escape each clear the selection, and the chain toggle follows it", async () => {
  chainServed();
  const written: (number | undefined)[] = [];
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed written={written} />,
  });
  await graphic();
  fireEvent.click(cardButton(6));
  expect(pressed()).toStrictEqual([6]);
  expect(chainToggle().getAttribute("aria-pressed")).toBe("false");
  expect(stepped()).toStrictEqual([]);
  fireEvent.click(cardButton(6));
  expect(pressed()).toStrictEqual([]);
  expect(summary()).toBeTruthy();
  expect(chainToggle().getAttribute("aria-pressed")).toBe("true");
  expect(stepped()).toHaveLength(4);
  fireEvent.click(cardButton(8));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(pressed()).toStrictEqual([]);
  expect(chainToggle().getAttribute("aria-pressed")).toBe("true");
  expect(written).toStrictEqual([6, undefined, 8, undefined]);
});

test("the selected ticket's panel says its layer and step, and how many it depends on are done", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed ticket={5} />,
  });
  await graphic();
  const panel = side();
  expect(within(panel).getByRole("heading", { level: 3 }).textContent).toBe(
    "Refund",
  );
  expect(panel.querySelector(".epic-graph-side-number")?.textContent).toBe(
    "#5",
  );
  expect(panel.querySelector(".epic-graph-side-place")?.textContent).toBe(
    "Layer 2 of 4 · Step 2 of 4",
  );
  expect(
    [...panel.querySelectorAll(".epic-graph-side-heading")].map(
      (heading) => heading.textContent,
    ),
  ).toStrictEqual(["Depends on1 of 2 done", "Blocks"]);
  expect(listed(panel, "Blocks")).toStrictEqual(["#6 Ledger", "#8 Export"]);
  expect(
    within(panel)
      .getByRole("link", { name: "Open ticket" })
      .getAttribute("href"),
  ).toBe(`/${leadPartition.tenant}/${leadPartition.project}/tickets/5`);
  fireEvent.click(cardButton(8));
  expect(side().querySelector(".epic-graph-side-place")?.textContent).toBe(
    "Layer 3 of 4",
  );
});

test("a ticket the side panel lists selects that ticket when pressed", async () => {
  chainServed();
  const written: (number | undefined)[] = [];
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

test("the key counts the members Done, Running, Ready and Blocked, and Escalated where a member is", async () => {
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const key = () =>
    within(screen.getByRole("list", { name: "Key" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
  expect(key()).toStrictEqual(["Done 1", "Running 0", "Ready 0", "Blocked 1"]);
  expect(
    screen.queryByText("Arrows run from a ticket to what waits on it"),
  ).toBeNull();
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
    "Done 1",
    "Running 0",
    "Ready 0",
    "Blocked 0",
    "Escalated 1",
  ]);
});

test("the tickets outside the epic are dashed tagged cards, and the toggle leaves them and their ports out", async () => {
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const outside = document.querySelector(".epic-card[data-outside]");
  expect(outside?.getAttribute("data-ticket")).toBe("2");
  expect(card(5).querySelectorAll(".epic-card-port")).toHaveLength(2);
  const toggle = screen.getByRole("checkbox", {
    name: "Show tickets outside the epic (1)",
  });
  fireEvent.click(toggle);
  await settled();
  expect(document.querySelectorAll(".epic-card[data-outside]")).toHaveLength(0);
  expect(card(5).querySelectorAll(".epic-card-port")).toHaveLength(1);
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
  const drawn = document.querySelector(".epic-graph-layers");
  expect(drawn?.querySelectorAll(".epic-card")).toHaveLength(7);
  for (const part of [drawn, summary()]) {
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
    screen.queryByRole("list", { name: /^Tickets of the epic/u }),
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
