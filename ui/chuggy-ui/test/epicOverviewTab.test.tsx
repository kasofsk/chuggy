/**
 * The epic page's Overview: the description as a document, and beside it
 * what is running, what is next, the graph in small and the details.
 */

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  epicGraph,
  epicPageDrawn,
  epicServing,
  epicServingReset,
  epicView,
} from "./epicPageFixture.tsx";
import { leadPartition } from "./leadFixture.ts";
import { abilitiesNone } from "./projectAbilitiesFixture.ts";

vi.mock(
  "@tanstack/react-router",
  async () => (await import("./epicPageRouter.tsx")).epicRouterDouble,
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  epicServingReset();
});

const tickets = `/${leadPartition.tenant}/${leadPartition.project}/tickets`;

function part(name: string): HTMLElement {
  const drawn = document.querySelector<HTMLElement>(
    `.epic-overview-part[data-part="${name}"]`,
  );
  if (drawn === null) throw new Error(`the ${name} part is drawn`);
  return drawn;
}

/** Each ticket a list draws: its number and title, where it links, and what
 * it comes after. */
function listed(name: string): readonly (readonly [string, string, string])[] {
  return [...part(name).querySelectorAll("li")].map((item) => [
    item.querySelector("a")?.textContent ?? "",
    item.querySelector("a")?.getAttribute("href") ?? "",
    item.querySelector(".epic-overview-after")?.textContent ?? "",
  ]);
}

function graphOf(
  nodes: readonly (readonly [number, string, boolean])[],
  edges: readonly (readonly [number, number])[],
): unknown {
  return {
    nodes: nodes.map(([ticket, phase, member]) => ({
      ticket,
      title: `T${String(ticket)}`,
      phase,
      member,
    })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
}

test("Running lists the members at work, each a link, and Next the Ready ones", async () => {
  epicServing.view = { ...epicView, tickets: [4, 5, 6] };
  epicServing.graph = graphOf(
    [
      [4, "Work", true],
      [5, "Pending", true],
      [6, "Pending", true],
    ],
    [[4, 6]],
  );
  await epicPageDrawn(abilitiesNone);
  expect(listed("running")).toStrictEqual([["#4 T4", `${tickets}/4`, ""]]);
  expect(
    part("running").querySelector(".epic-overview-ticket-mark svg"),
  ).not.toBeNull();
  expect(listed("next")).toStrictEqual([["#5 T5", `${tickets}/5`, ""]]);
});

test("with no Ready member, Next is the Blocked members waiting only on running tickets, in the Tickets tab's order, each with what it comes after", async () => {
  epicServing.view = { ...epicView, tickets: [4, 5, 6, 7] };
  epicServing.graph = graphOf(
    [
      [2, "Work", false],
      [3, "Pending", false],
      [4, "Work", true],
      [5, "Pending", true],
      [6, "Pending", true],
      [7, "Pending", true],
    ],
    [
      [4, 6],
      [2, 6],
      [4, 5],
      [3, 7],
    ],
  );
  await epicPageDrawn(abilitiesNone);
  expect(listed("next")).toStrictEqual([
    ["#5 T5", `${tickets}/5`, "after #4"],
    ["#6 T6", `${tickets}/6`, "after #2, #4"],
  ]);
});

test("Running says None where nothing is running", async () => {
  await epicPageDrawn(abilitiesNone);
  expect(part("running").textContent).toBe("RunningNone");
  expect(part("running").querySelector("li")).toBeNull();
});

test("the small graph draws each member a tile in its group, numbered, and the goal a bar, and is a link to the Graph tab", async () => {
  await epicPageDrawn(abilitiesNone);
  const link = within(part("graph")).getByRole("link", {
    name: "Graph of the epic",
  });
  expect(link.getAttribute("href")).toBe(
    `/${leadPartition.tenant}/${leadPartition.project}/epics/7/graph`,
  );
  const tiles = await waitFor(() => {
    const drawn = link.querySelectorAll(".epic-overview-graph-tile");
    expect(drawn).toHaveLength(1);
    return [...drawn];
  });
  expect(
    tiles.map((tile) => [
      tile.getAttribute("data-ticket"),
      tile.getAttribute("data-group"),
      tile.textContent,
    ]),
  ).toStrictEqual([["4", "Done", "4"]]);
  const goal = link.querySelector(".epic-overview-graph-goal");
  expect([
    goal?.getAttribute("data-ticket"),
    goal?.hasAttribute("data-step"),
  ]).toStrictEqual(["5", true]);
  expect(link.querySelector("svg")?.getAttribute("viewBox")).toMatch(
    /^0 0 230 /u,
  );
});

test("the details name the tickets outside it waits on, its revision, and when and by whom it was updated, drawn by email", async () => {
  epicServing.people = [
    {
      subject: "dana",
      mine: false,
      tenantAdmin: false,
      roles: ["Developer"],
      account: true,
      email: "dana@example.com",
    },
  ];
  await epicPageDrawn(abilitiesNone);
  const rows = [...part("details").querySelectorAll("dt")].map((key) => [
    key.textContent,
    key.nextElementSibling?.textContent,
  ]);
  expect(rows.slice(0, 2)).toStrictEqual([
    ["Waiting on outside", "#2"],
    ["Revision", "3"],
  ]);
  expect(rows[2]?.[0]).toBe("Updated");
  expect(rows[2]?.[1]).toMatch(/^.+ · dana@example\.com$/u);
  expect(
    within(part("details"))
      .getByRole("link", { name: "#2" })
      .getAttribute("href"),
  ).toBe(`${tickets}/2`);
});

test("the details say None where the epic waits on nothing outside it", async () => {
  epicServing.view = { ...epicView, waitingOnOutside: [] };
  epicServing.graph = {
    ...epicGraph,
    nodes: epicGraph.nodes.filter((node) => node.member),
  };
  await epicPageDrawn(abilitiesNone);
  expect(part("details").querySelector("dd")?.textContent).toBe("None");
});

test("an epic without a description says so in one muted line", async () => {
  epicServing.view = { ...epicView, description: "" };
  await epicPageDrawn(abilitiesNone);
  const description = screen.getByRole("region", { name: "Description" });
  expect(description.textContent).toBe("No description");
  expect(description.querySelector(".epic-overview-none")).not.toBeNull();
});

test("the Overview draws no style attribute, which the served policy refuses", async () => {
  await epicPageDrawn(abilitiesNone);
  await waitFor(() => {
    expect(
      part("graph").querySelector(".epic-overview-graph-goal"),
    ).not.toBeNull();
  });
  expect(
    document.querySelector(".epic-overview")?.querySelector("[style]"),
  ).toBeNull();
});
