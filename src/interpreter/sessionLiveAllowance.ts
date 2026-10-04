/**
 * What one session may publish of its turn in flight, in events over time.
 *
 * A session's bearer is held by a runner on a member's own machine, so how
 * often it posts is not trusted. Each session draws its events from an
 * allowance that refills at a steady rate up to a burst, and a post the
 * allowance does not cover whole is published not at all and answered as a
 * lane that is not there, which tells the runner to offer its events later.
 *
 * The allowance is this process's own: a plane run as several processes admits
 * the rate once in each. A session forgotten here returns with a whole burst.
 */

import { sessionLiveEventsMax } from "../contract/http.ts";
import { sessionLiveKey, type SessionLivePublishPort } from "./sessionPlane.ts";

export interface SessionLiveAllowanceLimits {
  /** The events a session's allowance regains each second. */
  readonly eventsPerSecondMax: number;
  /** The events a session that has said nothing for a while may publish at once. */
  readonly eventsBurstMax: number;
  /** The sessions whose allowances are remembered, the least recently seen forgotten first. */
  readonly sessionsTrackedMax: number;
}

export const sessionLiveAllowanceLimitsDefault: SessionLiveAllowanceLimits = {
  eventsPerSecondMax: 120,
  eventsBurstMax: 240,
  sessionsTrackedMax: 4_096,
};

/** The limits, or the refusal of one no allowance could run on: a burst smaller than a post could never cover one. */
export function checkedSessionLiveAllowanceLimits(
  limits: SessionLiveAllowanceLimits,
): SessionLiveAllowanceLimits {
  for (const [what, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`${what} must be a positive integer`);
  if (limits.eventsBurstMax < sessionLiveEventsMax)
    throw new RangeError("eventsBurstMax must cover the events of one post");
  return limits;
}

/** What an operator is told of posts refused for being past a session's allowance, with how many there have been. */
export interface SessionLiveAllowanceReport {
  refused(refusedTotal: number): void;
}

interface SessionAllowance {
  readonly eventsLeft: number;
  readonly atMs: number;
}

/**
 * `port` behind each session's allowance. The report hears of the first
 * refusal and then of each doubling, so a session that floods cannot fill a
 * log.
 */
export function sessionLivePublishAllowed(
  port: SessionLivePublishPort,
  nowMs: () => number,
  report: SessionLiveAllowanceReport,
  limits: SessionLiveAllowanceLimits = sessionLiveAllowanceLimitsDefault,
): SessionLivePublishPort {
  const { eventsPerSecondMax, eventsBurstMax, sessionsTrackedMax } =
    checkedSessionLiveAllowanceLimits(limits);
  const sessions = new Map<string, SessionAllowance>();
  let refusedTotal = 0;
  const left = (key: string, atMs: number): number => {
    const tracked = sessions.get(key);
    if (tracked === undefined) return eventsBurstMax;
    const regained =
      (Math.max(0, atMs - tracked.atMs) * eventsPerSecondMax) / 1_000;
    return Math.min(eventsBurstMax, tracked.eventsLeft + regained);
  };
  return {
    publish: (input) => {
      const key = sessionLiveKey(input.partition, input.session);
      const atMs = nowMs();
      const eventsLeft = left(key, atMs);
      const covered = input.events.length <= eventsLeft;
      sessions.delete(key);
      sessions.set(key, {
        eventsLeft: covered ? eventsLeft - input.events.length : eventsLeft,
        atMs,
      });
      const oldest = sessions.keys().next();
      if (sessions.size > sessionsTrackedMax && oldest.done !== true)
        sessions.delete(oldest.value);
      if (covered) return port.publish(input);
      refusedTotal += 1;
      if ((refusedTotal & (refusedTotal - 1)) === 0)
        report.refused(refusedTotal);
      return Promise.resolve("Unavailable");
    },
  };
}
