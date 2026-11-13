/**
 * An epic's graph on its Graph tab: its layers and the cards in each, what a
 * card says and its ports, the goal, the ticket in focus and what it dims,
 * when a pointer or the keyboard previews one and when touch does not, the
 * lines and the ports they light, when the cards are measured and which are
 * written, the longest chain and its toggle, the ticket selected and how it is
 * cleared, the side panel with a ticket and without one, its dispatch, the
 * sheet in its place on a phone with its pills, the room it leaves and the
 * scroll a pill makes, the key, the toggle for the tickets outside the epic, the states before and
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
import { viewportNarrowEm } from "../app/browser/shell/viewport.ts";
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
  vi.useRealTimers();
  vi.restoreAllMocks();
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

/** A pointer of the kind given coming onto a card's button, or leaving it. */
function pointed(ticket: number, onto: boolean, pointerType = "mouse"): void {
  (onto ? fireEvent.pointerEnter : fireEvent.pointerLeave)(cardButton(ticket), {
    pointerType,
  });
}

/** The clock moved on by a span, with what it brings drawn. */
function waited(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

test("a pointer previews a card once it has rested on it, keeping its chain as it is and dimming the rest, and the preview ends after it leaves", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed ticket={8} />,
  });
  await graphic();
  vi.useFakeTimers();
  expect(dimmed()).toStrictEqual([6, 7, 9]);
  pointed(6, true);
  waited(100);
  expect(dimmed()).toStrictEqual([6, 7, 9]);
  waited(10);
  expect(dimmed()).toStrictEqual([8, 9]);
  pointed(6, false);
  waited(230);
  expect(dimmed()).toStrictEqual([8, 9]);
  waited(10);
  expect(dimmed()).toStrictEqual([6, 7, 9]);
});

test("a pointer moving from one card straight onto the next switches the preview without passing through rest", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  vi.useFakeTimers();
  pointed(6, true);
  waited(110);
  expect(dimmed()).toStrictEqual([8, 9]);
  pointed(6, false);
  pointed(8, true);
  for (let at = 0; at < 10; at += 1) {
    waited(10);
    expect(dimmed()).toStrictEqual([8, 9]);
  }
  waited(10);
  expect(dimmed()).toStrictEqual([6, 7, 9]);
  waited(500);
  expect(dimmed()).toStrictEqual([6, 7, 9]);
});

test("the keyboard's focus previews a card at once and its blur ends it, but a focus a pointer's press brings does not", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed ticket={8} />,
  });
  await graphic();
  fireEvent.focus(cardButton(6));
  expect(dimmed()).toStrictEqual([8, 9]);
  fireEvent.blur(cardButton(6));
  expect(dimmed()).toStrictEqual([6, 7, 9]);
  fireEvent.pointerDown(cardButton(6), { pointerType: "mouse" });
  fireEvent.focus(cardButton(6));
  expect(dimmed()).toStrictEqual([6, 7, 9]);
});

test("touch never previews, and a tap selects", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  vi.useFakeTimers();
  pointed(6, true, "touch");
  waited(500);
  expect(dimmed()).toStrictEqual([]);
  fireEvent.pointerDown(cardButton(6), { pointerType: "touch" });
  fireEvent.focus(cardButton(6));
  fireEvent.pointerUp(cardButton(6), { pointerType: "touch" });
  fireEvent.click(cardButton(6));
  pointed(6, false, "touch");
  expect(pressed()).toStrictEqual([6]);
  fireEvent.click(cardButton(6));
  waited(500);
  expect(pressed()).toStrictEqual([]);
  expect(dimmed()).toStrictEqual([]);
});

/** The kinds of line each layer of lines draws, behind first, and which
 * layer is shown. */
function lined(): readonly (readonly [boolean, readonly string[]])[] {
  return [...document.querySelectorAll(".epic-graph-lines-look")].map(
    (layer) => [
      layer.hasAttribute("data-shown"),
      [...layer.querySelectorAll("path")].map(
        (path) => path.getAttribute("data-kind") ?? "",
      ),
    ],
  );
}

function lit(): readonly string[] {
  return [
    ...document.querySelectorAll<HTMLElement>(".epic-card-port[data-lit]"),
  ]
    .map(
      (port) =>
        `${port.dataset["ticket"] ?? ""}>${port.closest<HTMLElement>(".epic-card")?.dataset["ticket"] ?? ""}`,
    )
    .sort();
}

