/**
 * A member takes a released ticket, which makes them its owner: the member
 * whose personal runner and own agent account its executions are placed for.
 *
 * `ticket_take` IS THE HISTORY, AND THE CURRENT TAKER IS ITS NEWEST ROW. Each
 * take and return appends one row naming who acted and when; no row changes,
 * so the taker is derived and stored nowhere else. A newest `Take` names the
 * taker, and a newest `Return`, or no row, leaves the ticket to its creator.
 *
 * `take_ticket` IS THE ONE DOOR, shaped as `save_epic` is. It takes the project
 * row's lock, which serializes every take and return of a project, so a row's
 * number is `max(number) + 1` with no gap and a return finds the taker it is
 * refused against. It refuses a ticket the projection does not hold, naming a
 * draft never released apart from a ticket the project lacks, and a Done or
 * Revoked ticket. A take always names its caller: no argument names another
 * member, so work moves onto a member's runner only by that member's own act.
 * Taking a ticket the caller already owns writes nothing.
 *
 * `ticket_owner` IS WHO THE NEXT EXECUTION IS PLACED FOR: the taker, else the
 * member whose authority wrote the first draft revision. The scheduler pins it
 * on each execution it registers, so a take moves no execution already
 * registered. Both reads are the invoker's, so the scheduler and the API each
 * read the history under a grant of their own.
 */

import {
  apiRole,
  boundaryOwnerRole,
  schedulerRole,
  ticketOwnerFunction,
  ticketTakeFunction,
  ticketTakerFunction,
  type Migration,
} from "../shared.ts";

const takerSignature = `public.${ticketTakerFunction}(in_tenant text, in_project text, in_ticket bigint)`;
const ownerSignature = `public.${ticketOwnerFunction}(in_tenant text, in_project text, in_ticket bigint)`;
const doorSignature = `public.${ticketTakeFunction}(in_tenant text, in_project text, in_ticket bigint, in_kind text, in_actor_kind text, in_actor_subject text)`;

export const migration184: Migration = {
  version: 184,
  name: "a member takes a released ticket and returns it, through one door, under a history no one changes",
  statements: [
    `CREATE TABLE public.ticket_take (
       tenant text NOT NULL,
       project text NOT NULL,
       ticket bigint NOT NULL
         CONSTRAINT ticket_take_ticket_is_positive CHECK (ticket >= 1),
       number bigint NOT NULL
         CONSTRAINT ticket_take_number_is_positive CHECK (number >= 1),
       kind text NOT NULL
         CONSTRAINT ticket_take_kind_is_known CHECK (kind IN ('Take','Return')),
       taken_at timestamp with time zone NOT NULL DEFAULT now(),
       actor_kind text NOT NULL
         CONSTRAINT ticket_take_actor_kind_is_bounded
         CHECK (length(actor_kind) BETWEEN 1 AND 256),
       actor_subject text NOT NULL
         CONSTRAINT ticket_take_actor_subject_is_bounded
         CHECK (length(actor_subject) BETWEEN 1 AND 256),
       PRIMARY KEY (tenant,project,ticket,number),
       CONSTRAINT ticket_take_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
    `CREATE TRIGGER ticket_take_is_immutable BEFORE DELETE OR UPDATE ON public.ticket_take
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `GRANT SELECT,INSERT ON TABLE public.ticket_take TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.ticket_take TO ${apiRole}`,
    `GRANT SELECT ON TABLE public.ticket_take TO ${schedulerRole}`,
    `CREATE FUNCTION ${takerSignature} RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
      SELECT CASE WHEN k.kind = 'Take' THEN k.actor_subject END
        FROM ticket_take k
       WHERE k.tenant=in_tenant AND k.project=in_project AND k.ticket=in_ticket
       ORDER BY k.number DESC LIMIT 1
    $$`,
    `CREATE FUNCTION ${ownerSignature} RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
      SELECT coalesce(${ticketTakerFunction}(in_tenant,in_project,in_ticket),
               (SELECT r.authority_subject FROM draft_revision r
                 WHERE r.tenant=in_tenant AND r.project=in_project AND r.ticket=in_ticket
                   AND r.authoring_version=1 AND r.authority_kind='Member'))
    $$`,
    `CREATE FUNCTION ${doorSignature}
    RETURNS TABLE(result_outcome text, result_owner text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       DECLARE found_phase text;
               taker text;
               current_owner text;
       BEGIN
         IF in_kind IS NULL OR in_kind NOT IN ('Take','Return') THEN
           RAISE EXCEPTION 'take_ticket: unknown kind %', in_kind
             USING ERRCODE = 'invalid_parameter_value';
         END IF;
         PERFORM 1 FROM project p WHERE p.tenant=in_tenant AND p.project=in_project FOR UPDATE;
         IF NOT FOUND THEN
           RAISE EXCEPTION 'take_ticket: no project %/%', in_tenant, in_project
             USING ERRCODE = 'foreign_key_violation';
         END IF;
         SELECT t.phase INTO found_phase FROM ticket_projection t
          WHERE t.tenant=in_tenant AND t.project=in_project AND t.ticket=in_ticket;
         IF NOT FOUND THEN
           IF EXISTS (SELECT 1 FROM draft d
                       WHERE d.tenant=in_tenant AND d.project=in_project
                         AND d.ticket=in_ticket AND d.state='Draft') THEN
             RETURN QUERY SELECT 'Unreleased', NULL::text;
           ELSE
             RETURN QUERY SELECT 'MissingTicket', NULL::text;
           END IF;
           RETURN;
         END IF;
         IF found_phase = 'Done' THEN
           RETURN QUERY SELECT 'TicketDone', NULL::text;
           RETURN;
         END IF;
         IF found_phase = 'Revoked' THEN
           RETURN QUERY SELECT 'TicketRevoked', NULL::text;
           RETURN;
         END IF;
         taker := ${ticketTakerFunction}(in_tenant,in_project,in_ticket);
         current_owner := ${ticketOwnerFunction}(in_tenant,in_project,in_ticket);
         IF in_kind = 'Take' AND current_owner IS NOT DISTINCT FROM in_actor_subject THEN
           RETURN QUERY SELECT 'AlreadyOwner', current_owner;
           RETURN;
         END IF;
         IF in_kind = 'Return' AND taker IS DISTINCT FROM in_actor_subject THEN
           RETURN QUERY SELECT 'NotTaker', NULL::text;
           RETURN;
         END IF;
         INSERT INTO ticket_take(tenant,project,ticket,number,kind,actor_kind,actor_subject)
           VALUES(in_tenant,in_project,in_ticket,
                  coalesce((SELECT max(k.number) FROM ticket_take k
                             WHERE k.tenant=in_tenant AND k.project=in_project
                               AND k.ticket=in_ticket), 0) + 1,
                  in_kind,in_actor_kind,in_actor_subject);
         RETURN QUERY SELECT CASE in_kind WHEN 'Take' THEN 'Taken' ELSE 'Returned' END,
                             ${ticketOwnerFunction}(in_tenant,in_project,in_ticket);
       END $$`,
    ...[takerSignature, ownerSignature, doorSignature].flatMap((signature) => [
      `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
      `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ]),
    `GRANT EXECUTE ON FUNCTION ${doorSignature} TO ${apiRole}`,
    ...[takerSignature, ownerSignature].flatMap((signature) => [
      `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
      `GRANT EXECUTE ON FUNCTION ${signature} TO ${schedulerRole}`,
    ]),
  ],
};
