/**
 * A thread dispatches a ticket on its member's word, under a capability of its
 * own.
 *
 * `agent_session_capabilities_are_known` IS REPLACED, admitting
 * `TicketDispatch` beside every capability the baseline admitted, so no stored
 * row is refused by the new constraint.
 *
 * `open_member_thread` IS REPLACED, writing `TicketDispatch` into the roster of
 * a thread it opens. A thread already open keeps the roster and the objectives
 * it was opened with, which say nothing of dispatching.
 *
 * The body is written out rather than built from a helper, so this file goes
 * on saying what it installed when the baseline changes.
 */

import { threadOpenFunction, type Migration } from "../shared.ts";

/** The capabilities the baseline admitted, and the one this adds, in the order the runtime names them. */
const sessionCapabilities = [
  "RepositoryRead",
  "RepositoryWrite",
  "RunCommands",
  "ProjectRead",
  "DraftAuthor",
  "DraftOriginate",
  "TicketDispatch",
  "LeadDecision",
];

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration084: Migration = {
  version: 84,
  name: "a thread may dispatch a ticket",
  statements: [
    `ALTER TABLE public.agent_session
       DROP CONSTRAINT agent_session_capabilities_are_known,
       ADD CONSTRAINT agent_session_capabilities_are_known CHECK ((((cardinality(capabilities) >= 0) AND (cardinality(capabilities) <= 16)) AND (capabilities <@ ${textArray(sessionCapabilities)})))`,
    `CREATE OR REPLACE FUNCTION public.${threadOpenFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_credential_slot text, in_system_prompt text) RETURNS TABLE(opened text, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text; drawn record;
     BEGIN
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Thread' AND s.principal=in_principal AND s.state='Open'
        FOR UPDATE;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       BEGIN
         INSERT INTO agent_session
           (tenant,project,session,kind,principal,capabilities,credential_slot,
            account,cluster,system_prompt,opened_after_sequence)
         VALUES(in_tenant,in_project,in_session,'Thread',in_principal,
                ARRAY['RepositoryRead', 'RunCommands', 'ProjectRead', 'DraftAuthor', 'DraftOriginate', 'TicketDispatch']::text[],in_credential_slot,
                drawn.account,drawn.cluster,in_system_prompt,
                coalesce((SELECT max(head.sequence) FROM project_change head),0));
       EXCEPTION WHEN unique_violation THEN
         SELECT s.session INTO held FROM agent_session s
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.kind='Thread' AND s.principal=in_principal AND s.state='Open';
         IF NOT FOUND THEN RAISE; END IF;
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END;
       RETURN QUERY SELECT 'Opened'::text,in_session;
     END $$`,
  ],
};
