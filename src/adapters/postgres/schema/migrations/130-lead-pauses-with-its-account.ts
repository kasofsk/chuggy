/**
 * A project's lead always pauses with the Claude account of the runner owner
 * who would run it, and the selector offers it no turn while every live runner
 * of the project is so paused.
 *
 * THE LEAD OPTION IS RETIRED. `agent_account_setting` loses `pauses_lead`,
 * every row carried forward with its thresholds and its threads option, and
 * `agent_account_session_paused` answers a `Lead` as always pausing. The
 * settings read, the standing read and the settings write answer or take the
 * option, and a function's answer or arguments cannot change in place, so
 * each is dropped and recreated without it, otherwise what 110 and 112 made it
 * and granted to the roles it held.
 *
 * `lead_runner_standing` IS WHETHER A LIVE RUNNER OF THE PROJECT COULD TAKE
 * ITS LEAD NOW, for the selector's admission: `Live` where one's registrant is
 * not paused for a `Lead`, by the rule the pool plane's claim asks, `Paused`
 * where every live one's is, and `Offline` where none is live. A paused answer
 * names the earliest instant one of those registrants stops being paused, by
 * `agent_account_pause` at the database's own `now()`, so a raised threshold
 * or a new reading moves it at the next read.
 *
 * `UsagePaused` IS A REFUSAL THE SELECTOR KEEPS, beside 055's codes, and
 * `read_lead_refusal` answers it with that end, read at the read rather than
 * stored. It takes the poll bound a runner counts as live within, so it is
 * dropped and recreated, still the API's alone.
 */

import {
  agentAccountSessionPausedFunction,
  agentAccountSettingWriteFunction,
  agentAccountSettingsFunction,
  agentAccountStandingFunction,
  agentAccountPauseFunction,
  apiRole,
  boundaryOwnerRole,
  leadRefusalReadFunction,
  leadRunnerStandingFunction,
  selectorServiceRole,
  type Migration,
} from "../shared.ts";

const settings = `public.${agentAccountSettingsFunction}(in_principal text, in_agent text)`;

const sessionPaused = `public.${agentAccountSessionPausedFunction}(in_principal text, in_kind text)`;

const standing = `public.${agentAccountStandingFunction}(in_principal text)`;

const settingWriteOld = `public.${agentAccountSettingWriteFunction}(in_principal text, in_agent text, in_five_hour_percent smallint, in_seven_day_percent smallint, in_pauses_threads boolean, in_pauses_lead boolean)`;
const settingWrite = `public.${agentAccountSettingWriteFunction}(in_principal text, in_agent text, in_five_hour_percent smallint, in_seven_day_percent smallint, in_pauses_threads boolean)`;

const leadRunners = `public.${leadRunnerStandingFunction}(in_tenant text, in_project text, in_polled_secs_max bigint)`;

const refusalReadOld = `public.${leadRefusalReadFunction}(in_tenant text, in_project text)`;
const refusalRead = `public.${leadRefusalReadFunction}(in_tenant text, in_project text, in_polled_secs_max bigint)`;

/** The owner a function is installed under, callable by `role` or by nobody but its owner. */
function owned(signature: string, role?: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...(role === undefined
      ? []
      : [`GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`]),
  ];
}

