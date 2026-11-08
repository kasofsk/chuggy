/**
 * Whether a project has a lead, from the one read that says: the lead route
 * answers the lead itself, or that the project has none.
 *
 * A PROJECT WITH NO LEAD HAS NOT BEEN DISPATCHED BY THE SELECTOR YET. The
 * selector opens a project's lead at the first decision that needs one and
 * dispatches through it, so the read's `absence` says whether one will open
 * (`NotNeeded`, until a released ticket waits on a decision, and
 * `AwaitingSelector` while one waits for the selector's next pass) or why none
 * can, and while none can the project's tickets run where somebody presses
 * Dispatch. A server that gives no reason says only that there is no lead. The
 * selector's settings say how a lead would dispatch, not whether this project
 * has one.
 */

import type {
  LeadReadResponse,
  LeadRefusalResponse,
  LeadResponse,
} from "../../../../src/contract/responses.ts";
import type { SessionPlacementResponse } from "../../../../src/contract/responses.ts";
import type { SessionKind } from "../../../../src/contract/rosters.ts";

import { leadAbsenceLabel } from "./codeLabels.ts";
import { instantText } from "./figures.ts";
import type { PanelState } from "./freshness.ts";
import type { CopyText } from "./copy.ts";

/** The session kind a lead's change frames carry. */
export const projectLeadSessionKind: SessionKind = "Lead";

/**
 * How often a read that says there is no lead, or names a lead a refusal is
 * kept for, is read again. No frame says the selector kept or forgot a
 * refusal, or was paused, so this is what moves the reason on screen; any
 * other read that names a lead is moved by its frames alone.
 */
export const projectLeadAbsencePolledMs = 15_000;

/** Whether a read is polled: one naming no lead, or a lead a refusal is kept for. */
export function projectLeadPolled(read: LeadReadResponse): boolean {
  return !("session" in read) || read.refusal !== undefined;
}

/**
 * A kept refusal as one line: its label, and when a usage pause ends where the
 * read names it, or else since when the refusal has stood.
 */
export function projectLeadRefusalLine(
  refusal: LeadRefusalResponse,
  nowMs: number,
  text: CopyText,
): string {
  const label = text(leadAbsenceLabel(refusal.reason));
  const now = new Date(nowMs);
  return refusal.until === undefined
    ? `${label} · since ${instantText(new Date(refusal.since), now)}`
    : `${label} · until ${instantText(new Date(refusal.until), now)}`;
}

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
  return lead === undefined ? { state: "Absent" } : { ...state, value: lead };
}

/**
 * Whether a lead dispatches the project's tickets, or will open to: unknown
 * until a read has said, and false only where none stands and the read says
 * why none can open, or gives no reason at all.
 */
export function projectLeadDispatches(
  state: PanelState<LeadReadResponse>,
): boolean | undefined {
  if (state.state !== "Ready") return undefined;
  if ("session" in state.value) return true;
  const reason = state.value.absence?.reason;
  return reason === "NotNeeded" || reason === "AwaitingSelector";
}

/**
 * The line under a page's `No lead`: why the read says there is none, a
 * refusal as `projectLeadRefusalLine` draws it, or how its tickets run where
 * the server gives no reason. Nothing until a read has said there is no lead,
 * and nothing for `RunnerOffline` once `placement` says where the project's
 * runners stand, since the runner notice drawn beside the line says it where
 * none is live, and where one is, or the lead runs hosted, the next selector
 * pass answers again; a `UsagePaused` refusal, whose runners are live, is
 * always drawn.
 */
export function projectLeadAbsenceLine(
  state: PanelState<LeadReadResponse>,
  nowMs: number,
  placement: SessionPlacementResponse | undefined,
  text: CopyText,
): string | undefined {
  if (state.state !== "Ready" || "session" in state.value) return undefined;
  const absence = state.value.absence;
  if (absence === undefined) return text({ id: "lead-absence-manual" });
  if (absence.reason === "RunnerOffline" && placement !== undefined)
    return undefined;
  return "since" in absence
    ? projectLeadRefusalLine(absence, nowMs, text)
    : text(leadAbsenceLabel(absence.reason));
}
