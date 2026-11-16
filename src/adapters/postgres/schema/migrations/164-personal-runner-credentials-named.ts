/**
 * A personal runner keeps the credentials its newest poll named, and its claim
 * of an agent it names credentials for waits only while every one of them is
 * paused.
 *
 * `personal_runner.credentials_named` IS WRITTEN BY EVERY POLL of a personal
 * runner: an object keyed by agent, each holding the names the poll gave that
 * agent, or NULL where it named none, so a poll naming none clears what an
 * earlier one named.
 *
 * `agent_account_named_pause` ANSWERS `agent_account_pause`'S COLUMNS for a
 * principal, an agent and the names a runner gave it. It is paused only while
 * every name given has a row of `agent_account_credential_pause`, until the
 * earliest of those ends, with each reason once; a name with no row, one that
 * never reported among them, is free. Unless paused it answers as an unpaused
 * account does. While paused, a press admits one claim where every reason
 * holding is a limit and it was made after the newest of those limits arrived,
 * as `agent_account_pause` reads it. The pool plane's claims and the API's
 * waiting counts call it.
 *
 * `agent_account_named_credential_pauses` IS THE POOL PLANE'S DOOR to each of
 * the names given that is paused, and until when, which a poll's answer names.
 */

import {
  agentAccountCredentialPauseFunction,
  agentAccountNamedCredentialPausesFunction,
  agentAccountNamedPauseFunction,
  apiRole,
  boundaryOwnerRole,
  poolPlaneRole,
  type Migration,
} from "../shared.ts";

const named = `public.${agentAccountNamedPauseFunction}(in_principal text, in_agent text, in_credentials text[])`;

const pauses = `public.${agentAccountNamedCredentialPausesFunction}(in_principal text, in_agent text, in_credentials text[])`;

/** The owner a function is installed under, callable by `roles` alone. */
function owned(signature: string, roles: readonly string[]): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...roles.map((role) => `GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`),
  ];
}

export const migration164: Migration = {
  version: 164,
  name: "a personal runner keeps the credentials its poll named, and its claim waits only while every one is paused",
  statements: [
    `ALTER TABLE public.personal_runner
       ADD COLUMN credentials_named jsonb
         CONSTRAINT personal_runner_credentials_named_is_an_object
         CHECK (jsonb_typeof(credentials_named)='object')`,
    `GRANT SELECT(credentials_named),UPDATE(credentials_named)
       ON TABLE public.personal_runner TO ${poolPlaneRole}`,
    `CREATE FUNCTION ${named}
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
         SELECT (SELECT min(h.paused_until) FROM paused h),
                (SELECT COALESCE(array_agg(r.reason ORDER BY r.reason),'{}'::text[])
                   FROM holding r),
                COALESCE((SELECT bool_and(r.reason='limit') FROM holding r),false)
                  AND EXISTS(SELECT 1 FROM agent_account_press p
                              CROSS JOIN limited m
                              WHERE p.principal=in_principal AND p.agent=in_agent
                                AND p.spent_at IS NULL
                                AND p.pressed_at>m.observed_at)
       $$`,
    ...owned(named, [poolPlaneRole, apiRole]),
    `CREATE FUNCTION ${pauses}
       RETURNS TABLE(credential text, paused_until timestamp with time zone)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT c.credential, c.paused_until
           FROM ${agentAccountCredentialPauseFunction}(in_principal,in_agent) c
          WHERE c.credential=ANY(in_credentials)
          ORDER BY c.credential
       $$`,
    ...owned(pauses, [poolPlaneRole]),
  ],
};
