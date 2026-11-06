/**
 * The door an epic is created and revised through, and the API's read of the
 * relations 122 made.
 *
 * `save_epic` IS `decideEpic` IN SQL. It takes the project row's lock, which
 * serializes every save of a project, so the number a creation takes is
 * `max(number) + 1` with no gap and a revise finds the revision it is stale
 * against. It refuses in the domain's own order and under its own names, and
 * answers a ticket the project holds by `ticket_projection`. A save writes the
 * epic row, replaces the members and appends the revision's `epic_change` in
 * the one transaction.
 *
 * THE CANONICAL SIZE IS BUILT HERE AS THE DOMAIN BUILDS IT: keys in code-point
 * order, `to_json` of each text, which escapes what `JSON.stringify` does, so
 * the two count the same bytes.
 */

import {
  epicContentBytesMax,
  epicSummaryCharsMax,
  epicTitleCharsMax,
} from "../../../../domain/epics.ts";
import {
  apiRole,
  boundaryOwnerRole,
  epicSaveFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${epicSaveFunction}(in_tenant text, in_project text, in_kind text, in_epic bigint, in_expected bigint, in_title text, in_summary text, in_description text, in_visibility text, in_tickets bigint[], in_actor_kind text, in_actor_subject text)`;

const held = "e.tenant=in_tenant AND e.project=in_project";

export const migration123: Migration = {
  version: 123,
  name: "an epic is saved through one door, and the API reads the relations",
  statements: [
    `CREATE FUNCTION ${signature}
    RETURNS TABLE(result_outcome text, result_epic bigint, result_revision bigint,
                  result_current bigint, result_unknown bigint[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       DECLARE found_epic epic%ROWTYPE;
               members bigint[];
               kept_summary text;
               unknown bigint[];
               saved bigint;
               revised bigint;
       BEGIN
         IF in_kind NOT IN ('Create','Revise') THEN
           RAISE EXCEPTION 'save_epic: unknown kind %', in_kind
             USING ERRCODE = 'invalid_parameter_value';
         END IF;
         PERFORM 1 FROM project p WHERE p.tenant=in_tenant AND p.project=in_project FOR UPDATE;
         IF NOT FOUND THEN
           RAISE EXCEPTION 'save_epic: no project %/%', in_tenant, in_project
             USING ERRCODE = 'foreign_key_violation';
         END IF;
         members := ARRAY(SELECT DISTINCT t FROM unnest(in_tickets) AS t ORDER BY t);
         kept_summary := CASE WHEN btrim(coalesce(in_summary, '')) = '' THEN NULL ELSE in_summary END;
         IF in_kind = 'Revise' THEN
           SELECT * INTO found_epic FROM epic e WHERE ${held} AND e.number=in_epic;
           IF NOT FOUND THEN
             RETURN QUERY SELECT 'MissingEpic', NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint[];
             RETURN;
           END IF;
           IF in_expected IS DISTINCT FROM found_epic.revision THEN
             RETURN QUERY SELECT 'StaleRevision', NULL::bigint, NULL::bigint, found_epic.revision, NULL::bigint[];
             RETURN;
           END IF;
           IF found_epic.visibility = 'Archived' AND in_visibility = 'Archived'
              AND ARRAY(SELECT m.ticket FROM epic_ticket m
                         WHERE m.tenant=in_tenant AND m.project=in_project AND m.epic=in_epic
                         ORDER BY m.ticket) IS DISTINCT FROM members THEN
             RETURN QUERY SELECT 'ArchivedEpic', NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint[];
             RETURN;
           END IF;
         END IF;
         IF btrim(coalesce(in_title, '')) = '' THEN
           RETURN QUERY SELECT 'EmptyTitle', NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint[];
           RETURN;
         END IF;
         IF length(in_title) > ${String(epicTitleCharsMax)} THEN
           RETURN QUERY SELECT 'LongTitle', NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint[];
           RETURN;
         END IF;
         IF length(coalesce(kept_summary, '')) > ${String(epicSummaryCharsMax)} THEN
           RETURN QUERY SELECT 'LongSummary', NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint[];
           RETURN;
         END IF;
         IF octet_length('{"description":' || to_json(in_description)::text
              || CASE WHEN kept_summary IS NULL THEN '' ELSE ',"summary":' || to_json(kept_summary)::text END
              || ',"tickets":[' || array_to_string(members, ',')
              || '],"title":' || to_json(in_title)::text
              || ',"visibility":' || to_json(in_visibility)::text || '}')
            > ${String(epicContentBytesMax)} THEN
           RETURN QUERY SELECT 'LargeContent', NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint[];
           RETURN;
         END IF;
         unknown := ARRAY(SELECT t FROM unnest(members) AS t
                           WHERE NOT EXISTS (SELECT 1 FROM ticket_projection p
                                              WHERE p.tenant=in_tenant AND p.project=in_project
                                                AND p.ticket=t)
                           ORDER BY t);
         IF cardinality(unknown) > 0 THEN
           RETURN QUERY SELECT 'UnknownTickets', NULL::bigint, NULL::bigint, NULL::bigint, unknown;
           RETURN;
         END IF;
         IF in_kind = 'Create' THEN
           saved := coalesce((SELECT max(e.number) FROM epic e WHERE ${held}), 0) + 1;
           revised := 1;
           INSERT INTO epic(tenant,project,number,revision,title,summary,description,visibility)
             VALUES(in_tenant,in_project,saved,revised,in_title,kept_summary,in_description,in_visibility);
         ELSE
           saved := in_epic;
           revised := found_epic.revision + 1;
           UPDATE epic e SET revision=revised,title=in_title,summary=kept_summary,
                             description=in_description,visibility=in_visibility
            WHERE ${held} AND e.number=saved;
           DELETE FROM epic_ticket m
            WHERE m.tenant=in_tenant AND m.project=in_project AND m.epic=saved;
         END IF;
         INSERT INTO epic_ticket(tenant,project,epic,ticket)
           SELECT in_tenant,in_project,saved,t FROM unnest(members) AS t;
         INSERT INTO epic_change(tenant,project,epic,revision,actor_kind,actor_subject,
                                 title,summary,description,visibility,tickets)
           VALUES(in_tenant,in_project,saved,revised,in_actor_kind,in_actor_subject,
                  in_title,kept_summary,in_description,in_visibility,members);
         RETURN QUERY SELECT 'Saved', saved, revised, NULL::bigint, NULL::bigint[];
       END $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
    `GRANT SELECT ON TABLE public.epic TO ${apiRole}`,
    `GRANT SELECT ON TABLE public.epic_ticket TO ${apiRole}`,
    `GRANT SELECT ON TABLE public.epic_change TO ${apiRole}`,
  ],
};
