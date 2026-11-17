/**
 * A person turns a credential of an agent of their account off by name, and
 * every runner of theirs is held off it until they turn it on again.
 *
 * `agent_account_credential_off` HOLDS ONE ROW PER CREDENTIAL TURNED OFF, keyed
 * by principal, agent and name, held to 110's account key and 163's name
 * pattern. A name needs no reading or limit to be turned off. The off names of
 * one account's agent are bounded by `agentAccountCredentialsOffMaxAt191`,
 * apart from the credentials `agent_account_credential_kept` bounds, which
 * never counts them, so no reading evicts an off name and no off name evicts
 * a reading.
 *
 * `agent_account_credential_holds` IS 163'S HOLDING RULE, moved whole, with a
 * hold of reason `off` for each off name, ending
 * `agentAccountCredentialOffSecsAt191` after the read: past every window's
 * end, so an off end ranks after every real one, and read again at each read,
 * so it never comes. No role is granted it.
 *
 * `agent_account_credential_pause` GROUPS THOSE HOLDS, its signature and its
 * answer kept, and answers an off credential as `off` alone, so the pool
 * plane's credential pauses, its claims and the waiting counts hold a runner
 * off it unchanged. `agent_account_named_pause` answers the earliest end among
 * the credentials it is given not held by `off` alone, and the off end only
 * where every one is; a press admits through a limit beside an off credential,
 * and nothing where every one is off. Where no live runner names a credential
 * of the agent, `agent_account_pause_holding` reads the holds without their
 * `off` rows, so an off credential pauses there only by its own readings and
 * limit; where they name some, an off name counts as any paused name does.
 *
 * A PAUSE WHOSE REASONS ARE `off` ALONE NEVER ENDS BY ITSELF. It holds a thread
 * or an inquiry whatever its owner's setting, since a chat host would otherwise
 * run it on the credential turned off. `lead_runner_standing` and
 * `read_lead_refusal` answer `off` where every live pool's pause is off alone,
 * and otherwise the earliest end among the rest. `ticket_usage_resume` answers
 * `off` where any task it waits on waits only on such pauses, and no end, since
 * that ticket never resumes by itself; `ticket_rate_limit_resumable` holds it
 * by the off end. `agent_account_credential_standing` lists every off name of
 * the person among their credentials. Each of these three is dropped and
 * created again for its answer, with its attributes, owner and grants.
 *
 * `turn_off_agent_account_credential` AND `turn_on_agent_account_credential`
 * are the API's doors, under the lock `agent_account_credential_kept` takes.
 * Turning off answers `Off`, also for a name already off, or `OffFull` at the
 * bound; turning on answers `On`, or `NotOff` where the name was not off.
 * `retire_agent_account_credential` never refuses an off credential as in use,
 * since no runner runs on it, and leaves it off.
 */

import {
  agentAccountCredentialHoldsFunction,
  agentAccountCredentialOffFunction,
  agentAccountCredentialOnFunction,
  agentAccountCredentialPauseFunction,
  agentAccountCredentialRetireFunction,
  agentAccountCredentialStandingFunction,
  agentAccountFunction,
  agentAccountNamedPauseFunction,
  agentAccountPauseFunction,
  agentAccountPauseHoldingFunction,
  agentAccountSessionPausedFunction,
  agentAccountSettingsFunction,
  apiRole,
  boundaryOwnerRole,
  leadRefusalReadFunction,
  leadRunnerStandingFunction,
  selectorServiceRole,
  ticketUsageResumeFunction,
  type Migration,
} from "../shared.ts";
import { placeCount } from "./111-rate-limit-resume.ts";
import { agentAccountRunnerPolledSecsMaxAt170 } from "./170-agent-account-pause-live-credentials.ts";
import { agentAccountRunnerPolledSecsMaxAt171 } from "./171-agent-account-credential-retire.ts";

/** How long past each read an off credential's hold ends: past the longest usage window, so every real end ranks before it. */
export const agentAccountCredentialOffSecsAt191 = 2_592_000;

/** The most credentials of one account's agent turned off at once, as many as a runner names of one agent. */
export const agentAccountCredentialsOffMaxAt191 = 16;

