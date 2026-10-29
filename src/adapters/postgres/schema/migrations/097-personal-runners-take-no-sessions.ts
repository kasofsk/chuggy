/**
 * A member's sessions are their chat host's alone: a personal runner claims
 * none, and stands for none of them.
 *
 * A PERSONAL RUNNER IS OFFERED NO SESSION AND OPENS NONE. Its awaiting read
 * answers nothing and its open answers `NotClaimable`, whatever its owner's
 * chat host is doing, and both keep their signatures, so a pool plane still
 * running an image that asks them is answered as the current one is. A
 * personal runner's poll goes on claiming its owner's executions as before.
 *
 * WHAT ONE ALREADY HOLDS RUNS TO ITS END. Its holding, renewal, settlement and
 * fence are left as they are, so an attempt it opened before this takes its
 * session's turns until it ends by its runner's report, its idleness, its
 * lease or its runner's removal, as any attempt does, and the session's next
 * attempt is its owner's chat host's.
 *
 * A MEMBER'S STANDING IS THEIR CHAT HOST'S. `session_runner_standing` reads
 * their thread's standing from their chat host alone, as it already read their
 * inquiry's, so a member with a personal runner and no chat host is
 * `Unregistered` for both and a turn of either is refused `NoRunner`.
 *
 * The bodies are written out rather than built from the helpers earlier
 * migrations use, so this file goes on saying what it installed when those
 * change.
 */

import {
  personalSessionOpenFunction,
  personalSessionsAwaitingFunction,
  sessionRunnerStandingFunction,
  type Migration,
} from "../shared.ts";

const personalAwaiting = `public.${personalSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint, in_polled_secs_max bigint)`;

const personalOpened = `public.${personalSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_polled_secs_max bigint)`;

const standing = `public.${sessionRunnerStandingFunction}(in_tenant text, in_project text, in_member text, in_polled_secs_max bigint)`;

export const migration097: Migration = {
  version: 97,
  name: "a member's sessions are their chat host's alone",
  statements: [
    `CREATE OR REPLACE FUNCTION ${personalAwaiting}
       RETURNS TABLE(project text, session text, kind text, capabilities text[], agent_reference text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT NULL::text,NULL::text,NULL::text,NULL::text[],NULL::text
        WHERE false
     $$`,
    `CREATE OR REPLACE FUNCTION ${personalOpened} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       RETURN 'NotClaimable';
     END $$`,
    `CREATE OR REPLACE FUNCTION ${standing}
       RETURNS TABLE(member_standing text, inquiry_standing text, project_standing text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       WITH host AS (
         SELECT coalesce(h.last_polled_at > now() - make_interval(
                  secs => in_polled_secs_max::double precision), false) AS live
           FROM chat_host h
          WHERE h.tenant=in_tenant AND h.owner=in_member),
       pools AS (
         SELECT coalesce(w.last_polled_at > now() - make_interval(
                  secs => in_polled_secs_max::double precision), false) AS live
           FROM worker_pool w
          WHERE w.tenant=in_tenant AND w.project=in_project)
       SELECT (SELECT CASE WHEN bool_or(live) THEN 'Live'
                           WHEN count(*)>0 THEN 'Offline'
                           ELSE 'Unregistered' END FROM host),
              (SELECT CASE WHEN bool_or(live) THEN 'Live'
                           WHEN count(*)>0 THEN 'Offline'
                           ELSE 'Unregistered' END FROM host),
              (SELECT CASE WHEN bool_or(live) THEN 'Live'
                           WHEN count(*)>0 THEN 'Offline'
                           ELSE 'Unregistered' END FROM pools)
     $$`,
  ],
};
