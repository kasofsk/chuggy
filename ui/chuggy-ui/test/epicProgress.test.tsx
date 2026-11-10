/**
 * The bar an epic's progress is drawn as: a segment for each group with
 * members, Done, Running, Escalated then Pending, each in its group's tone, a
 * key naming each with its count, a progress bar named in words, and no bar
 * for an empty epic; and in a list's row, the words beside the bar.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import {
  EpicProgressPage,
  EpicProgressRow,
} from "../app/browser/epic/EpicProgress.tsx";
import { renderCopied } from "./copied.tsx";
import { epicView } from "./epicPageFixture.tsx";

afterEach(cleanup);

type Phases = typeof epicView.progress.byPhase;

function progressOf(byPhase: Partial<Phases>, drafts = 0) {
  const counted = {
    ...epicView.progress.byPhase,
    Pending: 0,
    Done: 0,
    ...byPhase,
  };
  const total =
    Object.entries(counted)
      .filter(([phase]) => phase !== "Revoked")
      .reduce((sum, [, count]) => sum + count, 0) + drafts;
  return { byPhase: counted, drafts, done: counted.Done, total };
}

/** An epic holding a member in every group, a draft among the Pending, and a
 * Revoked one the total leaves out. */
const everyGroup = progressOf(
  {
    Done: 3,
    Work: 1,
    Evaluation: 1,
    Finalization: 1,
    Escalated: 1,
    Pending: 4,
    Revoked: 2,
  },
  1,
);

test("the bar has a segment for each group, in order and tone, each as wide as its share", () => {
  renderCopied(<EpicProgressPage progress={everyGroup} />);
  const bar = screen.getByRole("progressbar");
  expect(
    [...bar.querySelectorAll<SVGRectElement>(".epic-progress-segment")].map(
      (segment) => [
        segment.dataset["group"],
        segment.dataset["tone"],
        segment.getAttribute("x"),
        segment.getAttribute("width"),
      ],
    ),
  ).toStrictEqual([
    ["Done", "pass", "0%", "25%"],
    ["Running", "live", "25%", "25%"],
    ["Escalated", "parked", "50%", `${String(100 / 12)}%`],
    ["Pending", "Track", `${String(50 + 100 / 12)}%`, `${String(500 / 12)}%`],
  ]);
});

test("the bar is a progress bar of the members done, named by what is done, running and escalated", () => {
  renderCopied(<EpicProgressPage progress={everyGroup} />);
  const bar = screen.getByRole("progressbar", {
    name: "3 of 12 done, 3 running, 1 escalated",
  });
  expect(bar.getAttribute("aria-valuemax")).toBe("12");
  expect(bar.getAttribute("aria-valuenow")).toBe("3");
});

test("the key names each group with members, with its count", () => {
  renderCopied(<EpicProgressPage progress={everyGroup} />);
  const key = screen.getByRole("list", { name: "Tickets by state" });
  expect(
    within(key)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toStrictEqual(["3Done", "3Running", "1Escalated", "5Pending"]);
});

test("a group with no members has no segment and no key", () => {
  renderCopied(
    <EpicProgressPage progress={progressOf({ Done: 1, Pending: 2 })} />,
  );
  expect(screen.getByRole("progressbar", { name: "1 of 3 done" })).toBeTruthy();
  expect(
    [
      ...document.querySelectorAll<SVGRectElement>(
        ".epic-progress-track .epic-progress-segment",
      ),
    ].map((segment) => segment.dataset["group"]),
  ).toStrictEqual(["Done", "Pending"]);
  expect(
    within(screen.getByRole("list", { name: "Tickets by state" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toStrictEqual(["1Done", "2Pending"]);
});

test("an empty epic draws no bar and no key", () => {
  renderCopied(<EpicProgressPage progress={progressOf({})} />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByRole("list")).toBeNull();
});

test("nothing on the bar moves", () => {
  renderCopied(<EpicProgressPage progress={everyGroup} />);
  const bar = screen.getByRole("progressbar");
  expect(bar.hasAttribute("aria-busy")).toBe(false);
  expect(bar.querySelectorAll("animate, animateTransform")).toHaveLength(0);
});

test("a list's row draws the bar with its words beside it", () => {
  renderCopied(
    <EpicProgressRow
      progress={progressOf({ Done: 3, Work: 1, Pending: 10 })}
    />,
  );
  expect(
    screen.getByRole("progressbar", { name: "3 of 14 done, 1 running" }),
  ).toBeTruthy();
  expect(document.querySelector(".epic-progress-said")?.textContent).toBe(
    "3 of 14 done · 1 running",
  );
});
