/**
 * No function reads a pool, its registration tokens, the project owner
 * fallback or an execution's `owner_fallback`. The tables and the column stand,
 * read by nothing, and no row is touched.
 *
 * THE SHARED READS LOSE THEIR POOL ARM OR THEIR TEST OF THE PIN, and otherwise
 * answer as before for a personal runner and a chat host.
 * `session_runner_standing` keeps its signature and loses its `project_standing`
 * column, which changes its result type, so it is dropped and created again
 * with its owner and grants. `execution_attempt_agent_account` answers an
 * attempt's principal only for a personal runner's attempt.
 * `ticket_rate_limit_resumable` and `ticket_usage_resume` read the credentials
 * a personal runner of the execution's owner names, whatever the execution's
 * pin. `agent_account_pause_holding` and `retire_agent_account_credential` read
 * personal runners and chat hosts alone. These five are replaced in place,
 * keeping their attributes, owner and grants.
 *
 * A POOL'S OWN FUNCTIONS ARE DROPPED: its fence and release, the fallback's
 * writer, and the session holding with the five doors of 033 that call it.
 *
 * `project_deletion_holds` AND `delete_unrun_project` ARE LEFT AS THEY ARE,
 * since they name the tables only to hold and empty them while they stand.
 *
 * The bodies are written out, the runner poll window included, rather than
 * built from the helpers and constants earlier migrations use, so this file
 * goes on saying what it installed when those change.
 */

import {
  agentAccountCredentialRetireFunction,
  agentAccountFunction,
  agentAccountPauseHoldingFunction,
  apiRole,
  boundaryOwnerRole,
  poolSessionHeldFunction,
  poolSessionHoldingFunction,
  poolSessionImagesFunction,
  poolSessionRefuseFunction,
  poolSessionReleaseFunction,
  poolSessionRenewFunction,
  projectOwnerFallbackSetFunction,
  schedulerRole,
  sessionRunnerStandingFunction,
  ticketRateLimitResumableFunction,
  ticketUsageResumeFunction,
  workerPoolFenceFunction,
  workerPoolReleaseFunction,
  type Migration,
} from "../shared.ts";

/** Every function dropped, each by its signature, callers before what they call. */
export const droppedFunctionsAt213 = [
  `${workerPoolFenceFunction}(text,text,text)`,
  `${workerPoolReleaseFunction}(text,text,text,text,text)`,
  `${projectOwnerFallbackSetFunction}(text,text,text,text,text)`,
  `${poolSessionHeldFunction}(text,text,text,text,text)`,
  `${poolSessionRenewFunction}(text,text,text,text,text,bigint)`,
  `${poolSessionRefuseFunction}(text,text,text,text,text,text)`,
  `${poolSessionReleaseFunction}(text,text,text,text,text)`,
  `${poolSessionImagesFunction}(text,text,text,text,bigint)`,
  `${poolSessionHoldingFunction}(text,text,text,text)`,
] as const;

/** Every function replaced, each by its signature. */
export const replacedFunctionsAt213 = [
  `${sessionRunnerStandingFunction}(text,text,text,bigint)`,
  `${agentAccountFunction}(text,text,text,text)`,
  `${ticketRateLimitResumableFunction}(text,text,bigint,bigint,bigint)`,
  `${ticketUsageResumeFunction}(text,text,bigint,bigint,bigint)`,
  `${agentAccountPauseHoldingFunction}(text,text)`,
  `${agentAccountCredentialRetireFunction}(text,text,text)`,
] as const;

const standing = `public.${sessionRunnerStandingFunction}(in_tenant text, in_project text, in_member text, in_polled_secs_max bigint)`;

const standingCreated = `CREATE FUNCTION ${standing}
       RETURNS TABLE(member_standing text, inquiry_standing text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       WITH host AS (
         SELECT coalesce(h.last_polled_at > now() - make_interval(
                  secs => in_polled_secs_max::double precision), false) AS live
           FROM chat_host h
          WHERE h.tenant=in_tenant AND h.owner=in_member)
       SELECT (SELECT CASE WHEN bool_or(live) THEN 'Live'
                           WHEN count(*)>0 THEN 'Offline'
                           ELSE 'Unregistered' END FROM host),
              (SELECT CASE WHEN bool_or(live) THEN 'Live'
                           WHEN count(*)>0 THEN 'Offline'
                           ELSE 'Unregistered' END FROM host)
     $$`;

const agentAccount = `CREATE OR REPLACE FUNCTION public.${agentAccountFunction}(in_tenant text, in_project text, in_execution text, in_attempt text)
       RETURNS TABLE(principal text, agent text)
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
         SELECT CASE WHEN a.personal THEN a.pool END, a.agent
           FROM execution_attempt a
          WHERE a.tenant=in_tenant AND a.project=in_project
            AND a.execution=in_execution AND a.attempt=in_attempt
       $$`;

