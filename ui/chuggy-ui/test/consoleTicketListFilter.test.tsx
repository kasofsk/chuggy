/**
 * The ticket list's filter as the route tree holds it: chosen, it is written
 * into the list's own history entry, so going back to the list draws it again
 * whatever this browser has kept since.
 */

import { fireEvent, screen } from "@testing-library/react";
import { act } from "react";
import { expect, test, vi } from "vitest";

import { phaseLabel } from "../app/core/codeLabels.ts";
import {
  consoleAdvanced,
  consoleMounted,
  consolePartition,
  consoleSession,
  consoleSiteClean,
  consoleSiteEachCase,
} from "./consoleSite.tsx";
import type { ConsoleSite } from "./consoleSite.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) =>
  (await import("./consoleNetwork.ts")).consolePortsOver(
    await importOriginal<typeof BrowserPorts>(),
  ),
);

let site: ConsoleSite;

consoleSiteEachCase((made) => {
  site = made;
});

/** How long a screen is given to read what it reads and draw it. */
const consoleFilterSettleMs = 1_000;

const projectAddress = `/${consolePartition.tenant}/${consolePartition.project}`;

/** The phases each project read since `from` asked for. */
function phasesAsked(from: number): readonly string[] {
  return site.reads
    .slice(from)
    .filter((read) =>
      new URL(read, "http://stub").pathname.endsWith(
        `/projects/${consolePartition.project}`,
      ),
    )
    .map((read) =>
      new URL(read, "http://stub").searchParams.getAll("phase").join(","),
    );
}

test("going back to the ticket list draws the filter it was left with, not the one kept since", async () => {
  const history = consoleMounted(projectAddress, consoleSession(), false);
  await consoleAdvanced(consoleFilterSettleMs);
  fireEvent.keyDown(screen.getByRole("button", { name: /^Filter/u }), {
    key: "ArrowDown",
  });
  await consoleAdvanced(0);
  fireEvent.click(
    screen.getByRole("menuitemradio", { name: phaseLabel("Escalated") }),
  );
  await consoleAdvanced(consoleFilterSettleMs);
  expect(history.location.search).toContain("filter=Escalated");
  localStorage.setItem("chug.ticket-list.filter", "Work");
  act(() => {
    history.push(`${projectAddress}/inbox`);
  });
  await consoleAdvanced(consoleFilterSettleMs);
  const left = site.reads.length;
  act(() => {
    history.back();
  });
  await consoleAdvanced(consoleFilterSettleMs);
  expect(history.location.search).toContain("filter=Escalated");
  expect(phasesAsked(left).length).toBeGreaterThan(0);
  expect(new Set(phasesAsked(left))).toStrictEqual(new Set(["Escalated"]));
  consoleSiteClean(site);
});
