/**
 * An account's agent is paused only while every credential its live runners
 * name of it is paused, as a claim naming them waits.
 *
 * `agent_account_pause` COUNTS THE CREDENTIALS THE ACCOUNT'S LIVE RUNNERS NAME
 * of the agent: the union of `credentials_named` of that agent over the
 * principal's personal runners and chat hosts, which it owns, and the pools it
 * registered. A runner is live as its plane reads it, a personal runner or a
 * chat host by its last poll and a pool by the later of its two polls, each
 * within `agentAccountRunnerPolledSecsMaxAt170`. Over that union it answers
 * `agent_account_named_pause`, so the rule is that one: paused only while every
 * name has a row of `agent_account_credential_pause`, until the earliest of
 * those ends, with each reason once, and a press admitting a claim as it reads
 * one. A credential no live runner names counts for nothing in it, and its
 * readings stay kept and answered per credential.
 *
 * WHERE NO LIVE RUNNER NAMES ANY CREDENTIAL OF THE AGENT, the answer is 163's:
 * paused while any kept credential is, until the latest ends, with each reason
 * once, which is how a runner from before credentials were named is read.
 *
 * ITS SIGNATURE, ITS ANSWER'S SHAPE, ITS OWNER AND ITS GRANTS ARE KEPT, and
 * every caller goes on calling it. The owner reads a pool's executions poll,
 * so it is granted that column.
 */

import {
  agentAccountCredentialPauseFunction,
  agentAccountNamedPauseFunction,
  agentAccountPauseFunction,
  apiRole,
  boundaryOwnerRole,
  metricsPlaneRole,
  poolPlaneRole,
  type Migration,
} from "../shared.ts";

/** How long after its last poll a runner's names still count toward its account's pause. */
export const agentAccountRunnerPolledSecsMaxAt170 = 120;

const pause = `public.${agentAccountPauseFunction}(in_principal text, in_agent text)`;

const polledSince = `now()-make_interval(secs=>${String(agentAccountRunnerPolledSecsMaxAt170)})`;

export const migration170: Migration = {
  version: 170,
  name: "an account's agent pauses only while every credential its live runners name is paused",
  statements: [
    `GRANT SELECT(executions_polled_at) ON TABLE public.worker_pool TO ${boundaryOwnerRole}`,
    `CREATE OR REPLACE FUNCTION ${pause}
       RETURNS TABLE(paused_until timestamp with time zone, reasons text[], admitted_by_press boolean)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         WITH live AS (
           SELECT r.credentials_named->in_agent AS named
             FROM personal_runner r
            WHERE r.owner=in_principal AND r.last_polled_at>${polledSince}
           UNION ALL
           SELECT w.credentials_named->in_agent
             FROM worker_pool w
            WHERE w.registered_by=in_principal
              AND greatest(w.last_polled_at,w.executions_polled_at)>${polledSince}
           UNION ALL
           SELECT h.credentials_named->in_agent
             FROM chat_host h
            WHERE h.owner=in_principal AND h.last_polled_at>${polledSince}),
         given AS (
           SELECT ARRAY(SELECT DISTINCT n.credential
                          FROM live l
                         CROSS JOIN LATERAL jsonb_array_elements_text(l.named) n(credential)
                         WHERE l.named IS NOT NULL) AS credentials),
         held AS (
           SELECT c.credential, c.paused_until, c.reasons
             FROM ${agentAccountCredentialPauseFunction}(in_principal,in_agent) c),
         holding AS (
           SELECT DISTINCT r.reason FROM held h CROSS JOIN LATERAL unnest(h.reasons) r(reason)),
         limited AS (
           SELECT max(l.observed_at) AS observed_at
             FROM held h
             JOIN agent_account_limit l
               ON l.principal=in_principal AND l.agent=in_agent
              AND l.credential=h.credential
            WHERE 'limit'=ANY(h.reasons))
         SELECT n.paused_until, n.reasons, n.admitted_by_press
           FROM given g
          CROSS JOIN LATERAL ${agentAccountNamedPauseFunction}(in_principal,in_agent,g.credentials) n
          WHERE cardinality(g.credentials)>0
         UNION ALL
         SELECT (SELECT max(h.paused_until) FROM held h),
                (SELECT COALESCE(array_agg(r.reason ORDER BY r.reason),'{}'::text[])
                   FROM holding r),
                COALESCE((SELECT bool_and(r.reason='limit') FROM holding r),false)
                  AND EXISTS(SELECT 1 FROM agent_account_press p
                              CROSS JOIN limited m
                              WHERE p.principal=in_principal AND p.agent=in_agent
                                AND p.spent_at IS NULL
                                AND p.pressed_at>m.observed_at)
           FROM given g
          WHERE cardinality(g.credentials)=0
       $$`,
    `ALTER FUNCTION ${pause} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${pause} FROM PUBLIC`,
    ...[poolPlaneRole, apiRole, metricsPlaneRole].map(
      (role) => `GRANT EXECUTE ON FUNCTION ${pause} TO ${role}`,
    ),
  ],
};