/** The tasks the ticket's newest spawn waits on, each counted at its place, that both resume reads share. */
const counted = `WITH ran AS (
         SELECT e.execution, e.task, e.source_request, e.outcome,
                t.kind, t.stage, t.evaluator, c.attempt, c.ended_at,
                COALESCE(e.status = 'Terminal' AND c.state = 'Lost'
                  AND c.evidence IN ('RunFailed', 'LeaseExpired', 'Fenced'),
                  false) AS lost,
                COALESCE(e.status = 'Terminal' AND e.outcome = 'ProcessFailed'
                  AND e.retries_spent = 0 AND c.claimed_at IS NOT NULL AND c.state = 'Withdrawn'
                  AND c.evidence = 'RunRateLimited',
                  false) AS limited
           FROM execution e
           JOIN execution_request_task t
             ON t.tenant = e.tenant AND t.project = e.project
            AND t.request = e.source_request AND t.task = e.task
           LEFT JOIN LATERAL (
             SELECT a.attempt, a.claimed_at, a.state, a.evidence, a.ended_at
               FROM execution_attempt a
              WHERE a.tenant = e.tenant AND a.project = e.project
                AND a.execution = e.execution AND a.pool IS NOT NULL
              ORDER BY a.attempt_number DESC
              LIMIT 1) c ON true
          WHERE e.tenant = in_tenant AND e.project = in_project
            AND e.ticket = in_ticket
       ),
       waiting AS (
         SELECT w.* FROM ran w
          WHERE w.outcome IS DISTINCT FROM 'Passed'
            AND w.source_request = (
              SELECT q.request FROM execution_request q
               WHERE q.tenant = in_tenant AND q.project = in_project
                 AND q.ticket = in_ticket
                 AND q.kind IN ('SpawnWork', 'SpawnEvaluation')
               ORDER BY q.authorizing_seq DESC, q.effect_position DESC
               LIMIT 1)
       ),
       counted AS (
         SELECT w.execution, w.attempt, w.ended_at, w.lost, w.limited,
                (SELECT count(*) FROM ran r
                  WHERE r.kind = w.kind
                    AND r.stage IS NOT DISTINCT FROM w.stage
                    AND r.evaluator IS NOT DISTINCT FROM w.evaluator AND r.lost
                    AND r.task <= w.task
                    AND r.task > COALESCE((
                      SELECT max(b.task) FROM ran b
                       WHERE b.kind = w.kind
                         AND b.stage IS NOT DISTINCT FROM w.stage
                         AND b.evaluator IS NOT DISTINCT FROM w.evaluator
                         AND b.task < w.task AND NOT b.lost), 0)) AS losses,
                (SELECT count(*) FROM ran r
                  WHERE r.kind = w.kind
                    AND r.stage IS NOT DISTINCT FROM w.stage
                    AND r.evaluator IS NOT DISTINCT FROM w.evaluator AND r.limited
                    AND r.task <= w.task
                    AND r.task > COALESCE((
                      SELECT max(b.task) FROM ran b
                       WHERE b.kind = w.kind
                         AND b.stage IS NOT DISTINCT FROM w.stage
                         AND b.evaluator IS NOT DISTINCT FROM w.evaluator
                         AND b.task < w.task AND NOT b.lost AND NOT b.limited), 0)) AS limits
           FROM waiting w
       )`;

/** The credentials the personal runner of the execution's owner names of the agent the limited task of `c` spent, `s`, one row each. */
const runnerNamed = `SELECT r.credentials_named->s.agent AS named
              FROM personal_runner r
              JOIN personal_runner_project l
                ON l.tenant = r.tenant AND l.owner = r.owner
               AND l.project = in_project
              JOIN execution x
                ON x.tenant = in_tenant AND x.project = in_project
               AND x.execution = c.execution
             WHERE r.tenant = in_tenant AND r.owner = s.principal
               AND x.owner = r.owner
               AND r.credentials_named->s.agent IS NOT NULL`;

