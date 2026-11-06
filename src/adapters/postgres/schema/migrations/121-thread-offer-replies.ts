/**
 * A member's reply to an offer their thread made them is a door of its own.
 *
 * `enqueue_thread_offer_reply` IS CREATED, refusing what `enqueue_thread_message`
 * refuses, in the order 086 wrote it, and enqueuing an `OfferReply` turn where
 * that door enqueues a `UserMessage`. The kind is the door's rather than an
 * argument, so the API role can put no other kind in a member's mailbox.
 */

import {
  apiRole,
  boundaryOwnerRole,
  threadOfferReplyEnqueueFunction,
  type Migration,
} from "../shared.ts";

const offerReplyEnqueue = `public.${threadOfferReplyEnqueueFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_input text, in_route text)`;

export const migration121: Migration = {
  version: 121,
  name: "a member replies to an offer",
  statements: [
    `CREATE FUNCTION ${offerReplyEnqueue} RETURNS TABLE(enqueued text, ordinal bigint, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; standing bigint; queued bigint; answered record;
     BEGIN
       SELECT s.session,s.principal,s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Thread'
        FOR UPDATE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoThread'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       IF held.principal<>in_principal THEN
         RETURN QUERY SELECT 'NotYourThread'::text,NULL::bigint,held.session;
         RETURN;
       END IF;
       IF held.state<>'Open' THEN
         RETURN QUERY SELECT 'Closed'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT t.ordinal INTO standing FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyEnqueued'::text,standing,held.session; RETURN;
       END IF;
       SELECT count(*) INTO queued FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.state='Queued';
       IF queued>=8 THEN
         RETURN QUERY SELECT 'Backlogged'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT * INTO answered FROM enqueue_session_turn(
         in_tenant,in_project,held.session,in_turn,'OfferReply',in_input,in_route);
       RETURN QUERY SELECT answered.enqueued,answered.ordinal,held.session;
     END $$`,
    `ALTER FUNCTION ${offerReplyEnqueue} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${offerReplyEnqueue} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${offerReplyEnqueue} TO ${apiRole}`,
  ],
};
