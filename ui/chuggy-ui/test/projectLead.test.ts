/**
 * Whether a project has a lead, from the lead route's two answers, and the
 * lead page's state drawn from them.
 */

import { expect, test } from "vitest";

import type { LeadReadResponse } from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import {
  projectLeadAbsenceLine,
  projectLeadDispatches,
  projectLeadFound,
  projectLeadPanelState,
  projectLeadPolled,
  projectLeadPresent,
} from "../app/core/projectLead.ts";
import { leadBody } from "./leadFixture.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";

const lead = leadBody(1, 1);
const none: LeadReadResponse = { lead: "None" };

function ready(value: LeadReadResponse): PanelState<LeadReadResponse> {
  return { state: "Ready", value, observedAtMs: 5 };
}

test("a read names its lead, or nothing where it answered there is none", () => {
  expect(projectLeadFound(lead)).toBe(lead);
  expect(projectLeadFound(none)).toBeUndefined();
});

test("a project is led or not only once a read has said", () => {
  expect(projectLeadPresent(ready(lead))).toBe(true);
  expect(projectLeadPresent(ready(none))).toBe(false);
  expect(projectLeadPresent({ state: "Pending" })).toBeUndefined();
  expect(
    projectLeadPresent({
      state: "Failed",
      failure: { outcome: "Unreachable", reason: "no" },
    }),
  ).toBeUndefined();
  expect(projectLeadPresent({ state: "Absent" })).toBeUndefined();
});

test("the lead page draws a lead it was answered, and is absent where there is none", () => {
  expect(projectLeadPanelState(ready(lead))).toStrictEqual({
    state: "Ready",
    value: lead,
    observedAtMs: 5,
  });
  expect(projectLeadPanelState(ready(none)).state).toBe("Absent");
  const failed = {
    state: "Failed",
    failure: { outcome: "Unreachable", reason: "no" },
  } as const;
  expect(projectLeadPanelState(failed)).toBe(failed);
});

/** When a refusal began, a moment later that day, and a later day of the same year. */
const sinceIso = "2026-09-02T09:30:00.000Z";
const sameDayMs = Date.parse("2026-09-02T09:45:00.000Z");
const laterMs = Date.parse("2026-10-14T09:45:00.000Z");

/** The refusal's clock and its day, written in the reader's own zone as the
 * line writes them, so a case holds wherever it is run. */
function sinceLocal(): { readonly clock: string; readonly day: string } {
  const since = new Date(sinceIso);
  const month = since.toLocaleString("en-US", { month: "short" });
  return {
    clock: `${String(since.getHours()).padStart(2, "0")}:${String(since.getMinutes()).padStart(2, "0")}`,
    day: `${month} ${String(since.getDate())}`,
  };
}

test("a project with no lead says why under the line, and since when where it was refused", () => {
  const { clock, day } = sinceLocal();
  expect(
    projectLeadAbsenceLine(
      ready({ lead: "None", absence: { reason: "NotNeeded" } }),
      sameDayMs,
      undefined,
    ),
  ).toBe("Opens when a ticket is released");
  expect(
    projectLeadAbsenceLine(
      ready({ lead: "None", absence: { reason: "Paused" } }),
      sameDayMs,
      undefined,
    ),
  ).toBe("Selector paused");
  expect(
    projectLeadAbsenceLine(
      ready({ lead: "None", absence: { reason: "SelectorNotGranted" } }),
      sameDayMs,
      undefined,
    ),
  ).toBe("Selector not granted this project");
  expect(
    projectLeadAbsenceLine(
      ready({ lead: "None", absence: { reason: "AwaitingSelector" } }),
      sameDayMs,
      undefined,
    ),
  ).toBe("Opens at the selector's next pass");
  expect(
    projectLeadAbsenceLine(
      ready({ lead: "None", absence: { reason: "SelectorUnnamed" } }),
      sameDayMs,
      undefined,
    ),
  ).toBe("No selector named for this site");
  expect(
    projectLeadAbsenceLine(
      ready({
        lead: "None",
        absence: { reason: "RunnerOffline", since: sinceIso },
      }),
      sameDayMs,
      undefined,
    ),
  ).toBe(`No live runner · since ${clock}`);
  expect(
    projectLeadAbsenceLine(
      ready({
        lead: "None",
        absence: { reason: "HostedRunsNotGranted", since: sinceIso },
      }),
      laterMs,
      undefined,
    ),
  ).toBe(`Hosted runs not granted · since ${day} ${clock}`);
});

/**
 * Once the placement says where the project's runners stand, a refusal for no
 * live runner is left out: the runner notice beside the line says it where none
 * is live, and where one is, or the lead runs hosted, the next selector pass
 * answers again. Only a placement not yet read leaves it standing.
 */
