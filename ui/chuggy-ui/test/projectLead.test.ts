/**
 * Whether a project has a lead, from the lead route's two answers, and the
 * lead page's state drawn from them.
 */

import { expect, test } from "vitest";

import type { LeadReadResponse } from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import {
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
