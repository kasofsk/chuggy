/**
 * The rework meter as it is drawn.
 *
 * The case that matters most is the unbounded one: there is no ceiling to fill,
 * so a full bar would say the ticket had spent everything it had. It draws the
 * hatched band and no cells at all, and that is asserted rather than assumed.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { ReworkMeter, reworkMeterCellsMax } from "../app/browser/ticket/ReworkMeter.tsx";
import { reworkMeterOf } from "../app/core/ticketMeter.ts";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

function draw(workCyclesStarted: number, reworkLimit: number | null) {
  return render(
    <ReworkMeter
      name="Work cycles"
      meter={reworkMeterOf({ workCyclesStarted, reworkLimit }, "Work cycles")}
      how="A failed evaluation at the limit escalates the ticket."
    />,
  );
}

test("a bounded ticket draws one cell per cycle the release allows", () => {
  const view = draw(2, 5);

  expect(view.container.querySelectorAll(".meter-cell")).toHaveLength(5);
  expect(
    view.container.querySelectorAll(".meter-cell-started"),
  ).toHaveLength(2);
  expect(view.container.querySelectorAll(".meter-cell-left")).toHaveLength(3);
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

test("an unbounded ticket draws no bar to fill and no cells at all", () => {
  const view = draw(4, null);

  expect(view.container.querySelector(".meter-bar-unbounded")).not.toBeNull();
  expect(view.container.querySelectorAll(".meter-cell")).toHaveLength(0);
  expect(view.container.querySelector("meter")).toBeNull();
  expect(screen.getByText("4 cycles · no limit")).toBeDefined();
  styleless();
});

test("a ticket at its limit fills the track without being drawn as wrong", () => {
  const view = draw(5, 5);

  expect(
    view.container.querySelectorAll(".meter-cell-started"),
  ).toHaveLength(5);
  expect(view.container.querySelectorAll(".meter-cell-left")).toHaveLength(0);
  expect(view.container.querySelector(".meter-atlimit")).not.toBeNull();
  expect(view.container.querySelector(".meter-over")).toBeNull();
  styleless();
});

test("a ticket counted past its limit says so", () => {
  const view = draw(6, 5);

  expect(view.container.querySelector(".meter-over")).not.toBeNull();
  expect(screen.getByText("6/5 cycles · past the limit")).toBeDefined();
  styleless();
});

test("a limit nobody can count becomes a native meter rather than cells", () => {
  const view = draw(3, reworkMeterCellsMax + 1);
  const native = view.container.querySelector("meter");

  expect(view.container.querySelectorAll(".meter-cell")).toHaveLength(0);
  expect(native?.getAttribute("max")).toBe(String(reworkMeterCellsMax + 1));
  expect(native?.getAttribute("value")).toBe("3");
  styleless();
});

test("a limit of zero draws no track, and the figure is what says so", () => {
  const view = draw(0, 0);

  expect(view.container.querySelectorAll(".meter-cell")).toHaveLength(0);
  expect(view.container.querySelector(".meter-bar-unbounded")).toBeNull();
  expect(screen.getByText("0/0 cycles · at the limit")).toBeDefined();
  styleless();
});

test("the group is named by the figure spelled out, not by the marks in it", () => {
  draw(2, 5);
  const group = screen.getByRole("group", {
    name: "Work cycles 2 work cycles started of 5 allowed, 3 before escalation",
  });

  expect(group).toBeDefined();
  styleless();
});
