/**
 * The door a draft is created into an epic through.
 *
 * `create_draft_in_epic` IS `create_draft` WITH ONE MORE WRITE IN ITS
 * TRANSACTION: the draft's ticket joins the epic, which takes the next
 * revision and appends its `epic_change`, so a writer holding the earlier
 * revision is refused as stale rather than saving the member away. The
 * project row's lock is taken first and held through, which is what makes the
 * ticket number the lock reads the one `create_draft` then mints and what
 * serializes the epic against `save_epic`.
 *
 * THE EPIC IS REFUSED BEFORE THE DRAFT IS ASKED, in `save_epic`'s order and
 * under its names, `MissingEpic`, `ArchivedEpic` and `LargeContent` — the last
 * with the new member counted — and a refusal has written nothing. A fence
 * `create_draft` refuses on is answered by `create_draft` itself, with the
 * epic untouched. The member is a draft that `ticket_projection` does not hold
 * until it is released, so a later `save_epic` that keeps it is refused as an
 * unknown ticket until then.
 */

import { epicContentBytesMax } from "../../../../domain/epics.ts";
import {
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  draftInEpicFunction,
  type Migration,
} from "../shared.ts";

const parameters =
  "in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_selection text, in_kind text, in_subject text, in_origin_session text, in_landing text, in_epic bigint";

const signature = `public.${draftInEpicFunction}(${parameters})`;

const forwarded =
  "in_tenant, in_project, in_configuration, in_configuration_digest, in_expected_head, in_authoring, in_title, in_intent, in_links, in_images, in_checks, in_branch, in_finalization_mode, in_finalization_target, in_repository, in_overrides, in_selection, in_kind, in_subject, in_origin_session, in_landing";

export const migration124: Migration = {
  version: 124,
  name: "a draft is created into an epic in the one transaction",
  statements: [
    `CREATE FUNCTION ${signature}
    RETURNS TABLE(result text, ticket bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       DECLARE minted bigint; fenced boolean; found_epic epic%ROWTYPE; members bigint[];
               revised bigint; created_result text; created_ticket bigint;
       BEGIN
         SELECT p.ticket_next, (p.lifecycle='Active' AND p.head=in_expected_head)
           INTO minted, fenced FROM project p
          WHERE p.tenant=in_tenant AND p.project=in_project
            FOR UPDATE;
         IF NOT FOUND OR NOT fenced THEN
           RETURN QUERY SELECT d.result, d.ticket FROM ${draftCreateFunction}(${forwarded}) d;
           RETURN;
         END IF;
         SELECT * INTO found_epic FROM epic e
          WHERE e.tenant=in_tenant AND e.project=in_project AND e.number=in_epic;
         IF NOT FOUND THEN
           RETURN QUERY SELECT 'MissingEpic', NULL::bigint;
           RETURN;
         END IF;
         IF found_epic.visibility = 'Archived' THEN
           RETURN QUERY SELECT 'ArchivedEpic', NULL::bigint;
           RETURN;
         END IF;
         members := ARRAY(SELECT m.ticket FROM epic_ticket m
                           WHERE m.tenant=in_tenant AND m.project=in_project AND m.epic=in_epic
                           ORDER BY m.ticket) || minted;
         IF octet_length('{"description":' || to_json(found_epic.description)::text
              || CASE WHEN found_epic.summary IS NULL THEN '' ELSE ',"summary":' || to_json(found_epic.summary)::text END
              || ',"tickets":[' || array_to_string(members, ',')
              || '],"title":' || to_json(found_epic.title)::text
              || ',"visibility":' || to_json(found_epic.visibility)::text || '}')
            > ${String(epicContentBytesMax)} THEN
           RETURN QUERY SELECT 'LargeContent', NULL::bigint;
           RETURN;
         END IF;
         SELECT d.result, d.ticket INTO created_result, created_ticket
           FROM ${draftCreateFunction}(${forwarded}) d;
         IF created_result IS DISTINCT FROM 'Created' THEN
           RETURN QUERY SELECT created_result, created_ticket;
           RETURN;
         END IF;
         revised := found_epic.revision + 1;
         UPDATE epic e SET revision=revised
          WHERE e.tenant=in_tenant AND e.project=in_project AND e.number=in_epic;
         INSERT INTO epic_ticket(tenant,project,epic,ticket)
           VALUES(in_tenant,in_project,in_epic,created_ticket);
         INSERT INTO epic_change(tenant,project,epic,revision,actor_kind,actor_subject,
                                 title,summary,description,visibility,tickets)
           VALUES(in_tenant,in_project,in_epic,revised,in_kind,in_subject,
                  found_epic.title,found_epic.summary,found_epic.description,
                  found_epic.visibility,members);
         RETURN QUERY SELECT created_result, created_ticket;
       END $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