export const migration130: Migration = {
  version: 130,
  name: "a project's lead pauses with its runner owner's account, and is refused a turn while it does",
  statements: [
    `DROP FUNCTION ${standing}`,
    `DROP FUNCTION ${settingWriteOld}`,
    `DROP FUNCTION ${settings}`,
    `ALTER TABLE public.agent_account_setting DROP COLUMN pauses_lead`,
    `CREATE FUNCTION ${settings}
       RETURNS TABLE(five_hour_percent smallint, seven_day_percent smallint, pauses_threads boolean)
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT COALESCE(s.five_hour_percent,80::smallint),
                COALESCE(s.seven_day_percent,90::smallint),
                COALESCE(s.pauses_threads,false)
           FROM (SELECT 1) one
           LEFT JOIN agent_account_setting s
             ON s.principal=in_principal AND s.agent=in_agent
       $$`,
    ...owned(settings),
    `CREATE OR REPLACE FUNCTION ${sessionPaused} RETURNS boolean
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT CASE WHEN in_kind='Lead' THEN true
                     WHEN in_kind IN ('Thread','Inquiry') THEN t.pauses_threads
                     ELSE false END
                AND held.paused_until IS NOT NULL
           FROM ${agentAccountSettingsFunction}(in_principal,'Claude') t
          CROSS JOIN ${agentAccountPauseFunction}(in_principal,'Claude') held
       $$`,
    `CREATE FUNCTION ${standing}
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
         LEFT JOIN agent_account_usage f
           ON f.principal = in_principal AND f.agent = k.agent
          AND f.usage_window = 'five_hour'
         LEFT JOIN agent_account_usage w
           ON w.principal = in_principal AND w.agent = k.agent
          AND w.usage_window = 'seven_day'
         LEFT JOIN agent_account_limit l
           ON l.principal = in_principal AND l.agent = k.agent
        ORDER BY k.position
     $$`,
    ...owned(standing, apiRole),
    `CREATE FUNCTION ${settingWrite} RETURNS void
       LANGUAGE sql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       INSERT INTO agent_account_setting AS kept
           (principal, agent, five_hour_percent, seven_day_percent, pauses_threads)
         VALUES (in_principal, in_agent, in_five_hour_percent, in_seven_day_percent,
                 in_pauses_threads)
       ON CONFLICT (principal, agent) DO UPDATE
         SET five_hour_percent = EXCLUDED.five_hour_percent,
             seven_day_percent = EXCLUDED.seven_day_percent,
             pauses_threads = EXCLUDED.pauses_threads
     $$`,
    ...owned(settingWrite, apiRole),
    `CREATE FUNCTION ${leadRunners}
       RETURNS TABLE(standing text, paused_until timestamp with time zone)
       LANGUAGE sql STABLE SECURITY DEFINER ROWS 1
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH live AS (
         SELECT w.registered_by,
                ${agentAccountSessionPausedFunction}(w.registered_by,'Lead') AS paused
           FROM worker_pool w
          WHERE w.tenant=in_tenant AND w.project=in_project
            AND w.last_polled_at > now() - make_interval(
                  secs => in_polled_secs_max::double precision))
       SELECT CASE WHEN bool_or(NOT l.paused) THEN 'Live'
                   WHEN bool_or(l.paused) THEN 'Paused'
                   ELSE 'Offline' END,
              CASE WHEN NOT COALESCE(bool_or(NOT l.paused),false)
                   THEN min(h.paused_until) END
         FROM live l
         LEFT JOIN LATERAL ${agentAccountPauseFunction}(l.registered_by,'Claude') h
           ON l.paused
     $$`,
    ...owned(leadRunners, selectorServiceRole),
    `ALTER TABLE public.selector_lead_refusal
       DROP CONSTRAINT selector_lead_refusal_is_known,
       ADD CONSTRAINT selector_lead_refusal_is_known
         CHECK (refusal = ANY (ARRAY['HostedRunsNotGranted'::text, 'RunnerOffline'::text, 'UsagePaused'::text]))`,
    `DROP FUNCTION ${refusalReadOld}`,
    `CREATE FUNCTION ${refusalRead}
       RETURNS TABLE(refusal text, refused_since timestamp with time zone,
         paused_until timestamp with time zone)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT r.refusal,r.refused_since,s.paused_until
         FROM selector_lead_refusal r
         LEFT JOIN LATERAL ${leadRunnerStandingFunction}(r.tenant,r.project,in_polled_secs_max) s
           ON r.refusal='UsagePaused'
        WHERE r.tenant=in_tenant AND r.project=in_project
     $$`,
    ...owned(refusalRead, apiRole),
  ],
};