const holds = `public.${agentAccountCredentialHoldsFunction}(in_principal text, in_agent text)`;
const credentialPause = `public.${agentAccountCredentialPauseFunction}(in_principal text, in_agent text)`;
const named = `public.${agentAccountNamedPauseFunction}(in_principal text, in_agent text, in_credentials text[])`;
const holding = `public.${agentAccountPauseHoldingFunction}(in_principal text, in_agent text)`;
const sessionPaused = `public.${agentAccountSessionPausedFunction}(in_principal text, in_kind text, in_credentials text[])`;
const leadRunners = `public.${leadRunnerStandingFunction}(in_tenant text, in_project text, in_polled_secs_max bigint)`;
const refusalRead = `public.${leadRefusalReadFunction}(in_tenant text, in_project text, in_polled_secs_max bigint)`;
const usageResume = `public.${ticketUsageResumeFunction}(in_tenant text, in_project text, in_ticket bigint, in_losses_max bigint, in_rate_limits_max bigint)`;
const standing = `public.${agentAccountCredentialStandingFunction}(in_principal text)`;
const turnOff = `public.${agentAccountCredentialOffFunction}(in_principal text, in_agent text, in_credential text)`;
const turnOn = `public.${agentAccountCredentialOnFunction}(in_principal text, in_agent text, in_credential text)`;
const retire = `public.${agentAccountCredentialRetireFunction}(in_principal text, in_agent text, in_credential text)`;

const polledSince = `now()-make_interval(secs=>${String(agentAccountRunnerPolledSecsMaxAt170)})`;
const retirePolledSince = `now()-make_interval(secs=>${String(agentAccountRunnerPolledSecsMaxAt171)})`;

/** The reasons of a pause held by `off` alone. */
const offAlone = `'{off}'::text[]`;

/** The lock per account's agent `agent_account_credential_kept` takes. */
const keptLock = `PERFORM pg_advisory_xact_lock(hashtextextended(
             'agent-account-credential:' || in_principal || '/' || in_agent, 0));`;

/** 110's account key, its constraints named for `relation`. */
function accountKey(relation: string): string {
  return `principal text NOT NULL
         CONSTRAINT ${relation}_principal_is_bounded
         CHECK (length(principal) BETWEEN 1 AND 256),
       agent text NOT NULL
         CONSTRAINT ${relation}_agent_is_known CHECK (agent IN ('Claude','Codex'))`;
}

/** The owner a function is installed under, callable by `roles` alone. */
function owned(signature: string, roles: readonly string[]): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...roles.map((role) => `GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`),
  ];
}

/** The names a runner's kept `credentials_named`, `named`, gives Claude, as an array, empty where it gave none. */
function claudeNamed(namedColumn: string): string {
  return `ARRAY(SELECT jsonb_array_elements_text(${namedColumn}->'Claude'))`;
}

/** Until when and why `principal`'s Claude is paused for a runner that gave it `credentials`: the named rule where it gave some, the whole agent's where it gave none. */
function claudePause(principal: string, credentials: string): string {
  return `(SELECT h.paused_until, h.reasons
             FROM ${agentAccountPauseFunction}(${principal},'Claude') h
            WHERE COALESCE(cardinality(${credentials}),0)=0
           UNION ALL
           SELECT h.paused_until, h.reasons
             FROM ${agentAccountNamedPauseFunction}(${principal},'Claude',${credentials}) h
            WHERE COALESCE(cardinality(${credentials}),0)>0)`;
}

/** The credentials each runner of account `spent` names of its agent, for the task of `task`, one row each. */
function heldNamed(task: string, spent: string): string {
  return `SELECT w.credentials_named->${spent}.agent AS named
              FROM worker_pool w
             WHERE w.tenant = in_tenant AND w.project = in_project
               AND w.registered_by = ${spent}.principal
               AND w.credentials_named->${spent}.agent IS NOT NULL
            UNION ALL
            SELECT r.credentials_named->${spent}.agent
              FROM personal_runner r
              JOIN personal_runner_project l
                ON l.tenant = r.tenant AND l.owner = r.owner
               AND l.project = in_project
              JOIN execution x
                ON x.tenant = in_tenant AND x.project = in_project
               AND x.execution = ${task}.execution
             WHERE r.tenant = in_tenant AND r.owner = ${spent}.principal
               AND x.owner = r.owner AND x.owner_fallback IS NOT NULL
               AND r.credentials_named->${spent}.agent IS NOT NULL`;
}

/** Until when the limited task of `task`, whose account is `spent`, waits, and whether only off pauses hold it: none where a pause rule lets a claim through, else the earliest end among its account's pauses. */
function heldUntil(task: string, spent: string): string {
  return `(SELECT CASE WHEN bool_or(p.paused_until IS NULL OR p.admitted_by_press)
                         THEN NULL
                       ELSE min(p.paused_until) END AS until,
                  COALESCE(NOT bool_or(p.paused_until IS NULL OR p.admitted_by_press)
                           AND bool_and(p.reasons = ${offAlone}), false) AS off
             FROM (SELECT h.paused_until, h.reasons, h.admitted_by_press
                     FROM ${agentAccountPauseFunction}(${spent}.principal, ${spent}.agent) h
                   UNION ALL
                   SELECT n.paused_until, n.reasons, n.admitted_by_press
                     FROM (${heldNamed(task, spent)}) k
                    CROSS JOIN LATERAL ${agentAccountNamedPauseFunction}(
                            ${spent}.principal, ${spent}.agent,
                            ARRAY(SELECT jsonb_array_elements_text(k.named))) n) p)`;
}

