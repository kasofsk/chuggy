import {
  schedulerRole,
  selectorServiceRole,
  sessionRouteFunction,
  sessionRunnerStandingFunction,
  threadWakeCandidatesFunction,
  threadWakeCursorAdvanceFunction,
  threadWakeFunction,
  type Migration,
} from "../shared.ts";

/**
 * The thread wake pass runs in the scheduler rather than the selector, so its
 * cursor, candidate read and wake door move to the scheduler's role. They are
 * revoked from the selector's in the same step, because two passes over one
 * cursor would be two writers to it.
 *
 * The candidate read routes each candidate, asks after the principal's runners
 * and reads the project's thread standing rules, so the scheduler is granted
 * those three as well. The selector keeps them, because lead admission still
 * reads them.
 */

const wake = `public.${threadWakeFunction}(in_tenant text, in_project text, in_session text, in_turn text, in_input text, in_route text)`;
const candidates = `public.${threadWakeCandidatesFunction}(in_after bigint, in_max bigint)`;
const advance = `public.${threadWakeCursorAdvanceFunction}(in_sequence bigint)`;
const route = `public.${sessionRouteFunction}(in_tenant text, in_project text, in_kind text)`;
const standing = `public.${sessionRunnerStandingFunction}(in_tenant text, in_project text, in_member text, in_polled_secs_max bigint)`;

export const migration193: Migration = {
  version: 193,
  name: "the scheduler wakes member threads",
  statements: [
    ...[candidates, wake, advance].flatMap((boundary) => [
      `GRANT EXECUTE ON FUNCTION ${boundary} TO ${schedulerRole}`,
      `REVOKE EXECUTE ON FUNCTION ${boundary} FROM ${selectorServiceRole}`,
    ]),
    `GRANT SELECT ON TABLE public.thread_wake_cursor TO ${schedulerRole}`,
    `REVOKE SELECT ON TABLE public.thread_wake_cursor FROM ${selectorServiceRole}`,
    `GRANT EXECUTE ON FUNCTION ${route} TO ${schedulerRole}`,
    `GRANT EXECUTE ON FUNCTION ${standing} TO ${schedulerRole}`,
    `GRANT SELECT(tenant,project,thread_standing_rules) ON TABLE public.selector_project_settings TO ${schedulerRole}`,
  ],
};