test("at rest the longest chain is drawn, and a ticket in focus draws its lines in a new layer over the last, lighting the ports they land on", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const lines = document.querySelector(".epic-graph-lines");
  expect(lines?.getAttribute("aria-hidden")).toBe("true");
  expect(lines?.nextElementSibling).toBe(await graphic());
  expect(lined()).toStrictEqual([
    [false, []],
    [true, ["chain"]],
  ]);
  expect(lit()).toStrictEqual([]);
  fireEvent.click(cardButton(5));
  expect(lined()).toStrictEqual([
    [false, ["chain"]],
    [true, ["faint", "strong", "met", "knots"]],
  ]);
  expect(lit()).toStrictEqual(["2>5", "4>5", "5>6", "5>8"]);
  fireEvent.focus(cardButton(5));
  expect(lined()).toStrictEqual([
    [false, ["chain"]],
    [true, ["faint", "strong", "met", "knots"]],
  ]);
  fireEvent.focus(cardButton(9));
  expect(lined()).toStrictEqual([
    [false, ["faint", "strong", "met", "knots"]],
    [true, []],
  ]);
  expect(lit()).toStrictEqual([]);
});

const largeFirst = 520;
const largeMembers = 61;

/** An epic shaped like a large one: members whose numbers rise along every
 * edge, and a goal that waits on every other member. */
function largeServed(): number {
  const goal = largeFirst + largeMembers - 1;
  const tickets = Array.from(
    { length: largeMembers },
    (_, at) => largeFirst + at,
  );
  const edges = tickets
    .filter((ticket) => ticket !== goal)
    .flatMap((ticket) => [
      { from: ticket, to: goal },
      ...[7, 13]
        .map((stride) => ticket + stride)
        .filter((to) => to < goal)
        .map((to) => ({ from: ticket, to })),
    ]);
  epicServing.view = { ...epicView, tickets };
  epicServing.graph = {
    nodes: tickets.map((ticket, at) => ({
      ticket,
      title: `Part ${String(at)}`,
      phase: at < 12 ? "Done" : "Pending",
      member: true,
    })),
    edges,
  };
  epicServing.rows = [];
  return goal;
}

test("pointing at the goal of a large epic reads no layout and draws a handful of paths", async () => {
  const goal = largeServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  expect(card(goal).hasAttribute("data-goal")).toBe(true);
  vi.useFakeTimers();
  const read = vi.spyOn(Element.prototype, "getBoundingClientRect");
  pointed(goal, true);
  waited(110);
  expect(card(goal).querySelectorAll(".epic-card-port[data-lit]")).toHaveLength(
    largeMembers - 1,
  );
  expect(read).not.toHaveBeenCalled();
  expect(
    document.querySelectorAll(".epic-graph-lines path").length,
  ).toBeLessThanOrEqual(6);
  pointed(goal, false);
  waited(240);
  expect(read).not.toHaveBeenCalled();
});

