/**
 * An epic's graph on its overview: the cards and what each says, the toggle
 * for the tickets outside the epic, the view's controls and full screen, the
 * states before and without a graph, the reads that draw it again, and the
 * trains on its running members.
 */

import type { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { EpicGraphResponse } from "../../../src/contract/responses.ts";

import { epicGraphDrawn } from "../app/core/epicGraph.ts";
import { epicGraphQuery } from "../app/core/epics.ts";
import {
  epicTrainEmergingMs,
  epicTrainRestingAt,
} from "../app/core/epicTrains.ts";
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

test("a queued member's footer draws its place beside its run, and a member in no queue draws neither", async () => {
  epicServing.rows = [
    epicRow(4, "Done"),
    epicRow(5, "Work", { status: "Running", cycle: 2 }),
  ];
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
  await epicPageDrawn(abilitiesNone);
  const graphic = await canvas();
  const foot = graphic.querySelector('[data-ticket="5"] .epic-card-foot');
  const chip = foot?.querySelector<HTMLElement>(".landing-queue-chip");
  expect(chip?.previousElementSibling?.className).toBe("epic-card-run");
  expect(chip?.textContent).toBe("2/2");
  expect(chip?.getAttribute("aria-label")).toBe(
    "Waiting 2 of 2 to land: #9 holds the target",
  );
  expect(chip?.getAttribute("title")).toBe(chip?.getAttribute("aria-label"));
  expect(graphic.querySelector('[data-ticket="4"] .epic-card-foot')).toBeNull();
});

test("a queued member with no run draws a footer holding its place alone", async () => {
  epicServing.queues = {
    queues: [
      { repository: "https://forge.test/acme/billing", holder: 4, waiting: [] },
    ],
    truncated: false,
  };
  await epicPageDrawn(abilitiesNone);
  const graphic = await canvas();
  const foot = graphic.querySelector('[data-ticket="4"] .epic-card-foot');
  expect(foot?.querySelector(".epic-card-run")).toBeNull();
  expect(foot?.querySelector(".landing-queue-chip")?.textContent).toBe("1/1");
});

test("a queue read that fails draws no chip and leaves every card drawn", async () => {
  epicServing.queuesStatus = 500;
  const { client } = await epicPageDrawn(abilitiesNone);
  await vi.waitFor(() => {
    expect(
      client.getQueryState(landingQueuesQuery(leadPartition).queryKey)?.status,
    ).toBe("error");
  });
  await settled();
  const graphic = await canvas();
  expect(graphic.querySelectorAll(".epic-card")).toHaveLength(3);
  expect(graphic.querySelector(".landing-queue-chip")).toBeNull();
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

/** Animation frames held until a case runs them, at the moment it names. */
function framesHeld(): { readonly ran: (atMs: number) => void } {
  const waiting = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (step: FrameRequestCallback) => {
    next += 1;
    waiting.set(next, step);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => {
    waiting.delete(frame);
  });
  return {
    ran: (atMs) => {
      const steps = [...waiting.values()];
      waiting.clear();
      vi.spyOn(performance, "now").mockReturnValue(atMs);
      for (const step of steps) step(atMs);
    },
  };
}

async function readAgain(client: QueryClient): Promise<void> {
  await client.refetchQueries();
  await settled();
  await settled();
}

test("leaving the tickets outside the epic out and drawing them again finishes none of them, so a dependent of a Done one has its train emerge", async () => {
  framesHeld();
  epicServing.graph = {
    nodes: [
      { ticket: 2, title: "Schema", phase: "Done", member: false },
      { ticket: 4, title: "Charge", phase: "Pending", member: true },
      { ticket: 5, title: "Refund", phase: "Pending", member: true },
    ],
    edges: [{ from: 2, to: 5 }],
  };
  epicServing.rows = [epicRow(4, "Pending"), epicRow(5, "Pending")];
  const { client } = await epicPageDrawn(abilitiesNone, { motion: true });
  const graphic = await canvas();
  const toggle = screen.getByRole("checkbox", {
    name: "Show tickets outside the epic (1)",
  });
  fireEvent.click(toggle);
  await settled();
  fireEvent.click(toggle);
  await settled();
  epicServing.rows = [
    epicRow(4, "Pending"),
    epicRow(5, "Work", { status: "Running", cycle: 1 }),
  ];
  await readAgain(client);
  const train = graphic.querySelector<SVGGElement>(".epic-train");
  expect(train?.dataset["train"]).toBe("Emerging");
});

test("a train that has come to rest stays at rest on its card when a read moves the card", async () => {
  const frames = framesHeld();
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  const { client } = await epicPageDrawn(abilitiesNone, { motion: true });
  const graphic = await canvas();
  epicServing.rows = [
    epicRow(4, "Done"),
    epicRow(5, "Work", { status: "Running", cycle: 1 }),
  ];
  await readAgain(client);
  const train = graphic.querySelector<SVGGElement>(".epic-train");
  expect(train?.dataset["train"]).toBe("Emerging");
  act(() => {
    frames.ran(1000);
  });
  act(() => {
    frames.ran(1000 + epicTrainEmergingMs);
  });
  expect(train?.dataset["phase"]).toBe("Resting");
  const moved: EpicGraphResponse = {
    nodes: [
      { ticket: 2, title: "Schema", phase: "Work", member: false },
      { ticket: 4, title: "Charge", phase: "Done", member: true },
      { ticket: 5, title: "Refund", phase: "Pending", member: true },
      { ticket: 6, title: "Ledger", phase: "Pending", member: true },
    ],
    edges: [
      { from: 2, to: 5 },
      { from: 4, to: 6 },
      { from: 6, to: 5 },
    ],
  };
  epicServing.graph = moved;
  await readAgain(client);
  const card = epicGraphDrawn(moved, true).cards.find(
    (drawn) => drawn.node.ticket === 5,
  );
  if (card === undefined) throw new Error("the card is drawn");
  const rest = epicTrainRestingAt(card);
  expect(train?.isConnected).toBe(true);
  expect(train?.dataset["phase"]).toBe("Resting");
  expect(train?.getAttribute("transform")).toMatch(
    new RegExp(
      `^translate\\(${String(rest.x)} ${String(rest.y)}\\) scale\\(1\\)`,
      "u",
    ),
  );
});
