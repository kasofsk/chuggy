/**
 * The bar an epic's progress is drawn as: a progress bar named in words with
 * its figures, busy while any member moves, its fill shimmering then or its
 * empty track sweeping, and a chip for each phase its members are in.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { EpicStanding } from "../app/browser/epic/EpicProgress.tsx";
import { renderCopied } from "./copied.tsx";
import { epicView } from "./epicPageFixture.tsx";

afterEach(cleanup);

type Phases = typeof epicView.progress.byPhase;

function standing(
  byPhase: Partial<Phases>,
  size: "row" | "page" = "row",
): HTMLElement {
  const counted = {
    ...epicView.progress.byPhase,
    Pending: 0,
    Done: 0,
    ...byPhase,
  };
  const total = Object.values(counted).reduce((sum, count) => sum + count, 0);
  renderCopied(
    <EpicStanding
      epic={{
        status: "in_progress",
        progress: { byPhase: counted, drafts: 0, done: counted.Done, total },
      }}
      size={size}
    />,
  );
  return screen.getByRole("progressbar");
}

function moving(bar: HTMLElement): string | undefined {
  return bar.querySelector<SVGSVGElement>(".epic-progress-track")?.dataset[
    "moving"
  ];
}

test("the bar is a progress bar of the tickets done, named in words and figured done/total", () => {
  const bar = standing({ Done: 1, Pending: 2 }, "page");
  expect(bar.getAttribute("aria-valuemin")).toBe("0");
  expect(bar.getAttribute("aria-valuemax")).toBe("3");
  expect(bar.getAttribute("aria-valuenow")).toBe("1");
  expect(bar.getAttribute("aria-label")).toBe("1 of 3 done");
  expect(bar.querySelector(".epic-progress-figure")?.textContent).toBe("1/3");
  expect(bar.dataset["size"]).toBe("page");
  expect(bar.querySelector(".epic-progress-fill")?.getAttribute("width")).toBe(
    "33%",
  );
});

test("a bar with nothing moving is still and not busy", () => {
  const bar = standing({ Done: 1, Pending: 1 });
  expect(bar.hasAttribute("aria-busy")).toBe(false);
  expect(moving(bar)).toBe("Still");
  expect(bar.querySelector(".epic-progress-glint")).toBeNull();
});

test("a bar with a member moving is busy and shimmers its fill", () => {
  const bar = standing({ Done: 1, Work: 1 });
  expect(bar.getAttribute("aria-busy")).toBe("true");
  expect(moving(bar)).toBe("Shimmer");
  expect(bar.querySelector(".epic-progress-glint")).not.toBeNull();
});

test("a bar with a member moving and nothing done sweeps its empty track", () => {
  const bar = standing({ Evaluation: 1, Pending: 1 });
  expect(bar.getAttribute("aria-busy")).toBe("true");
  expect(moving(bar)).toBe("Sweep");
  expect(bar.querySelector("clipPath rect")?.getAttribute("width")).toBe(
    "100%",
  );
});

test("a chip counts each phase a member is in, and none is drawn for an empty one", () => {
  standing({ Done: 2, Work: 1 });
  expect(
    [...document.querySelectorAll(".epic-progress-counts .pill")].map(
      (chip) => chip.textContent,
    ),
  ).toStrictEqual(["1 Working", "2 Done"]);
});
