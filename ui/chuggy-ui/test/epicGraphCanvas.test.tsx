/**
 * An epic's graph on its overview: the cards and what each says, the toggle
 * for the tickets outside the epic, the view's controls and full screen, the
 * states before and without a graph, the reads that draw it again, and the
 * trains on its running members.
 */

import type { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { epicGraphQuery } from "../app/core/epics.ts";
import {
  epicGraph,
  epicPageDrawn,
  epicRow,
  epicServing,
  epicServingReset,
  epicView,
} from "./epicPageFixture.tsx";
import { leadPartition } from "./leadFixture.ts";
import { abilitiesNone } from "./projectAbilitiesFixture.ts";
import { settled } from "./screenHarness.tsx";

vi.mock(
  "@tanstack/react-router",
  async () => (await import("./epicPageRouter.tsx")).epicRouterDouble,
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  epicServingReset();
});

async function canvas(): Promise<SVGSVGElement> {
  return (await screen.findByRole("group", {
    name: "Tickets of the epic and what they wait on",
  })) as unknown as SVGSVGElement;
}

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

test("each card is a link to its ticket naming it, an untitled one as Untitled", async () => {
  epicServing.graph = {
    ...epicGraph,
    nodes: [...epicGraph.nodes, { ticket: 6, phase: "Pending", member: true }],
  };
  await epicPageDrawn(abilitiesNone);
  const graphic = await canvas();
  const links = [...graphic.querySelectorAll("a.epic-card-link")];
  expect(
    links.map((link) => [
      link.getAttribute("aria-label"),
      link.getAttribute("title"),
      link.getAttribute("href"),
    ]),
  ).toContainEqual([
    "Open ticket #4: Charge",
    "Charge",
    `/${leadPartition.tenant}/${leadPartition.project}/tickets/4`,
  ]);
  const untitled = graphic.querySelector('[data-ticket="6"]');
  expect(untitled?.querySelector(".epic-card-title")?.textContent).toBe(
    "Untitled",
  );
  expect(untitled?.querySelector(".epic-card-number")?.textContent).toBe("#6");
});

test("a member with a run under way names it in its footer, and one without has none", async () => {
  epicServing.rows = [
    epicRow(4, "Done"),
    epicRow(5, "Work", { status: "Running", cycle: 2 }),
  ];
  await epicPageDrawn(abilitiesNone);
  const graphic = await canvas();
  const run = graphic.querySelector('[data-ticket="5"] .epic-card-run');
  expect(run?.textContent).toBe("Work");
  expect(run?.getAttribute("title")).toBe("Work in cycle 2");
  expect(graphic.querySelector('[data-ticket="4"] .epic-card-foot')).toBeNull();
});

test("the tickets outside the epic are drawn dashed and smaller, and the toggle leaves them out", async () => {
  await epicPageDrawn(abilitiesNone);
  const graphic = await canvas();
  expect(graphic.querySelectorAll("[data-outside].epic-card")).toHaveLength(1);
  expect(
    graphic.querySelectorAll("path.epic-graph-connector[data-outside]"),
  ).toHaveLength(1);
  const toggle = screen.getByRole("checkbox", {
    name: "Show tickets outside the epic (1)",
  });
  expect(toggle.getAttribute("aria-checked") ?? "true").toBe("true");
  fireEvent.click(toggle);
  await settled();
  expect(graphic.querySelectorAll("[data-outside]")).toHaveLength(0);
  expect(graphic.querySelectorAll("path.epic-graph-connector")).toHaveLength(1);
});

