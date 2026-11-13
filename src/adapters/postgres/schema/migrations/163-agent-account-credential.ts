/**
 * An account's usage and its limit are kept per credential, and an agent of
 * the account is paused while any of its credentials is.
 *
 * THE CREDENTIAL IS NAMED BY THE POD, the one part of the key it names: the
 * account is still derived from the attempt's own claim, as 109 derives it.
 * `agent_account_usage` and `agent_account_limit` each gain `credential`, held
 * to the pattern a credential's name is written in, and it joins each primary
 * key, so a reading or a limit of one credential replaces no other's. A run
 * naming none is kept under its agent's default name, the one a runner
 * holding a single credential of that agent gives it, and every row kept
 * before this migration is lifted to that name, none dropped.
 *
 * BOTH DOORS TAKE THE NAME as a last argument defaulting to none, each
 * dropped and recreated with it, so a pod of the release before this one,
 * calling either at its old arity, resolves to the same door and lands under
 * the default. The limit door's body is 134's with the name added: an attempt
 * whose runner benches its credential still writes `execution_attempt_limit`
 * and no account limit.
 *
 * THE POD BOUNDS NOTHING IT NAMES, so the distinct credentials kept per
 * account's agent are bounded by `agentAccountCredentialsKeptMaxAt163`. A
 * reading or a limit of a credential not yet kept, arriving at the bound,
 * drops every row of the kept credential observed least recently, and the
 * arriving one is kept: a person who renames their credentials goes on being
 * kept under their new names, and the old ones' rows, which no run refreshes,
 * are what make room. `agent_account_credential_kept` is that rule, run by
 * both doors under one lock per account's agent, so two first readings of new
 * credentials cannot both pass the bound.
 *
 * `agent_account_credential_pause` IS THE RULE PER CREDENTIAL, 110's applied
 * to each credential's own rows: a reading pauses its credential until its
 * reset while that window is at or over its threshold, and a limit pauses its
 * credential until its reset, or an hour after it arrived where it named
 * none, unless a reading of the same credential was observed after it.
 * `agent_account_pause` keeps its signature and its answer's shape, and
 * answers paused while any credential is, until the latest ends, with each
 * reason once; a press admits one claim where every reason that holds is a
 * limit and it was made after the newest of those limits arrived. Thresholds,
 * settings and presses stay per account's agent.
 *
 * `agent_account_standing` answers each window's newest reading and the
 * newest limit across the account's credentials, its answer's shape
 * unchanged.
 */

import {
  agentAccountCredentialKeptFunction,
  agentAccountCredentialPauseFunction,
  agentAccountFunction,
  agentAccountPauseFunction,
  agentAccountSettingsFunction,
  agentAccountStandingFunction,
  boundaryOwnerRole,
  workerPlaneRole,
  workerRunLimitFunction,
  workerRunUsageFunction,
  type Migration,
} from "../shared.ts";

/** The most distinct credentials kept of one account's agent, across its readings and its limits. */
export const agentAccountCredentialsKeptMaxAt163 = 16;

const usageOld = `public.${workerRunUsageFunction}(in_secret_digest text, in_generation bigint, in_usage jsonb)`;
const usage = `public.${workerRunUsageFunction}(in_secret_digest text, in_generation bigint, in_usage jsonb, in_credential text)`;
const usageCreated = `public.${workerRunUsageFunction}(in_secret_digest text, in_generation bigint, in_usage jsonb, in_credential text DEFAULT NULL)`;

const limitOld = `public.${workerRunLimitFunction}(in_secret_digest text, in_generation bigint, in_window text, in_resets_at bigint)`;
const limit = `public.${workerRunLimitFunction}(in_secret_digest text, in_generation bigint, in_window text, in_resets_at bigint, in_credential text)`;
const limitCreated = `public.${workerRunLimitFunction}(in_secret_digest text, in_generation bigint, in_window text, in_resets_at bigint, in_credential text DEFAULT NULL)`;

const kept = `public.${agentAccountCredentialKeptFunction}(in_principal text, in_agent text, in_credential text)`;

const credentialPause = `public.${agentAccountCredentialPauseFunction}(in_principal text, in_agent text)`;

const pause = `public.${agentAccountPauseFunction}(in_principal text, in_agent text)`;

const standing = `public.${agentAccountStandingFunction}(in_principal text)`;

/** Each relation gains the credential, every row lifted to its agent's default name, and the credential joins its key. */
function credentialKeyed(relation: string, key: string): readonly string[] {
  return [
    `ALTER TABLE public.${relation} ADD COLUMN credential text`,
    `UPDATE public.${relation}
        SET credential=CASE agent WHEN 'Claude' THEN 'claude' WHEN 'Codex' THEN 'codex' END`,
    `ALTER TABLE public.${relation}
       ALTER COLUMN credential SET NOT NULL,
       ADD CONSTRAINT ${relation}_credential_is_named
         CHECK (credential ~ '^[A-Za-z0-9_-]{1,64}$'),
       DROP CONSTRAINT ${relation}_pkey,
       ADD PRIMARY KEY (${key})`,
  ];
}

