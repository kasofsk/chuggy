/**
 * Whether a project has a lead, from the one read that says: the lead route
 * answers the lead itself, or that the project has none.
 *
 * A PROJECT WITH NO LEAD HAS NOT BEEN DISPATCHED BY THE SELECTOR. The
 * selector opens a project's lead at its first decision there and dispatches
 * through it, so where the read says there is none, the project's tickets wait
 * for somebody to press Dispatch. The selector's settings say how a lead would
 * dispatch, not whether this project has one.
 */

import type {
  LeadReadResponse,
  LeadResponse,
} from "../../../../src/contract/responses.ts";
import type { SessionKind } from "../../../../src/contract/rosters.ts";

import type { PanelState } from "./freshness.ts";

/** The session kind a lead's change frames carry. */
export const projectLeadSessionKind: SessionKind = "Lead";

/** The lead a read answered, or nothing where it answered that there is none. */
export function projectLeadFound(
  read: LeadReadResponse,
): LeadResponse | undefined {
  return "session" in read ? read : undefined;
}

/** Whether the project has a lead, unknown until a read has said. */
export function projectLeadPresent(
  state: PanelState<LeadReadResponse>,
): boolean | undefined {
  return state.state === "Ready"
    ? projectLeadFound(state.value) !== undefined
    : undefined;
}

/**
 * The lead page's own state, where a project that answered it has no lead is
 * absent the same as one this reader is not shown: either way there is no lead
 * to draw.
 */
export function projectLeadPanelState(
  state: PanelState<LeadReadResponse>,
): PanelState<LeadResponse> {
  if (state.state !== "Ready") return state;
  const lead = projectLeadFound(state.value);
  return lead === undefined
    ? { state: "Absent", reason: "the project has no lead" }
    : { ...state, value: lead };
}
