/**
 * A thread is woken for its own tickets only where it, or its member's chat
 * host, opts in.
 *
 * `agent_session.ticket_wakes` IS A THREAD'S OWN CHOICE: `On`, `Off`, or NULL
 * to follow its host. Only `choose_session_ticket_wakes` writes it, under the
 * bearer of the thread's own live attempt, so a lead, an inquiry, or an attempt
 * since fenced cannot. A session that is no thread holds none, which its check
 * says.
 *
 * `chat_host.ticket_wakes` IS WRITTEN BY EVERY POLL of a chat host, as 180's
 * `session_capabilities` is: the setting the poll named, or NULL where it named
 * none, so a poll naming none clears what an earlier one named.
 *
 * EACH READ ANSWERS BOTH AND DERIVES NOTHING. `thread_ticket_wakes` is the
 * scheduler's, beside each wake candidate; `read_session_ticket_wakes` and the
 * door are the worker plane's, keyed by the bearer as 176's standing report is.
 * The host is the member's own, the chat host whose owner is the thread's
 * principal in its tenant. What follows from the two is the caller's to derive.
 */

import {
  boundaryOwnerRole,
  poolPlaneRole,
  schedulerRole,
  sessionTicketWakesChooseFunction,
  sessionTicketWakesReadFunction,
  threadTicketWakesFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** What a column holding a ticket wake setting may hold, NULL besides. */
const settingKnown = `IN ('On','Off')`;

const threadRead = `public.${threadTicketWakesFunction}(in_tenant text, in_project text, in_session text)`;

const sessionRead = `public.${sessionTicketWakesReadFunction}(in_secret_digest text, in_generation bigint)`;

const choose = `public.${sessionTicketWakesChooseFunction}(in_secret_digest text, in_generation bigint, in_thread text)`;

/** The definer boilerplate every function this creates ends with, granted to `role` as that role's other doors are. */
function owned(
  signature: string,
  role: string,
  privilege: "ALL" | "EXECUTE" = "EXECUTE",
): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ${privilege} ON FUNCTION ${signature} TO ${role}`,
  ];
}

/** The thread's choice and its member's host's setting, for the thread `tenant`, `project`, `session` name. */
function settingsOf(tenant: string, project: string, session: string): string {
  return `SELECT s.ticket_wakes AS thread,h.ticket_wakes AS host
         FROM agent_session s
         LEFT JOIN chat_host h ON h.tenant=s.tenant AND h.owner=s.principal
        WHERE s.tenant=${tenant} AND s.project=${project}
          AND s.session=${session} AND s.kind='Thread'`;
}

export const migration199: Migration = {
  version: 199,
  name: "a thread is woken for its tickets only where it or its chat host opts in",
  statements: [
    `ALTER TABLE public.agent_session
       ADD COLUMN ticket_wakes text
         CONSTRAINT agent_session_ticket_wakes_is_known
         CHECK (ticket_wakes ${settingKnown}),
       ADD CONSTRAINT agent_session_ticket_wakes_is_a_threads
         CHECK (ticket_wakes IS NULL OR kind='Thread')`,
    `GRANT UPDATE(ticket_wakes) ON TABLE public.agent_session TO ${boundaryOwnerRole}`,
    `ALTER TABLE public.chat_host
       ADD COLUMN ticket_wakes text
         CONSTRAINT chat_host_ticket_wakes_is_known
         CHECK (ticket_wakes ${settingKnown})`,
    `GRANT SELECT(ticket_wakes),UPDATE(ticket_wakes)
       ON TABLE public.chat_host TO ${poolPlaneRole}`,
    `GRANT SELECT(ticket_wakes) ON TABLE public.chat_host TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${threadRead} RETURNS TABLE(thread text, host text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       ${settingsOf("in_tenant", "in_project", "in_session")}
     $$`,
    ...owned(threadRead, schedulerRole),
    `CREATE FUNCTION ${sessionRead} RETURNS TABLE(thread text, host text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND OR bound.kind<>'Thread' THEN RETURN; END IF;
       RETURN QUERY ${settingsOf("bound.tenant", "bound.project", "bound.session")};
     END $$`,
    ...owned(sessionRead, workerPlaneRole, "ALL"),
    `CREATE FUNCTION ${choose} RETURNS TABLE(verdict text, thread text, host text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; held text;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'Fenced'::text,NULL::text,NULL::text; RETURN;
       END IF;
       IF bound.kind<>'Thread' THEN
         RETURN QUERY SELECT 'NotThread'::text,NULL::text,NULL::text; RETURN;
       END IF;
       SELECT s.state INTO held FROM agent_session s
        WHERE s.tenant=bound.tenant AND s.project=bound.project
          AND s.session=bound.session
          FOR UPDATE;
       IF held<>'Open' THEN
         RETURN QUERY SELECT 'Fenced'::text,NULL::text,NULL::text; RETURN;
       END IF;
       UPDATE agent_session s SET ticket_wakes=in_thread
        WHERE s.tenant=bound.tenant AND s.project=bound.project
          AND s.session=bound.session
          AND s.ticket_wakes IS DISTINCT FROM in_thread;
       RETURN QUERY SELECT 'Recorded'::text,settings.*
         FROM (${settingsOf("bound.tenant", "bound.project", "bound.session")}) settings;
     END $$`,
    ...owned(choose, workerPlaneRole, "ALL"),
  ],
};
