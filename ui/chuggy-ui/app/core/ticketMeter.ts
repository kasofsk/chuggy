/**
 * The rework meter: how many work cycles a ticket has started, against the most
 * its release allows.
 *
 * `reworkLimit` IS A CEILING ON CYCLES, NOT A COUNT OF REWORKS. The machine
 * escalates a failed evaluation when `evaluation.work_cycle >= limit` and cycle
 * numbers are 1-based, so a limit of 1 admits exactly one work cycle and a
 * limit of `n` admits `n`. Reading it as "n reworks after the first cycle"
 * draws every ticket one cycle too generous, which is a mistake no single
 * ticket makes visible.
 *
 * ESCALATION IS AT THE TOP OF THE BAR. Reaching the limit is not a failure and
 * is not drawn as one: it is the last cycle the release paid for, after which a
 * failed evaluation stops the ticket for a person instead of starting another.
 *
 * UNBOUNDED IS A COUNT WITHOUT A DENOMINATOR. A release recording no limit and
 * one recording `null` are the same unbounded ticket on this wire, and neither
 * has a ceiling to draw against — so there is no bar, because a full bar would
 * say the opposite of what is true. Zero is a limit like any other and is not a
 * spelling of unbounded: it admits a cycle, because dispatch starts one without
 * consulting the policy, and escalates that cycle's first failed evaluation.
 */

import type { AdoptedTicket } from "../../../../src/contract/adoptedTickets.ts";

export const reworkMeterStates = [
  "Room",
  "AtLimit",
  "Over",
  "Unbounded",
] as const;

export type ReworkMeterState = (typeof reworkMeterStates)[number];

export interface ReworkMeter {
  readonly started: number;
  /** Null is unbounded, which is the one state with no denominator to draw. */
  readonly limit: number | null;
  readonly state: ReworkMeterState;
  /** Cycles the release still admits, absent where nothing bounds them. */
  readonly remaining: number | undefined;
  /** The figure a reader scans, which is a count against a ceiling where there is one. */
  readonly figure: string;
  /** The same figure in words, which is what the meter is named by. */
  readonly spoken: string;
}

/** What happens at the top of the bar, said once beside it rather than per state. */
export const reworkMeterHow =
  "A failed evaluation at the limit escalates the ticket instead of starting another cycle.";

function reworkMeterState(
  started: number,
  limit: number | null,
): ReworkMeterState {
  if (limit === null) return "Unbounded";
  if (started > limit) return "Over";
  return started === limit ? "AtLimit" : "Room";
}

function reworkMeterFigure(meter: {
  readonly started: number;
  readonly limit: number | null;
  readonly state: ReworkMeterState;
  readonly remaining: number | undefined;
}): string {
  const started = String(meter.started);
  if (meter.state === "Unbounded") return `${started} cycles · no limit`;
  const against = `${started}/${String(meter.limit ?? 0)} cycles`;
  if (meter.state === "Over") return `${against} · past the limit`;
  if (meter.state === "AtLimit") return `${against} · at the limit`;
  return `${against} · ${String(meter.remaining ?? 0)} before escalation`;
}

/**
 * The figure spelled out, with no `/` or `·` in it: a screen reader says those
 * unpredictably, so the cells stay decorative and the name carries the meaning.
 */
function reworkMeterSpoken(
  name: string,
  meter: {
    readonly started: number;
    readonly limit: number | null;
    readonly state: ReworkMeterState;
    readonly remaining: number | undefined;
  },
): string {
  const started = `${name} ${String(meter.started)} work cycles started`;
  if (meter.state === "Unbounded") return `${started}, no limit`;
  const against = `${started} of ${String(meter.limit ?? 0)} allowed`;
  if (meter.state === "Over") return `${against}, past the limit`;
  if (meter.state === "AtLimit") return `${against}, at the limit`;
  return `${against}, ${String(meter.remaining ?? 0)} before escalation`;
}

/** What the ticket has started against what its release allows. */
export function reworkMeterOf(
  ticket: Pick<AdoptedTicket, "workCyclesStarted" | "reworkLimit">,
  name: string,
): ReworkMeter {
  const started = ticket.workCyclesStarted;
  const limit = ticket.reworkLimit;
  const state = reworkMeterState(started, limit);
  const remaining = limit === null ? undefined : Math.max(limit - started, 0);
  const held = { started, limit, state, remaining };
  return {
    ...held,
    figure: reworkMeterFigure(held),
    spoken: reworkMeterSpoken(name, held),
  };
}