test("only the cards whose drawing changes are written when a ticket is previewed", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  const written = new Set<string>();
  const watch = new MutationObserver((records) => {
    for (const record of records) {
      const target =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement;
      const at = target?.closest<HTMLElement>(".epic-card")?.dataset["ticket"];
      if (at !== undefined) written.add(at);
    }
  });
  watch.observe(await graphic(), {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  fireEvent.focus(cardButton(8));
  await Promise.resolve();
  watch.disconnect();
  expect([...written].sort()).toStrictEqual(["6", "7", "8", "9"]);
  expect(dimmed()).toStrictEqual([6, 7, 9]);
});

test("the cards are measured again when the drawing changes size, which redraws the shown layer's lines without a new one", async () => {
  const observed: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element): void {
        if (target.classList.contains("epic-graph-drawing"))
          observed.push(this.callback);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  chainServed();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed ticket={5} />,
  });
  await graphic();
  const shown = document.querySelector(".epic-graph-lines-look[data-shown]");
  const before = shown
    ?.querySelector('[data-kind="strong"]')
    ?.getAttribute("d");
  const read = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function placed(this: Element) {
      const ticket = Number(
        this.closest<HTMLElement>(".epic-card")?.dataset["ticket"] ?? 0,
      );
      return new DOMRect(ticket * 10, ticket * 20, 100, 50);
    });
  const resized = (width: number) => {
    act(() => {
      for (const callback of observed)
        callback(
          [{ contentRect: new DOMRect(0, 0, width, 0) } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
    });
  };
  resized(0);
  expect(read).not.toHaveBeenCalled();
  resized(800);
  expect(read).toHaveBeenCalled();
  const after = document.querySelector(".epic-graph-lines-look[data-shown]");
  expect(after).toBe(shown);
  expect(
    after?.querySelector('[data-kind="strong"]')?.getAttribute("d"),
  ).not.toBe(before);
  expect(lined().filter(([isShown]) => isShown)).toHaveLength(1);
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
  expect(document.querySelector(".epic-graph-sheet")).toBeNull();
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

test("the chain toggle turned off with nothing selected comes back on when a selection is made and cleared", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTabAddressed /> });
  await graphic();
  fireEvent.click(chainToggle());
  expect(chainToggle().getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(cardButton(6));
  expect(chainToggle().getAttribute("aria-pressed")).toBe("false");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(pressed()).toStrictEqual([]);
  expect(chainToggle().getAttribute("aria-pressed")).toBe("true");
  expect(stepped()).toHaveLength(4);
  fireEvent.click(chainToggle());
  fireEvent.click(cardButton(6));
  fireEvent.click(cardButton(6));
  expect(chainToggle().getAttribute("aria-pressed")).toBe("true");
  expect(stepped()).toHaveLength(4);
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

/** A phone's viewport, narrower than the console's narrow breakpoint. */
const phoneEm = 24;

function sheet(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".epic-graph-sheet");
  if (found === null) throw new Error("the sheet is drawn");
  return found;
}

function pill(row: string, name: RegExp): HTMLElement {
  return within(within(sheet()).getByRole("list", { name: row })).getByRole(
    "button",
    { name },
  );
}

test("on a phone the graph takes the screen at rest, and a tapped card rises in a sheet with its head, title, rows of pills and foot", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed />,
    em: phoneEm,
  });
  await graphic();
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(document.querySelector(".epic-graph-sheet-room")).toBeNull();
  fireEvent.click(cardButton(5));
  expect(screen.getAllByRole("complementary")).toStrictEqual([sheet()]);
  expect(sheet().getAttribute("aria-label")).toBe("Selected ticket");
  expect(sheet().dataset["ticket"]).toBe("5");
  expect(sheet().querySelector(".epic-graph-sheet-head")?.textContent).toBe(
    "#5Working",
  );
  expect(within(sheet()).getByRole("button", { name: "Close" })).toBeTruthy();
  expect(within(sheet()).getByRole("heading", { level: 3 }).textContent).toBe(
    "Refund",
  );
  const pills = (name: string) =>
    within(within(sheet()).getByRole("list", { name }))
      .getAllByRole("button")
      .map((button) => [button.textContent, button.getAttribute("aria-label")]);
  expect(pills("Depends on")).toStrictEqual([
    ["2", "#2 Schema: Working"],
    ["4", "#4 Charge: Done"],
  ]);
  expect(pills("Blocks")).toStrictEqual([
    ["6", "#6 Ledger: Blocked"],
    ["8", "#8 Export: Blocked"],
  ]);
  expect(sheet().querySelector(".epic-graph-side-place")?.textContent).toBe(
    "Layer 2 of 4 · Step 2 of 4",
  );
  expect(
    within(sheet())
      .getByRole("link", { name: "Open ticket" })
      .getAttribute("href"),
  ).toBe(`/${leadPartition.tenant}/${leadPartition.project}/tickets/5`);
  expect(sheet().hasAttribute("style")).toBe(false);
  expect(sheet().querySelectorAll("[style]")).toHaveLength(0);
});

test("at exactly the narrow breakpoint, where the sheet's layout already holds, a tapped card rises in the sheet", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed />,
    em: viewportNarrowEm,
  });
  await graphic();
  expect(screen.queryByRole("complementary")).toBeNull();
  fireEvent.click(cardButton(5));
  expect(screen.getAllByRole("complementary")).toStrictEqual([sheet()]);
});

test("just above the narrow breakpoint a selected ticket is in the side panel and no sheet", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed />,
    em: viewportNarrowEm + 1 / 16,
  });
  await graphic();
  expect(document.querySelector(".epic-graph-sheet")).toBeNull();
  fireEvent.click(cardButton(5));
  expect(side().dataset["ticket"]).toBe("5");
  expect(document.querySelector(".epic-graph-sheet")).toBeNull();
});