/** The owner a function is installed under, callable by `role` or by nobody but its owner. */
function owned(signature: string, role?: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...(role === undefined
      ? []
      : [`GRANT ALL ON FUNCTION ${signature} TO ${role}`]),
  ];
}

export const migration163: Migration = {
  version: 163,
  name: "an account's usage and its limit are kept per credential, and its agent pauses while any credential does",
  statements: [
    `DROP FUNCTION ${usageOld}`,
    `DROP FUNCTION ${limitOld}`,
    ...credentialKeyed(
      "agent_account_usage",
      "principal,agent,credential,usage_window",
    ),
    ...credentialKeyed("agent_account_limit", "principal,agent,credential"),
    `GRANT DELETE ON TABLE public.agent_account_usage TO ${boundaryOwnerRole}`,
    `GRANT DELETE ON TABLE public.agent_account_limit TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${kept} RETURNS text
       LANGUAGE plpgsql VOLATILE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE named text := COALESCE(in_credential,
           CASE in_agent WHEN 'Claude' THEN 'claude' WHEN 'Codex' THEN 'codex' END);
         BEGIN
           PERFORM pg_advisory_xact_lock(hashtextextended(
             'agent-account-credential:' || in_principal || '/' || in_agent, 0));
           WITH held AS (
             SELECT k.credential, max(k.observed_at) AS observed_at
               FROM (SELECT u.credential, u.observed_at FROM agent_account_usage u
                      WHERE u.principal=in_principal AND u.agent=in_agent
                     UNION ALL
                     SELECT l.credential, l.observed_at FROM agent_account_limit l
                      WHERE l.principal=in_principal AND l.agent=in_agent) k
              GROUP BY k.credential),
           evicted AS (
             SELECT h.credential FROM held h
              WHERE NOT EXISTS(SELECT 1 FROM held n WHERE n.credential=named)
              ORDER BY h.observed_at, h.credential
              LIMIT greatest((SELECT count(*) FROM held)
                             - ${String(agentAccountCredentialsKeptMaxAt163 - 1)}, 0)),
           readings AS (
             DELETE FROM agent_account_usage u USING evicted e
              WHERE u.principal=in_principal AND u.agent=in_agent
                AND u.credential=e.credential)
           DELETE FROM agent_account_limit l USING evicted e
            WHERE l.principal=in_principal AND l.agent=in_agent
              AND l.credential=e.credential;
           RETURN named;
         END $$`,
    ...owned(kept),
    `CREATE FUNCTION ${usageCreated} RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE bound record; spent record; named text;
         BEGIN
           SELECT * INTO bound FROM worker_run_binding(in_secret_digest,in_generation);
           IF NOT FOUND THEN RETURN; END IF;
           SELECT * INTO spent
             FROM ${agentAccountFunction}(bound.tenant,bound.project,bound.execution,bound.attempt);
           IF spent.principal IS NULL OR spent.agent IS NULL THEN RETURN; END IF;
           IF in_usage IS NULL OR in_usage='{}'::jsonb THEN RETURN; END IF;
           named := ${agentAccountCredentialKeptFunction}(spent.principal,spent.agent,in_credential);
           INSERT INTO agent_account_usage AS kept
               (principal,agent,credential,usage_window,utilization,resets_at,observed_at,
                tenant,project,execution,attempt)
             SELECT spent.principal,spent.agent,named,offered.key,
                    (offered.value->>'utilization')::double precision,
                    to_timestamp((offered.value->>'resetsAt')::double precision),
                    least(to_timestamp((offered.value->>'observedAt')::double precision),now()),
                    bound.tenant,bound.project,bound.execution,bound.attempt
               FROM jsonb_each(in_usage) offered
           ON CONFLICT (principal,agent,credential,usage_window) DO UPDATE
             SET utilization=EXCLUDED.utilization,resets_at=EXCLUDED.resets_at,
                 observed_at=EXCLUDED.observed_at,tenant=EXCLUDED.tenant,
                 project=EXCLUDED.project,execution=EXCLUDED.execution,
                 attempt=EXCLUDED.attempt
             WHERE kept.observed_at < EXCLUDED.observed_at;
         END $$`,
    ...owned(usage, workerPlaneRole),
    `CREATE FUNCTION ${limitCreated} RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE ended record; spent record; named text;
         BEGIN
           SELECT a.tenant,a.project,a.execution,a.attempt,a.runner_benches_credential
             INTO ended
             FROM execution_attempt a
            WHERE a.capability_secret_digest=in_secret_digest
              AND a.generation=in_generation AND a.state='Withdrawn'
              AND a.evidence='RunRateLimited' AND a.ended_at=now();
           IF NOT FOUND THEN RETURN; END IF;
           IF in_window IS NOT NULL OR in_resets_at IS NOT NULL THEN
             INSERT INTO execution_attempt_limit
                 (tenant,project,execution,attempt,usage_window,resets_at)
               VALUES(ended.tenant,ended.project,ended.execution,ended.attempt,
                      in_window,to_timestamp(in_resets_at));
           END IF;
           IF ended.runner_benches_credential THEN RETURN; END IF;
           SELECT * INTO spent
             FROM ${agentAccountFunction}(ended.tenant,ended.project,ended.execution,ended.attempt);
           IF spent.principal IS NULL OR spent.agent IS NULL THEN RETURN; END IF;
           named := ${agentAccountCredentialKeptFunction}(spent.principal,spent.agent,in_credential);
           INSERT INTO agent_account_limit AS kept
               (principal,agent,credential,usage_window,resets_at,observed_at,
                tenant,project,execution,attempt)
             VALUES(spent.principal,spent.agent,named,in_window,to_timestamp(in_resets_at),now(),
                    ended.tenant,ended.project,ended.execution,ended.attempt)
           ON CONFLICT (principal,agent,credential) DO UPDATE
             SET usage_window=EXCLUDED.usage_window,resets_at=EXCLUDED.resets_at,
                 observed_at=EXCLUDED.observed_at,tenant=EXCLUDED.tenant,
                 project=EXCLUDED.project,execution=EXCLUDED.execution,
                 attempt=EXCLUDED.attempt
             WHERE kept.observed_at <= EXCLUDED.observed_at;
         END $$`,
    ...owned(limit, workerPlaneRole),
    `CREATE FUNCTION ${credentialPause}
       RETURNS TABLE(credential text, paused_until timestamp with time zone, reasons text[])
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         WITH holding AS (
           SELECT u.credential, u.usage_window AS reason, u.resets_at AS until
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
                                AND u.observed_at>l.observed_at))
         SELECT h.credential, max(h.until), array_agg(h.reason ORDER BY h.reason)
           FROM holding h
          GROUP BY h.credential
          ORDER BY h.credential
       $$`,
    ...owned(credentialPause),
    `CREATE OR REPLACE FUNCTION ${pause}
       RETURNS TABLE(paused_until timestamp with time zone, reasons text[], admitted_by_press boolean)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         WITH held AS (
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
         SELECT (SELECT max(h.paused_until) FROM held h),
                (SELECT COALESCE(array_agg(r.reason ORDER BY r.reason),'{}'::text[])
                   FROM holding r),
                COALESCE((SELECT bool_and(r.reason='limit') FROM holding r),false)
                  AND EXISTS(SELECT 1 FROM agent_account_press p
                              CROSS JOIN limited m
                              WHERE p.principal=in_principal AND p.agent=in_agent
                                AND p.spent_at IS NULL
                                AND p.pressed_at>m.observed_at)
       $$`,
    `CREATE OR REPLACE FUNCTION ${standing}
       RETURNS TABLE(agent text, five_hour_percent smallint, seven_day_percent smallint,
         pauses_threads boolean,
         five_hour_utilization double precision, five_hour_resets_at timestamp with time zone,
         five_hour_observed_at timestamp with time zone,
         seven_day_utilization double precision, seven_day_resets_at timestamp with time zone,
         seven_day_observed_at timestamp with time zone,
         limit_window text, limit_resets_at timestamp with time zone,
         limit_observed_at timestamp with time zone,
         paused_until timestamp with time zone, reasons text[], admitted_by_press boolean)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT k.agent, t.five_hour_percent, t.seven_day_percent, t.pauses_threads,
              f.utilization, f.resets_at, f.observed_at,
              w.utilization, w.resets_at, w.observed_at,
              l.usage_window, l.resets_at, l.observed_at,
              h.paused_until, h.reasons, h.admitted_by_press
         FROM (VALUES (1, 'Claude'), (2, 'Codex')) k(position, agent)
        CROSS JOIN LATERAL ${agentAccountSettingsFunction}(in_principal, k.agent) t
        CROSS JOIN LATERAL ${agentAccountPauseFunction}(in_principal, k.agent) h
         LEFT JOIN LATERAL (
           SELECT u.utilization, u.resets_at, u.observed_at FROM agent_account_usage u
            WHERE u.principal = in_principal AND u.agent = k.agent
              AND u.usage_window = 'five_hour'
            ORDER BY u.observed_at DESC, u.credential
            LIMIT 1) f ON true
         LEFT JOIN LATERAL (
           SELECT u.utilization, u.resets_at, u.observed_at FROM agent_account_usage u
            WHERE u.principal = in_principal AND u.agent = k.agent
              AND u.usage_window = 'seven_day'
            ORDER BY u.observed_at DESC, u.credential
            LIMIT 1) w ON true
         LEFT JOIN LATERAL (
           SELECT n.usage_window, n.resets_at, n.observed_at FROM agent_account_limit n
            WHERE n.principal = in_principal AND n.agent = k.agent
            ORDER BY n.observed_at DESC, n.credential
            LIMIT 1) l ON true
        ORDER BY k.position
     $$`,
  ],
};