test("a graph with no tickets outside the epic offers no toggle", async () => {
  epicServing.graph = {
    nodes: epicGraph.nodes.filter((node) => node.member),
    edges: [{ from: 4, to: 5 }],
  };
  await epicPageDrawn(abilitiesNone);
  await canvas();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

test("an epic with no tickets draws no canvas and says there is nothing to draw", async () => {
  epicServing.graph = { nodes: [], edges: [] };
  await epicPageDrawn(abilitiesNone);
  expect(screen.getByText("This epic has no tickets to draw")).toBeTruthy();
  expect(
    screen.queryByRole("group", { name: /^Tickets of the epic/u }),
  ).toBeNull();
});

test("a graph that cannot be read says so where the canvas would be", async () => {
  epicServing.graphStatus = 500;
  await epicPageDrawn(abilitiesNone);
  expect(screen.getByText("The graph could not be read.")).toBeTruthy();
});

test("the zoom controls zoom the view within its bounds, and fit returns it to the fitted view", async () => {
  await epicPageDrawn(abilitiesNone);
  const graphic = await canvas();
  const view = () =>
    graphic.querySelector(":scope > g")?.getAttribute("transform");
  const fitted = view();
  expect(fitted).toMatch(/scale\(1\)$/u);
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(view()).toMatch(/scale\(1\.25\)$/u);
  for (let press = 0; press < 8; press += 1)
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(view()).toMatch(/scale\(2\)$/u);
  for (let press = 0; press < 16; press += 1)
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(view()).toMatch(/scale\(0\.2\)$/u);
  fireEvent.click(screen.getByRole("button", { name: "Fit to view" }));
  expect(view()).toBe(fitted);
});

test("dragging the background pans the view, and the wheel leaves it alone", async () => {
  await epicPageDrawn(abilitiesNone);
  const graphic = await canvas();
  const view = () =>
    graphic.querySelector(":scope > g")?.getAttribute("transform");
  const before = view();
  fireEvent.wheel(graphic, { deltaY: -100 });
  expect(view()).toBe(before);
  fireEvent.pointerDown(graphic, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(graphic, { clientX: 40, clientY: 30 });
  fireEvent.pointerUp(graphic);
  expect(view()).toBe("translate(54 44) scale(1)");
});

test("full screen lays the canvas over the page where the browser has none, and Escape leaves it", async () => {
  await epicPageDrawn(abilitiesNone);
  await canvas();
  const frame = document.querySelector<HTMLElement>(".epic-graph-frame");
  const enter = screen.getByRole("button", { name: "Enter full screen" });
  expect(enter.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(enter);
  expect(frame?.dataset["full"]).toBe("Overlay");
  const exit = screen.getByRole("button", { name: "Exit full screen" });
  expect(exit.getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(frame?.dataset["full"]).toBe("None");
});

test("full screen is the browser's where it grants it, and leaving it is the browser's too", async () => {
  await epicPageDrawn(abilitiesNone);
  await canvas();
  const frame = document.querySelector<HTMLElement>(".epic-graph-frame");
  if (frame === null) throw new Error("the frame is drawn");
  let screened: Element | null = null;
  Object.defineProperty(document, "fullscreenEnabled", {
    configurable: true,
    get: () => true,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => screened,
  });
  const exited = vi.fn(() => Promise.resolve());
  document.exitFullscreen = exited;
  frame.requestFullscreen = () => {
    screened = frame;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  };
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Enter full screen" }));
    await Promise.resolve();
  });
  expect(frame.dataset["full"]).toBe("Screen");
  fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
  expect(exited).toHaveBeenCalledOnce();
  act(() => {
    screened = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  expect(frame.dataset["full"]).toBe("None");
  Reflect.deleteProperty(document, "fullscreenEnabled");
  Reflect.deleteProperty(document, "fullscreenElement");
  Reflect.deleteProperty(document, "exitFullscreen");
});

test("the graph is read again when the epic's revision moves and when the project's tickets do", async () => {
  const { sent, client } = await epicPageDrawn(abilitiesNone);
  await canvas();
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

test("a running member carries a resting train, hidden and never in the way of a press", async () => {
  epicServing.rows = [
    epicRow(4, "Done"),
    epicRow(5, "Work", { status: "Running", cycle: 1 }),
  ];
  await epicPageDrawn(abilitiesNone);
  const graphic = await canvas();
  const trains = graphic.querySelector(".epic-trains");
  expect(trains?.getAttribute("aria-hidden")).toBe("true");
  const train = trains?.querySelector<SVGGElement>(".epic-train");
  expect(train?.dataset["train"]).toBe("Resting");
  expect(train?.dataset["phase"]).toBe("Resting");
});

/** Each read of the project's tickets a ticket's life makes in turn: #4's
 * run ends as it enters Finalization, it comes to be Done, #5 is Ready, and
 * then #5's run begins. */
const relayedReads = [
  [
    epicRow(4, "Finalization", { status: "Terminal", cycle: 1 }),
    epicRow(5, "Pending"),
  ],
  [epicRow(4, "Done", { status: "Terminal", cycle: 1 }), epicRow(5, "Pending")],
  [epicRow(4, "Done", { status: "Terminal", cycle: 1 }), epicRow(5, "Ready")],
  [
    epicRow(4, "Done", { status: "Terminal", cycle: 1 }),
    epicRow(5, "Work", { status: "Running", cycle: 1 }),
  ],
];

async function relayed(
  motion: boolean,
): Promise<{ train: SVGGElement | null; client: QueryClient }> {
  epicServing.rows = [
    epicRow(4, "Work", { status: "Running", cycle: 1 }),
    epicRow(5, "Pending"),
  ];
  const { client } = await epicPageDrawn(abilitiesNone, { motion });
  const graphic = await canvas();
  for (const rows of relayedReads) {
    epicServing.rows = rows;
    await client.refetchQueries();
    await settled();
    await settled();
  }
  return { train: graphic.querySelector<SVGGElement>(".epic-train"), client };
}

test("a dependency finishing as its dependent starts sends a train along the connector between them", async () => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const { train } = await relayed(true);
  expect(train?.dataset["train"]).toBe("Relaying");
  expect(train?.dataset["phase"]).toBe("Departing");
});

test("a read that leaves a relaying train's member running keeps the same train moving", async () => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const { train, client } = await relayed(true);
  epicServing.rows = [
    epicRow(2, "Done", { status: "Terminal", cycle: 1 }),
    ...(relayedReads.at(-1) ?? []),
  ];
  await client.refetchQueries();
  await settled();
  await settled();
  expect(train?.isConnected).toBe(true);
  expect(train?.dataset["train"]).toBe("Relaying");
  expect(train?.dataset["phase"]).toBe("Departing");
});

test("a reader who takes no motion is drawn the relayed train already at rest on its dependent", async () => {
  const { train } = await relayed(false);
  expect(train?.dataset["train"]).toBe("Relaying");
  expect(train?.dataset["phase"]).toBe("Resting");
});