test("a pill in the sheet selects its ticket, and Close and Escape each clear the selection and bring the chain back", async () => {
  chainServed();
  const written: (number | undefined)[] = [];
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed ticket={6} written={written} />,
    em: phoneEm,
  });
  await graphic();
  expect(chainToggle().getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(pill("Depends on", /^#5 /u));
  expect(sheet().dataset["ticket"]).toBe("5");
  expect(pressed()).toStrictEqual([5]);
  fireEvent.click(within(sheet()).getByRole("button", { name: "Close" }));
  expect(document.querySelector(".epic-graph-sheet")).toBeNull();
  expect(pressed()).toStrictEqual([]);
  expect(chainToggle().getAttribute("aria-pressed")).toBe("true");
  expect(stepped()).toHaveLength(4);
  fireEvent.click(cardButton(8));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(document.querySelector(".epic-graph-sheet")).toBeNull();
  expect(chainToggle().getAttribute("aria-pressed")).toBe("true");
  expect(written).toStrictEqual([5, undefined, 8, undefined]);
});

test("dispatch is offered in the sheet where the side panel offers it", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  await epicPageDrawn(abilitiesEvery, {
    tab: <EpicGraphTabAddressed ticket={5} />,
    em: phoneEm,
  });
  await graphic();
  expect(
    await within(sheet()).findByRole("button", { name: "Dispatch" }),
  ).toBeTruthy();
  fireEvent.click(cardButton(4));
  await settled();
  expect(
    within(sheet()).queryByRole("button", { name: "Dispatch" }),
  ).toBeNull();
});

/** Observers that hear only what a case says: the sheet's size, as a browser
 * reports it once the sheet is drawn and again when it resizes. */
function sheetObserved(): (height: number) => void {
  const held: { callback: ResizeObserverCallback; targets: Element[] }[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly entry: (typeof held)[number];
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, targets: [] };
        held.push(this.entry);
      }
      observe(target: Element): void {
        this.entry.targets.push(target);
      }
      disconnect(): void {
        this.entry.targets = [];
      }
    },
  );
  return (height) => {
    for (const { callback, targets } of held)
      for (const target of targets.filter((each) =>
        each.classList.contains("epic-graph-sheet"),
      ))
        act(() => {
          callback(
            [
              {
                target,
                borderBoxSize: [{ blockSize: height, inlineSize: 390 }],
                contentRect: new DOMRect(0, 0, 390, height),
              } as unknown as ResizeObserverEntry,
            ],
            {} as ResizeObserver,
          );
        });
  };
}

test("while the sheet is open the page gains room its height under the graph, and loses it when the sheet closes", async () => {
  chainServed();
  const resized = sheetObserved();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed />,
    em: phoneEm,
  });
  await graphic();
  fireEvent.click(cardButton(5));
  const room = () =>
    document.querySelector(".epic-graph-sheet-room")?.getAttribute("height");
  resized(240);
  expect(room()).toBe("240");
  resized(212);
  expect(room()).toBe("212");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(room()).toBeUndefined();
});

test("a ticket selected from the sheet has its card scrolled to the middle of the room above the sheet, unless it is in view there", async () => {
  chainServed();
  await epicPageDrawn(abilitiesNone, {
    tab: <EpicGraphTabAddressed />,
    em: phoneEm,
  });
  await graphic();
  const boxes = new Map<number, readonly [number, number]>([
    [4, [900, 980]],
    [5, [100, 180]],
    [6, [-300, -220]],
  ]);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      if (this.classList.contains("epic-graph-sheet"))
        return new DOMRect(0, 600, 390, 244);
      const at = boxes.get(
        Number((this as HTMLElement).dataset["ticket"] ?? Number.NaN),
      );
      return at === undefined
        ? new DOMRect(0, 0, 0, 0)
        : new DOMRect(0, at[0], 180, at[1] - at[0]);
    },
  );
  const scrolled = vi
    .spyOn(window, "scrollBy")
    .mockImplementation(() => undefined);
  fireEvent.click(cardButton(5));
  expect(scrolled).not.toHaveBeenCalled();
  fireEvent.click(pill("Depends on", /^#4 /u));
  expect(sheet().dataset["ticket"]).toBe("4");
  expect(scrolled.mock.calls).toStrictEqual([[{ top: 640, behavior: "auto" }]]);
  fireEvent.click(pill("Blocks", /^#5 /u));
  expect(sheet().dataset["ticket"]).toBe("5");
  fireEvent.click(pill("Blocks", /^#6 /u));
  expect(scrolled.mock.calls).toStrictEqual([
    [{ top: 640, behavior: "auto" }],
    [{ top: -560, behavior: "auto" }],
  ]);
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
  fireEvent.focus(cardButton(6));
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