/** The tasks the ticket's newest spawn waits on, each counted at its place as 111 counts it, until when each a limit stopped waits, and whether only off pauses hold it. */
const held = `WITH ran AS (
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
                ${placeCount(
                  "w",
                  (r) => `${r}.lost`,
                  (b) => `NOT ${b}.lost`,
                )} AS losses,
                ${placeCount(
                  "w",
                  (r) => `${r}.limited`,
                  (b) => `NOT ${b}.lost AND NOT ${b}.limited`,
                )} AS limits
           FROM waiting w
       ),
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
           LEFT JOIN LATERAL ${heldUntil("c", "s")} u
             ON c.limited AND s.principal IS NOT NULL AND s.agent IS NOT NULL
       )`;

export const migration191: Migration = {
  version: 191,
  name: "a person turns a credential of their agent account off by name, and every runner of theirs is held off it",
  statements: [
    `CREATE TABLE public.agent_account_credential_off (
       ${accountKey("agent_account_credential_off")},
       credential text NOT NULL
         CONSTRAINT agent_account_credential_off_credential_is_named
         CHECK (credential ~ '^[A-Za-z0-9_-]{1,64}$'),
       PRIMARY KEY (principal,agent,credential))`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.agent_account_credential_off TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${holds}
       RETURNS TABLE(credential text, reason text, until timestamp with time zone)
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT u.credential, u.usage_window, u.resets_at
           FROM agent_account_usage u
          CROSS JOIN ${agentAccountSettingsFunction}(in_principal,in_agent) t
          WHERE u.principal=in_principal AND u.agent=in_agent
            AND u.resets_at>now()
            AND u.utilization>=(CASE u.usage_window
                                  WHEN 'five_hour' THEN t.five_hour_percent
                                  WHEN 'seven_day' THEN t.seven_day_percent
                                END)::double precision/100
         UNION ALL
         SELECT l.credential, 'limit', COALESCE(l.resets_at,l.observed_at+interval '1 hour')
           FROM agent_account_limit l
          WHERE l.principal=in_principal AND l.agent=in_agent
            AND COALESCE(l.resets_at,l.observed_at+interval '1 hour')>now()
            AND NOT EXISTS(SELECT 1 FROM agent_account_usage u
                            WHERE u.principal=l.principal AND u.agent=l.agent
                              AND u.credential=l.credential
                              AND u.observed_at>l.observed_at)
         UNION ALL
         SELECT o.credential, 'off',
                now()+make_interval(secs=>${String(agentAccountCredentialOffSecsAt191)})
           FROM agent_account_credential_off o
          WHERE o.principal=in_principal AND o.agent=in_agent
       $$`,
    ...owned(holds, []),
    `CREATE OR REPLACE FUNCTION ${credentialPause}
       RETURNS TABLE(credential text, paused_until timestamp with time zone, reasons text[])
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         WITH holding AS (
           SELECT h.credential, h.reason, h.until
             FROM ${agentAccountCredentialHoldsFunction}(in_principal,in_agent) h)
         SELECT h.credential, max(h.until), array_agg(h.reason ORDER BY h.reason)
           FROM holding h
          WHERE h.reason='off'
             OR NOT EXISTS(SELECT 1 FROM holding o
                            WHERE o.credential=h.credential AND o.reason='off')
          GROUP BY h.credential
          ORDER BY h.credential
       $$`,
    `CREATE OR REPLACE FUNCTION ${named}
       RETURNS TABLE(paused_until timestamp with time zone, reasons text[], admitted_by_press boolean)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         WITH given AS (
           SELECT DISTINCT n.credential FROM unnest(in_credentials) n(credential)),
         held AS (
           SELECT c.credential, c.paused_until, c.reasons
             FROM ${agentAccountCredentialPauseFunction}(in_principal,in_agent) c
             JOIN given g ON g.credential=c.credential),
         paused AS (
           SELECT h.* FROM held h
            WHERE EXISTS(SELECT 1 FROM given)
              AND NOT EXISTS(SELECT 1 FROM given g
                              WHERE NOT EXISTS(SELECT 1 FROM held n
                                                WHERE n.credential=g.credential))),
         holding AS (
           SELECT DISTINCT r.reason FROM paused h CROSS JOIN LATERAL unnest(h.reasons) r(reason)),
         limited AS (
           SELECT max(l.observed_at) AS observed_at
             FROM paused h
             JOIN agent_account_limit l
               ON l.principal=in_principal AND l.agent=in_agent
              AND l.credential=h.credential
            WHERE 'limit'=ANY(h.reasons))
         SELECT COALESCE((SELECT min(h.paused_until) FROM paused h
                           WHERE h.reasons<>${offAlone}),
                         (SELECT min(h.paused_until) FROM paused h)),
                (SELECT COALESCE(array_agg(r.reason ORDER BY r.reason),'{}'::text[])
                   FROM holding r),
                COALESCE((SELECT bool_and(r.reason='limit') FROM holding r
                           WHERE r.reason<>'off'),false)
                  AND EXISTS(SELECT 1 FROM agent_account_press p
                              CROSS JOIN limited m
                              WHERE p.principal=in_principal AND p.agent=in_agent
                                AND p.spent_at IS NULL
                                AND p.pressed_at>m.observed_at)
       $$`,
    `CREATE OR REPLACE FUNCTION ${holding}
       RETURNS TABLE(paused_until timestamp with time zone, reasons text[],
         admitted_by_press boolean, credentials text[])
       LANGUAGE sql STABLE
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
         paused AS (
           SELECT c.credential
             FROM ${agentAccountCredentialPauseFunction}(in_principal,in_agent) c),
         held AS (
           SELECT h.credential, max(h.until) AS paused_until,
                  array_agg(h.reason ORDER BY h.reason) AS reasons
             FROM ${agentAccountCredentialHoldsFunction}(in_principal,in_agent) h
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
            WHERE cardinality(g.credentials)=0)
         SELECT a.paused_until, a.reasons, a.admitted_by_press,
                CASE WHEN a.paused_until IS NULL THEN '{}'::text[]
                     ELSE ARRAY(SELECT c.credential FROM counted c
                                 ORDER BY c.credential COLLATE "C") END
           FROM answered a
       $$`,
    `CREATE OR REPLACE FUNCTION ${sessionPaused} RETURNS boolean
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT CASE WHEN in_kind='Lead' THEN true
                     WHEN in_kind IN ('Thread','Inquiry')
                       THEN t.pauses_threads OR held.reasons=${offAlone}
                     ELSE false END
                AND held.paused_until IS NOT NULL
           FROM ${agentAccountSettingsFunction}(in_principal,'Claude') t
          CROSS JOIN ${claudePause("in_principal", "in_credentials")} held
       $$`,
    `DROP FUNCTION ${refusalRead}`,
    `DROP FUNCTION ${leadRunners}`,
    `CREATE FUNCTION ${leadRunners}
       RETURNS TABLE(standing text, paused_until timestamp with time zone, off boolean)
       LANGUAGE sql STABLE SECURITY DEFINER ROWS 1
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH live AS (
         SELECT w.registered_by,${claudeNamed("w.credentials_named")} AS named
           FROM worker_pool w
          WHERE w.tenant=in_tenant AND w.project=in_project
            AND w.last_polled_at > now() - make_interval(
                  secs => in_polled_secs_max::double precision)),
       held AS (
         SELECT ${agentAccountSessionPausedFunction}(l.registered_by,'Lead',l.named) AS paused,
                h.paused_until, COALESCE(h.reasons=${offAlone},false) AS off
           FROM live l
          CROSS JOIN LATERAL ${claudePause("l.registered_by", "l.named")} h)
       SELECT CASE WHEN bool_or(NOT h.paused) THEN 'Live'
                   WHEN bool_or(h.paused) THEN 'Paused'
                   ELSE 'Offline' END,
              CASE WHEN NOT COALESCE(bool_or(NOT h.paused),false)
                   THEN min(h.paused_until) FILTER (WHERE NOT h.off) END,
              COALESCE(NOT bool_or(NOT h.paused) AND bool_and(h.off),false)
         FROM held h
     $$`,
    ...owned(leadRunners, [selectorServiceRole]),
    `CREATE FUNCTION ${refusalRead}
       RETURNS TABLE(refusal text, refused_since timestamp with time zone,
         paused_until timestamp with time zone, off boolean)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT r.refusal,r.refused_since,
              CASE WHEN r.refusal='SubsidyExhausted'
                   THEN ((date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC')
                   ELSE s.paused_until END,
              COALESCE(s.off,false)
         FROM selector_lead_refusal r
         LEFT JOIN LATERAL ${leadRunnerStandingFunction}(r.tenant,r.project,in_polled_secs_max) s
           ON r.refusal='UsagePaused'
        WHERE r.tenant=in_tenant AND r.project=in_project
     $$`,
    ...owned(refusalRead, [apiRole]),
    `DROP FUNCTION ${usageResume}`,
    `CREATE FUNCTION ${usageResume}
       RETURNS TABLE(paused_until timestamp with time zone, off boolean)
       LANGUAGE sql STABLE SECURITY DEFINER ROWS 1
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       ${held}
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
     $$`,
    ...owned(usageResume, [apiRole]),
    `DROP FUNCTION ${standing}`,
    `CREATE FUNCTION ${standing}
       RETURNS TABLE(agent text, credential text,
         five_hour_utilization double precision, five_hour_resets_at timestamp with time zone,
         five_hour_observed_at timestamp with time zone,
         seven_day_utilization double precision, seven_day_resets_at timestamp with time zone,
         seven_day_observed_at timestamp with time zone,
         paused_until timestamp with time zone, reasons text[], admitted_by_press boolean)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH held AS (
         SELECT u.agent, u.credential FROM agent_account_usage u
          WHERE u.principal = in_principal
         UNION
         SELECT l.agent, l.credential FROM agent_account_limit l
          WHERE l.principal = in_principal
         UNION
         SELECT o.agent, o.credential FROM agent_account_credential_off o
          WHERE o.principal = in_principal)
       SELECT h.agent, h.credential,
              f.utilization, f.resets_at, f.observed_at,
              w.utilization, w.resets_at, w.observed_at,
              p.paused_until, p.reasons, p.admitted_by_press
         FROM held h
         JOIN (VALUES (1, 'Claude'), (2, 'Codex')) k(position, agent) ON k.agent = h.agent
        CROSS JOIN LATERAL ${agentAccountNamedPauseFunction}(in_principal, h.agent, ARRAY[h.credential]) p
         LEFT JOIN agent_account_usage f
           ON f.principal = in_principal AND f.agent = h.agent
          AND f.credential = h.credential AND f.usage_window = 'five_hour'
         LEFT JOIN agent_account_usage w
           ON w.principal = in_principal AND w.agent = h.agent
          AND w.credential = h.credential AND w.usage_window = 'seven_day'
        ORDER BY k.position, h.credential COLLATE "C"
     $$`,
    ...owned(standing, [apiRole]),
    `CREATE FUNCTION ${turnOff} RETURNS text
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         BEGIN
           ${keptLock}
           IF EXISTS(SELECT 1 FROM agent_account_credential_off o
                      WHERE o.principal=in_principal AND o.agent=in_agent
                        AND o.credential=in_credential) THEN
             RETURN 'Off';
           END IF;
           IF (SELECT count(*) FROM agent_account_credential_off o
                WHERE o.principal=in_principal AND o.agent=in_agent)
              >= ${String(agentAccountCredentialsOffMaxAt191)} THEN
             RETURN 'OffFull';
           END IF;
           INSERT INTO agent_account_credential_off(principal,agent,credential)
             VALUES(in_principal,in_agent,in_credential);
           RETURN 'Off';
         END $$`,
    ...owned(turnOff, [apiRole]),
    `CREATE FUNCTION ${turnOn} RETURNS text
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         BEGIN
           ${keptLock}
           DELETE FROM agent_account_credential_off o
            WHERE o.principal=in_principal AND o.agent=in_agent
              AND o.credential=in_credential;
           IF FOUND THEN RETURN 'On'; END IF;
           RETURN 'NotOff';
         END $$`,
    ...owned(turnOn, [apiRole]),
    `CREATE OR REPLACE FUNCTION ${retire} RETURNS text
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE readings integer; limits integer;
         BEGIN
           ${keptLock}
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
                           WHERE r.owner=in_principal AND r.last_polled_at>${retirePolledSince}
                             AND COALESCE(r.credentials_named->in_agent ? in_credential,false))
                   OR EXISTS(SELECT 1 FROM worker_pool w
                              WHERE w.registered_by=in_principal
                                AND greatest(w.last_polled_at,w.executions_polled_at)>${retirePolledSince}
                                AND COALESCE(w.credentials_named->in_agent ? in_credential,false))
                   OR EXISTS(SELECT 1 FROM chat_host h
                              WHERE h.owner=in_principal AND h.last_polled_at>${retirePolledSince}
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
             RAISE EXCEPTION 'retire_agent_account_credential: a held credential deleted no row';
           END IF;
           RETURN 'Retired';
         END $$`,
  ],
};
