/**
 * A thread is opened holding `ThreadOffer`, and a mailbox may hold an
 * `OfferReply` turn.
 *
 * `agent_session_capabilities_are_known` AND `session_turn_kind_is_known` ARE
 * REPLACED, each admitting its new member beside every one it admitted, so no
 * stored row is refused by the new constraint. A member's own session still
 * holds `MemberRead` alone, by `agent_session_member_read_is_member_scoped`,
 * which this leaves as it stood.
 *
 * `open_member_thread` IS REPLACED, writing `ThreadOffer` into the roster of a
 * thread it opens, its body otherwise as it stood. A thread already open keeps
 * the roster it was opened with, because a roster is moved by the provisioning
 * identity and by no migration.
 *
 * The lists and the body are written out rather than read from the rosters, so
 * this file goes on saying what it installed when those change.
 */

import { threadOpenFunction, type Migration } from "../shared.ts";

/** Every capability a session may hold, in the order the runtime names them. */
const sessionCapabilities = [
  "RepositoryRead",
  "RepositoryWrite",
  "RunCommands",
  "ProjectRead",
  "DraftAuthor",
  "DraftOriginate",
  "TicketDispatch",
  "LeadDecision",
  "MemberRead",
  "ThreadOffer",
];

/** Every kind of turn a mailbox may hold, in the order the runtime names them. */
const sessionTurnInputKinds = [
  "Observation",
  "UserMessage",
  "Wake",
  "Inquiry",
  "OfferReply",
];

/** The roster a thread is opened with. */
const threadCapabilities = [
  "RepositoryRead",
  "RunCommands",
  "ProjectRead",
  "DraftAuthor",
  "DraftOriginate",
  "TicketDispatch",
  "ThreadOffer",
];

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

const threadOpen = `public.${threadOpenFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_key text, in_credential_slot text, in_system_prompt text)`;

export const migration120: Migration = {
  version: 120,
  name: "a thread offers its member a page or an action",
  statements: [
    `ALTER TABLE public.agent_session
       DROP CONSTRAINT agent_session_capabilities_are_known,
       ADD CONSTRAINT agent_session_capabilities_are_known
         CHECK (cardinality(capabilities) BETWEEN 0 AND 16
                AND capabilities <@ ${textArray(sessionCapabilities)})`,
    `ALTER TABLE public.session_turn
       DROP CONSTRAINT session_turn_kind_is_known,
       ADD CONSTRAINT session_turn_kind_is_known
         CHECK (input_kind = ANY (${textArray(sessionTurnInputKinds)}))`,
    `CREATE OR REPLACE FUNCTION ${threadOpen} RETURNS TABLE(opened text, session text, threads_max bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text; allowed bigint; drawn record;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'member-thread-open:' || in_tenant || '/' || in_project || '/' || in_principal, 0));
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Thread' AND s.principal=in_principal AND s.open_key=in_key;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,held,NULL::bigint; RETURN;
       END IF;
       allowed := member_thread_limit(in_tenant,in_project,in_principal);
       IF (SELECT count(*) FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Thread'
              AND s.principal=in_principal AND s.state='Open')>=allowed THEN
         RETURN QUERY SELECT 'ThreadLimitReached'::text,NULL::text,allowed; RETURN;
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       INSERT INTO agent_session
         (tenant,project,session,kind,principal,capabilities,credential_slot,
          account,cluster,system_prompt,opened_after_sequence,open_key)
       VALUES(in_tenant,in_project,in_session,'Thread',in_principal,
              ${textArray(threadCapabilities)},in_credential_slot,
              drawn.account,drawn.cluster,in_system_prompt,
              coalesce((SELECT max(head.sequence) FROM project_change head),0),
              in_key);
       RETURN QUERY SELECT 'Opened'::text,in_session,NULL::bigint;
     END $$`,
  ],
};