test("a refusal for no live runner is drawn only until the placement has said where the runners stand", () => {
  const offline = ready({
    lead: "None",
    absence: { reason: "RunnerOffline", since: sinceIso },
  });
  for (const placement of [
    sessionPlacementBody({ project: "Unregistered" }),
    sessionPlacementBody({ project: "Offline" }),
    sessionPlacementBody({ project: "Live" }),
    sessionPlacementBody({ lead: "InCluster", project: "Offline" }),
  ])
    expect(
      projectLeadAbsenceLine(offline, sameDayMs, placement),
      JSON.stringify(placement),
    ).toBeUndefined();
  expect(projectLeadAbsenceLine(offline, sameDayMs, undefined)).toMatch(
    /^No live runner · since /u,
  );
  const live = sessionPlacementBody({ project: "Live" });
  expect(
    projectLeadAbsenceLine(
      ready({ lead: "None", absence: { reason: "Paused" } }),
      sameDayMs,
      live,
    ),
  ).toBe("Selector paused");
  expect(
    projectLeadAbsenceLine(
      ready({
        lead: "None",
        absence: { reason: "HostedRunsNotGranted", since: sinceIso },
      }),
      sameDayMs,
      live,
    ),
  ).toMatch(/^Hosted runs not granted · since /u);
  expect(projectLeadAbsenceLine(ready(none), sameDayMs, live)).toBe(
    "Tickets are dispatched by hand",
  );
});

/** A lead that has not opened only because nothing has needed one yet, or the
 * selector's next pass has not come, is one that will dispatch; every other
 * reason, or none given, leaves it to a press. */
test("a lead dispatches where one stands or will open, and not otherwise", () => {
  expect(projectLeadDispatches(ready(lead))).toBe(true);
  for (const reason of ["NotNeeded", "AwaitingSelector"] as const)
    expect(
      projectLeadDispatches(ready({ lead: "None", absence: { reason } })),
    ).toBe(true);
  for (const absence of [
    { reason: "Paused" },
    { reason: "SelectorNotGranted" },
    { reason: "SelectorUnnamed" },
    { reason: "RunnerOffline", since: sinceIso },
    { reason: "HostedRunsNotGranted", since: sinceIso },
    { reason: "UsagePaused", since: sinceIso },
  ] as const)
    expect(projectLeadDispatches(ready({ lead: "None", absence }))).toBe(false);
  expect(projectLeadDispatches(ready(none))).toBe(false);
  expect(projectLeadDispatches({ state: "Pending" })).toBeUndefined();
  expect(
    projectLeadDispatches({
      state: "Failed",
      failure: { outcome: "Unreachable", reason: "no" },
    }),
  ).toBeUndefined();
});

test("a server that gives no reason reads as tickets run by hand, and a lead or no read draws no line", () => {
  expect(projectLeadAbsenceLine(ready(none), laterMs, undefined)).toBe(
    "Tickets are dispatched by hand",
  );
  expect(
    projectLeadAbsenceLine(ready(lead), laterMs, undefined),
  ).toBeUndefined();
  expect(
    projectLeadAbsenceLine({ state: "Pending" }, laterMs, undefined),
  ).toBeUndefined();
  expect(
    projectLeadAbsenceLine({ state: "Absent" }, laterMs, undefined),
  ).toBeUndefined();
});

/** When a usage pause ends, later the same day as `sameDayMs`. */
const untilIso = "2026-09-02T23:00:00.000Z";

function untilLocal(): string {
  const until = new Date(untilIso);
  return `${String(until.getHours()).padStart(2, "0")}:${String(until.getMinutes()).padStart(2, "0")}`;
}

/**
 * A lead paused for usage has live runners, so no runner notice says why it
 * takes no turn: its line is drawn whatever the placement says, naming when
 * the pause ends where the read names it, and since when where it does not.
 */
test("a lead paused for usage says until when, whatever the placement says", () => {
  const paused = ready({
    lead: "None",
    absence: { reason: "UsagePaused", since: sinceIso, until: untilIso },
  });
  for (const placement of [
    undefined,
    sessionPlacementBody({ project: "Live" }),
  ])
    expect(projectLeadAbsenceLine(paused, sameDayMs, placement)).toBe(
      `Paused for usage · until ${untilLocal()}`,
    );
  expect(
    projectLeadAbsenceLine(
      ready({
        lead: "None",
        absence: { reason: "UsagePaused", since: sinceIso },
      }),
      sameDayMs,
      undefined,
    ),
  ).toBe(`Paused for usage · since ${sinceLocal().clock}`);
});

/** No frame says a refusal was kept or forgotten, so a read naming one is read again on the clock, and a lead with none is not. */
test("a read is polled while it names no lead, or a lead a refusal is kept for", () => {
  expect(projectLeadPolled(none)).toBe(true);
  expect(projectLeadPolled(lead)).toBe(false);
  expect(
    projectLeadPolled({
      ...lead,
      refusal: { reason: "UsagePaused", since: sinceIso, until: untilIso },
    }),
  ).toBe(true);
});
