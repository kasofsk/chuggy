/**
 * Whether a project has a lead, from the lead route's two answers, and the
 * lead page's state drawn from them.
 */

import { expect, test } from "vitest";

import type { LeadReadResponse } from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import {
  projectLeadAbsenceLine,
  projectLeadFound,
  projectLeadPanelState,
  projectLeadPresent,
} from "../app/core/projectLead.ts";
import { leadBody } from "./leadFixture.ts";

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
  expect(projectLeadPresent({ state: "Failed", reason: "no" })).toBeUndefined();
  expect(projectLeadPresent({ state: "Absent", reason: "no" })).toBeUndefined();
});

test("the lead page draws a lead it was answered, and is absent where there is none", () => {
  expect(projectLeadPanelState(ready(lead))).toStrictEqual({
    state: "Ready",
    value: lead,
    observedAtMs: 5,
  });
  expect(projectLeadPanelState(ready(none)).state).toBe("Absent");
  const failed = { state: "Failed", reason: "no" } as const;
  expect(projectLeadPanelState(failed)).toBe(failed);
});

/** When a refusal began, a moment later that day, and a later day of the same year. */
const sinceIso = "2026-09-02T09:30:00.000Z";
const sameDayMs = Date.parse("2026-09-02T09:45:00.000Z");
const laterMs = Date.parse("2026-10-14T09:45:00.000Z");

test("a project with no lead says why under the line, and since when where it was refused", () => {
  const since = new Date(sinceIso);
  const clock = `${String(since.getHours()).padStart(2, "0")}:${String(since.getMinutes()).padStart(2, "0")}`;
  expect(
    projectLeadAbsenceLine(
      ready({ lead: "None", absence: { reason: "NotNeeded" } }),
      sameDayMs,
    ),
  ).toBe("Opens when a ticket is released");
  expect(
    projectLeadAbsenceLine(
      ready({
        lead: "None",
        absence: { reason: "RunnerOffline", since: sinceIso },
      }),
      sameDayMs,
    ),
  ).toBe(`No live runner · since ${clock}`);
  expect(
    projectLeadAbsenceLine(
      ready({
        lead: "None",
        absence: { reason: "HostedRunsNotGranted", since: sinceIso },
      }),
      laterMs,
    ),
  ).toMatch(/^Hosted runs not granted · since Sep 2 \d\d:\d\d$/u);
});

test("a server that gives no reason reads as tickets run by hand, and a lead or no read draws no line", () => {
  expect(projectLeadAbsenceLine(ready(none), laterMs)).toBe(
    "Tickets are dispatched by hand",
  );
  expect(projectLeadAbsenceLine(ready(lead), laterMs)).toBeUndefined();
  expect(projectLeadAbsenceLine({ state: "Pending" }, laterMs)).toBeUndefined();
  expect(
    projectLeadAbsenceLine({ state: "Absent", reason: "no" }, laterMs),
  ).toBeUndefined();
});
