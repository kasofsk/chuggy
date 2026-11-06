/**
 * A draft is a member an epic may hold, and deleting one takes it out.
 *
 * `save_epic` ANSWERS A TICKET THE PROJECT HOLDS, OR A DRAFT IT HOLDS: a number
 * is unknown only where it is neither in `ticket_projection` nor a draft that
 * is not Deleted. A draft filed into an epic is a member from the moment it is
 * filed, so a save that kept it was refused until it was released; the member
 * now persists through a revision of the draft and through its release, which
 * change no membership.
 *
 * `delete_draft` LEAVES THE EPICS A DELETED DRAFT WAS IN. Under the project
 * row's lock, as `save_epic` takes it, each epic holding the draft drops it,
 * takes the next revision and appends its `epic_change` under the deleter's
 * own authority, in the transaction that deletes the draft. A draft in no epic
 * is deleted as it was.
 */

import {
  epicContentBytesMax,
  epicSummaryCharsMax,
  epicTitleCharsMax,
} from "../../../../domain/epics.ts";
import {
  draftDeleteFunction,
  epicSaveFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${epicSaveFunction}(in_tenant text, in_project text, in_kind text, in_epic bigint, in_expected bigint, in_title text, in_summary text, in_description text, in_visibility text, in_tickets bigint[], in_actor_kind text, in_actor_subject text)`;

const deleteSignature = `public.${draftDeleteFunction}(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_kind text, in_subject text)`;

const held = "e.tenant=in_tenant AND e.project=in_project";

export const migration127: Migration = {
  version: 127,
  name: "a draft is an epic member, and deleting one leaves its epics",
  statements: [
    `CREATE OR REPLACE FUNCTION ${signature}
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
                             AND NOT EXISTS (SELECT 1 FROM draft d
                                              WHERE d.tenant=in_tenant AND d.project=in_project
                                                AND d.ticket=t AND d.state<>'Deleted')
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
    `CREATE OR REPLACE FUNCTION ${deleteSignature} RETURNS TABLE(result text, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE;
             left_epic record;
             members bigint[];
     BEGIN
       PERFORM 1 FROM project p WHERE p.tenant=in_tenant AND p.project=in_project FOR UPDATE;
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state <> 'Draft' THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         SELECT r.tenant,r.project,r.ticket,r.authoring_version+1,r.configuration_revision,r.authoring,in_kind,in_subject
           FROM draft_revision r WHERE r.tenant=in_tenant AND r.project=in_project AND r.ticket=in_ticket
            AND r.authoring_version=current.authoring_version;
       UPDATE draft d SET state='Deleted',authoring_version=d.authoring_version+1
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.ticket=in_ticket;
       FOR left_epic IN
         SELECT m.epic FROM epic_ticket m
          WHERE m.tenant=in_tenant AND m.project=in_project AND m.ticket=in_ticket
          ORDER BY m.epic
       LOOP
         DELETE FROM epic_ticket m
          WHERE m.tenant=in_tenant AND m.project=in_project AND m.epic=left_epic.epic AND m.ticket=in_ticket;
         members := ARRAY(SELECT m.ticket FROM epic_ticket m
                           WHERE m.tenant=in_tenant AND m.project=in_project AND m.epic=left_epic.epic
                           ORDER BY m.ticket);
         UPDATE epic e SET revision=e.revision+1
          WHERE ${held} AND e.number=left_epic.epic;
         INSERT INTO epic_change(tenant,project,epic,revision,actor_kind,actor_subject,
                                 title,summary,description,visibility,tickets)
           SELECT e.tenant,e.project,e.number,e.revision,in_kind,in_subject,
                  e.title,e.summary,e.description,e.visibility,members
             FROM epic e WHERE ${held} AND e.number=left_epic.epic;
       END LOOP;
       PERFORM publish_project_notification(in_tenant,in_project,'Draft',in_ticket::text,NULL,current.authoring_version+1);
       RETURN QUERY SELECT 'Deleted',current.authoring_version+1,'Deleted'::text;
     END $$`,
  ],
};