const rateLimitResumable = `CREATE OR REPLACE FUNCTION public.${ticketRateLimitResumableFunction}(in_tenant text, in_project text, in_ticket bigint, in_losses_max bigint, in_rate_limits_max bigint)
       RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       ${counted},
       held AS (
         SELECT c.lost, c.limited, c.losses, c.limits,
                CASE WHEN c.limited THEN CASE WHEN s.principal IS NULL OR s.agent IS NULL
                  THEN c.ended_at + interval '1 hour'
                ELSE (SELECT CASE WHEN bool_or(p.paused_until IS NULL OR p.admitted_by_press)
                                    THEN NULL
                                  ELSE min(p.paused_until) END
                        FROM (SELECT h.paused_until, h.admitted_by_press
                                FROM agent_account_pause(s.principal, s.agent) h
                              UNION ALL
                              SELECT n.paused_until, n.admitted_by_press
                                FROM (${runnerNamed}) k
                               CROSS JOIN LATERAL agent_account_named_pause(
                                       s.principal, s.agent,
                                       ARRAY(SELECT jsonb_array_elements_text(k.named))) n) p)
                END END AS until
           FROM counted c
           LEFT JOIN LATERAL ${agentAccountFunction}(in_tenant, in_project,
                  c.execution, c.attempt) s ON c.limited
       )
       SELECT EXISTS (
                SELECT 1 FROM ticket_projection t
                 WHERE t.tenant = in_tenant AND t.project = in_project
                   AND t.ticket = in_ticket
                   AND t.escalation IN ('WorkFailureEscalated', 'EvaluationBlockedEscalated'))
          AND EXISTS (SELECT 1 FROM held h WHERE h.limited)
          AND NOT EXISTS (
                SELECT 1 FROM held h
                 WHERE NOT COALESCE(
                   (h.lost AND h.losses < in_losses_max)
                   OR (h.limited AND h.limits < in_rate_limits_max
                       AND (h.until IS NULL OR h.until <= now())),
                   false))
     $$`;

const usageResume = `CREATE OR REPLACE FUNCTION public.${ticketUsageResumeFunction}(in_tenant text, in_project text, in_ticket bigint, in_losses_max bigint, in_rate_limits_max bigint)
       RETURNS TABLE(paused_until timestamp with time zone, off boolean)
    LANGUAGE sql STABLE SECURITY DEFINER ROWS 1
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       ${counted},
       held AS (
         SELECT c.lost, c.limited, c.losses, c.limits,
                CASE WHEN NOT c.limited THEN NULL
                     WHEN s.principal IS NULL OR s.agent IS NULL
                       THEN c.ended_at + interval '1 hour'
                     ELSE u.until END AS until,
                COALESCE(u.off, false) AS off
           FROM counted c
           LEFT JOIN LATERAL ${agentAccountFunction}(in_tenant, in_project,
                  c.execution, c.attempt) s ON c.limited
           LEFT JOIN LATERAL (SELECT CASE WHEN bool_or(p.paused_until IS NULL OR p.admitted_by_press)
                         THEN NULL
                       ELSE min(p.paused_until) END AS until,
                  COALESCE(NOT bool_or(p.paused_until IS NULL OR p.admitted_by_press)
                           AND bool_and(p.reasons = '{off}'::text[]), false) AS off
             FROM (SELECT h.paused_until, h.reasons, h.admitted_by_press
                     FROM agent_account_pause(s.principal, s.agent) h
                   UNION ALL
                   SELECT n.paused_until, n.reasons, n.admitted_by_press
                     FROM (${runnerNamed}) k
                    CROSS JOIN LATERAL agent_account_named_pause(
                            s.principal, s.agent,
                            ARRAY(SELECT jsonb_array_elements_text(k.named))) n) p) u
             ON c.limited AND s.principal IS NOT NULL AND s.agent IS NOT NULL
       )
       SELECT CASE WHEN bool_or(h.limited AND h.off) THEN NULL
                   ELSE max(h.until) FILTER (WHERE h.until > now()) END,
              bool_or(h.limited AND h.off)
         FROM held h
        WHERE EXISTS (
                SELECT 1 FROM ticket_projection t
                  JOIN project p ON p.tenant = t.tenant AND p.project = t.project
                 WHERE t.tenant = in_tenant AND t.project = in_project
                   AND t.ticket = in_ticket
                   AND p.lifecycle = 'Active'
                   AND t.escalation IN ('WorkFailureEscalated', 'EvaluationBlockedEscalated'))
       HAVING bool_or(h.limited)
          AND bool_and((h.lost AND h.losses < in_losses_max)
                       OR (h.limited AND h.limits < in_rate_limits_max))
     $$`;

const pauseHolding = `CREATE OR REPLACE FUNCTION public.${agentAccountPauseHoldingFunction}(in_principal text, in_agent text)
       RETURNS TABLE(paused_until timestamp with time zone, reasons text[], admitted_by_press boolean, credentials text[])
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
         WITH live AS (
           SELECT r.credentials_named->in_agent AS named
             FROM personal_runner r
            WHERE r.owner=in_principal AND r.last_polled_at>now()-make_interval(secs=>120)
           UNION ALL
           SELECT h.credentials_named->in_agent
             FROM chat_host h
            WHERE h.owner=in_principal AND h.last_polled_at>now()-make_interval(secs=>120)),
         given AS (
           SELECT ARRAY(SELECT DISTINCT n.credential
                          FROM live l
                         CROSS JOIN LATERAL jsonb_array_elements_text(l.named) n(credential)
                         WHERE l.named IS NOT NULL) AS credentials),
         paused AS (
           SELECT c.credential
             FROM agent_account_credential_pause(in_principal,in_agent) c),
         held AS (
           SELECT h.credential, max(h.until) AS paused_until,
                  array_agg(h.reason ORDER BY h.reason) AS reasons
             FROM agent_account_credential_holds(in_principal,in_agent) h
            WHERE h.reason<>'off'
            GROUP BY h.credential),
         counted AS (
           SELECT p.credential FROM paused p CROSS JOIN given g
            WHERE cardinality(g.credentials)>0 AND p.credential=ANY(g.credentials)
           UNION ALL
           SELECT h.credential FROM held h CROSS JOIN given g
            WHERE cardinality(g.credentials)=0),
         holding AS (
           SELECT DISTINCT r.reason FROM held h CROSS JOIN LATERAL unnest(h.reasons) r(reason)),
         limited AS (
           SELECT max(l.observed_at) AS observed_at
             FROM held h
             JOIN agent_account_limit l
               ON l.principal=in_principal AND l.agent=in_agent
              AND l.credential=h.credential
            WHERE 'limit'=ANY(h.reasons)),
         answered AS (
           SELECT n.paused_until, n.reasons, n.admitted_by_press
             FROM given g
            CROSS JOIN LATERAL agent_account_named_pause(in_principal,in_agent,g.credentials) n
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
            WHERE cardinality(g.credentials)=0)
         SELECT a.paused_until, a.reasons, a.admitted_by_press,
                CASE WHEN a.paused_until IS NULL THEN '{}'::text[]
                     ELSE ARRAY(SELECT c.credential FROM counted c
                                 ORDER BY c.credential COLLATE "C") END
           FROM answered a
       $$`;

const retire = `CREATE OR REPLACE FUNCTION public.${agentAccountCredentialRetireFunction}(in_principal text, in_agent text, in_credential text)
       RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
         DECLARE readings integer; limits integer;
         BEGIN
           PERFORM pg_advisory_xact_lock(hashtextextended(
             'agent-account-credential:' || in_principal || '/' || in_agent, 0));
           IF NOT EXISTS(SELECT 1 FROM agent_account_usage u
                          WHERE u.principal=in_principal AND u.agent=in_agent
                            AND u.credential=in_credential)
              AND NOT EXISTS(SELECT 1 FROM agent_account_limit l
                              WHERE l.principal=in_principal AND l.agent=in_agent
                                AND l.credential=in_credential) THEN
             RETURN 'NotHeld';
           END IF;
           IF NOT EXISTS(SELECT 1 FROM agent_account_credential_off o
                          WHERE o.principal=in_principal AND o.agent=in_agent
                            AND o.credential=in_credential)
              AND (EXISTS(SELECT 1 FROM personal_runner r
                           WHERE r.owner=in_principal AND r.last_polled_at>now()-make_interval(secs=>120)
                             AND COALESCE(r.credentials_named->in_agent ? in_credential,false))
                   OR EXISTS(SELECT 1 FROM chat_host h
                              WHERE h.owner=in_principal AND h.last_polled_at>now()-make_interval(secs=>120)
                                AND COALESCE(h.credentials_named->in_agent ? in_credential,false))) THEN
             RETURN 'CredentialInUse';
           END IF;
           DELETE FROM agent_account_usage u
            WHERE u.principal=in_principal AND u.agent=in_agent
              AND u.credential=in_credential;
           GET DIAGNOSTICS readings = ROW_COUNT;
           DELETE FROM agent_account_limit l
            WHERE l.principal=in_principal AND l.agent=in_agent
              AND l.credential=in_credential;
           GET DIAGNOSTICS limits = ROW_COUNT;
           IF readings + limits = 0 THEN
             RAISE EXCEPTION '${agentAccountCredentialRetireFunction}: a held credential deleted no row';
           END IF;
           RETURN 'Retired';
         END $$`;

export const migration213: Migration = {
  version: 213,
  name: "no function reads a pool or an execution's owner fallback",
  statements: [
    ...droppedFunctionsAt213.map(
      (signature) => `DROP FUNCTION public.${signature}`,
    ),
    `DROP FUNCTION ${standing}`,
    standingCreated,
    `ALTER FUNCTION ${standing} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${standing} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${standing} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${standing} TO ${schedulerRole}`,
    agentAccount,
    rateLimitResumable,
    usageResume,
    pauseHolding,
    retire,
  ],
};
