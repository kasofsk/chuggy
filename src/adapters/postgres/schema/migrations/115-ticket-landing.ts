/**
 * A ticket's brief names how its landing is ordered against the others on its
 * reference, `Direct` where it names none.
 *
 * `draft_brief.landing_policy` HOLDS IT, every row `Direct` before this and
 * every write after storing what its door resolved. A released ticket keeps it
 * in `ticket_definition.brief` beside the finalization, absent there where it
 * is `Direct`, which is how a brief released before it still digests to what
 * its release stored.
 *
 * `create_draft`, `revise_draft` AND `read_project_drafts` ARE DROPPED AND
 * RECREATED for the reason 039 gives, each otherwise what it was: 086's, 085's
 * and 064's, with the landing last, and named by neither door it is `Direct`.
 * The configuration importer's move door
 * hands the released brief's landing to `revise_draft` with the rest of it.
 */

import {
  apiRole,
  boundaryOwnerRole,
  configurationFollowingMoveFunction,
  type Migration,
} from "../shared.ts";

const createDraftOldSignature = `public.create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_selection text, in_kind text, in_subject text, in_origin_session text)`;
const createDraftParameters = `public.create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_selection text, in_kind text, in_subject text, in_origin_session text`;
const createDraftSignature = `${createDraftParameters}, in_landing text)`;

const reviseDraftOldSignature = `public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_selection text, in_kind text, in_subject text)`;
const reviseDraftParameters = `public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_selection text, in_kind text, in_subject text`;
const reviseDraftSignature = `${reviseDraftParameters}, in_landing text)`;

const readProjectDraftsSignature = `public.read_project_drafts(in_tenant text, in_project text, in_after bigint, in_max bigint)`;

const move = `public.${configurationFollowingMoveFunction}(in_tenant text, in_project text, in_ticket bigint, in_expected_revision bigint, in_configuration text, in_program text, in_operation text, in_authority_subject text, in_ordinary_soft_limit bigint, in_hard_limit bigint)`;

/** One array of the released brief, in its order. */
function briefArray(field: string): string {
  return `ARRAY(SELECT x.value FROM jsonb_array_elements_text(COALESCE(brief->'${field}','[]'::jsonb)) WITH ORDINALITY AS x(value, ordinal) ORDER BY x.ordinal)`;
}

/** The SQLSTATE the move door raises to undo its revise, and catches. */
const moveRefused = "CHF01";

/** The owner and the one grant each function ends with, the API the only caller. */
function owned(signature: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ];
}

export const migration115: Migration = {
  version: 115,
  name: "a brief names how its landing is ordered against the others on its reference",
  statements: [
    `ALTER TABLE public.draft_brief
       ADD COLUMN landing_policy text DEFAULT 'Direct'::text NOT NULL,
       ADD CONSTRAINT draft_brief_landing_policy_is_known CHECK ((landing_policy = ANY (ARRAY['Direct'::text, 'Serialized'::text])))`,
    `DROP FUNCTION ${createDraftOldSignature}`,
    `CREATE FUNCTION ${createDraftParameters}, in_landing text DEFAULT NULL) RETURNS TABLE(result text, ticket bigint, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE minted bigint; landing text; target text;
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project
            AND revision=in_configuration AND digest=in_configuration_digest)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       IF in_repository IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_repository
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository
              AND retired_at IS NULL)
         THEN RETURN QUERY SELECT 'RepositoryNotBound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       landing := coalesce(in_finalization_mode,
     (SELECT b.landing_mode FROM project_repository b
       WHERE b.tenant=in_tenant AND b.project=in_project
         AND b.repository=in_repository),
     'Push');
       target := in_finalization_target;
       IF landing IN ('PullRequest','PullRequestMerge') AND in_branch IS NULL THEN
         RETURN QUERY SELECT 'LandingUnbranched',NULL::bigint,NULL::bigint,NULL::text; RETURN;
       END IF;
       UPDATE project SET ticket_next=ticket_next+1
        WHERE tenant=in_tenant AND project=in_project AND lifecycle='Active' AND head=in_expected_head
        RETURNING ticket_next-1 INTO minted;
       IF minted IS NULL THEN RETURN QUERY SELECT 'Stale',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       INSERT INTO draft (tenant,project,ticket,authoring_version,state,configuration_revision,origin_session)
         VALUES (in_tenant,in_project,minted,1,'Draft',in_configuration,in_origin_session);
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,overrides,selection,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,minted,1,in_configuration,in_authoring,in_overrides::jsonb,in_selection::jsonb,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target,repository,landing_policy)
         VALUES (in_tenant,in_project,minted,in_title,in_intent,in_branch,landing,target,in_repository,coalesce(in_landing,'Direct'));
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,minted,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       INSERT INTO draft_brief_image (tenant,project,ticket,ordinal,artifact)
         SELECT in_tenant,in_project,minted,image.ordinal,image.artifact
           FROM unnest(in_images) WITH ORDINALITY AS image(artifact,ordinal);
       INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
         SELECT in_tenant,in_project,minted,line.ordinal,line.command
           FROM unnest(in_checks) WITH ORDINALITY AS line(command,ordinal);
       PERFORM publish_project_notification(in_tenant,in_project,'Draft',minted::text,NULL,1);
       RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
     END $$`,
    ...owned(createDraftSignature),
    `DROP FUNCTION ${reviseDraftOldSignature}`,
    `CREATE FUNCTION ${reviseDraftParameters}, in_landing text DEFAULT NULL) RETURNS TABLE(result text, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE; next_version bigint; landing text; target text;
       phase text;
     BEGIN
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state = 'Released' THEN
         SELECT p.phase INTO phase FROM ticket_projection p
          WHERE p.tenant=in_tenant AND p.project=in_project AND p.ticket=in_ticket;
       END IF;
       IF current.state <> 'Draft' AND NOT (current.state = 'Released' AND phase IS NOT DISTINCT FROM 'Pending')
         THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project AND revision=in_configuration)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',current.authoring_version,current.state; RETURN; END IF;
       IF in_repository IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_repository
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository
              AND retired_at IS NULL)
         THEN RETURN QUERY SELECT 'RepositoryNotBound',current.authoring_version,current.state; RETURN; END IF;
       landing := coalesce(in_finalization_mode,
     (SELECT b.landing_mode FROM project_repository b
       WHERE b.tenant=in_tenant AND b.project=in_project
         AND b.repository=in_repository),
     'Push');
       target := in_finalization_target;
       IF landing IN ('PullRequest','PullRequestMerge') AND in_branch IS NULL THEN
         RETURN QUERY SELECT 'LandingUnbranched',current.authoring_version,current.state; RETURN;
       END IF;
       next_version := current.authoring_version+1;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,overrides,selection,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_ticket,next_version,in_configuration,in_authoring,in_overrides::jsonb,in_selection::jsonb,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target,repository,landing_policy)
         VALUES (in_tenant,in_project,in_ticket,in_title,in_intent,in_branch,landing,target,in_repository,coalesce(in_landing,'Direct'))
         ON CONFLICT (tenant,project,ticket) DO UPDATE SET title=EXCLUDED.title,intent=EXCLUDED.intent,
           branch=EXCLUDED.branch,repository=EXCLUDED.repository,
           finalization_mode=EXCLUDED.finalization_mode,finalization_target=EXCLUDED.finalization_target,
           landing_policy=EXCLUDED.landing_policy;
       DELETE FROM draft_brief_link
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,in_ticket,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       DELETE FROM draft_brief_image
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_image (tenant,project,ticket,ordinal,artifact)
         SELECT in_tenant,in_project,in_ticket,image.ordinal,image.artifact
           FROM unnest(in_images) WITH ORDINALITY AS image(artifact,ordinal);
       DELETE FROM draft_brief_check
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
         SELECT in_tenant,in_project,in_ticket,line.ordinal,line.command
           FROM unnest(in_checks) WITH ORDINALITY AS line(command,ordinal);
       UPDATE draft SET authoring_version=next_version,configuration_revision=in_configuration
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       PERFORM publish_project_notification(in_tenant,in_project,'Draft',in_ticket::text,NULL,next_version);
       RETURN QUERY SELECT 'Revised',next_version,current.state;
     END $$`,
    ...owned(reviseDraftSignature),
    `DROP FUNCTION ${readProjectDraftsSignature}`,
    `CREATE FUNCTION ${readProjectDraftsSignature} RETURNS TABLE(ticket bigint, authoring_version bigint, state text, configuration_revision text, authoring text, title text, intent text, branch text, repository text, finalization_mode text, finalization_target text, landing_policy text, links text[], images text[], checks text[], version_name text, version_number bigint, overrides text, selection text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT d.ticket,d.authoring_version,d.state,d.configuration_revision,
              r.authoring,b.title,b.intent,b.branch,b.repository,
              b.finalization_mode,b.finalization_target,b.landing_policy,
              (SELECT array_agg(k.url ORDER BY k.ordinal) FROM draft_brief_link k
                WHERE k.tenant=d.tenant AND k.project=d.project
                  AND k.ticket=d.ticket),
              (SELECT array_agg(i.artifact ORDER BY i.ordinal) FROM draft_brief_image i
                WHERE i.tenant=d.tenant AND i.project=d.project
                  AND i.ticket=d.ticket),
              (SELECT array_agg(c.command ORDER BY c.ordinal) FROM draft_brief_check c
                WHERE c.tenant=d.tenant AND c.project=d.project
                  AND c.ticket=d.ticket),
              v.name,v.number,r.overrides::text,r.selection::text
         FROM draft d
         JOIN draft_revision r USING (tenant,project,ticket,authoring_version)
         LEFT JOIN draft_brief b
           ON b.tenant=d.tenant AND b.project=d.project AND b.ticket=d.ticket
         LEFT JOIN repository_configuration_provenance p
           ON p.tenant=d.tenant AND p.project=d.project
          AND p.revision=d.configuration_revision
         LEFT JOIN repository_configuration_version v
           ON v.tenant=d.tenant AND v.project=d.project
          AND v.name=p.name AND v.digest=p.digest
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.state='Draft'
          AND d.ticket>coalesce(in_after,0)
        ORDER BY d.ticket
        LIMIT least(coalesce(in_max,101),
                    101)
     $$`,
    ...owned(readProjectDraftsSignature),
    `CREATE OR REPLACE FUNCTION ${move}
       RETURNS TABLE(result text, operation text)
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       DECLARE held record; revised record; accepted record; answer text;
         brief jsonb; command_text text; move_key text; payload text;
       BEGIN
         PERFORM 1 FROM project p
          WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
         SELECT e.authoring_version, e.released_authoring_version, d.brief,
                d.overrides::text AS overrides, d.selection::text AS selection,
                r.authoring, n.authority_kind, n.authority_subject
           INTO held
           FROM draft e
           JOIN ticket_definition d
             ON d.tenant = e.tenant AND d.project = e.project AND d.ticket = e.ticket
           JOIN draft_revision r
             ON r.tenant = e.tenant AND r.project = e.project AND r.ticket = e.ticket
            AND r.authoring_version = e.released_authoring_version
           JOIN draft_revision n
             ON n.tenant = e.tenant AND n.project = e.project AND n.ticket = e.ticket
            AND n.authoring_version = e.authoring_version
          WHERE e.tenant = in_tenant AND e.project = in_project
            AND e.ticket = in_ticket AND e.state = 'Released'
            AND d.brief IS NOT NULL
            FOR UPDATE OF e;
         IF NOT FOUND THEN
           RETURN QUERY SELECT 'NotFound'::text, NULL::text;
           RETURN;
         END IF;
         IF held.authoring_version <> held.released_authoring_version
            AND NOT (held.authority_kind = 'Service'
                     AND held.authority_subject = in_authority_subject) THEN
           RETURN QUERY SELECT 'Stale'::text, NULL::text;
           RETURN;
         END IF;
         brief := held.brief;
         BEGIN
           SELECT * INTO revised FROM revise_draft(
             in_tenant, in_project, in_ticket, held.authoring_version,
             in_configuration,
             jsonb_set(held.authoring::jsonb, '{program}', in_program::jsonb)::text,
             brief->>'title', brief->>'intent', ${briefArray("links")},
             ${briefArray("images")}, ${briefArray("checks")}, brief->>'branch',
             brief->'finalization'->>'mode', brief->'finalization'->>'target',
             brief->>'repository', held.overrides, held.selection, 'Service',
             in_authority_subject, brief->>'landing');
           IF revised.result IS DISTINCT FROM 'Revised' THEN
             answer := revised.result;
             RAISE EXCEPTION USING ERRCODE = '${moveRefused}';
           END IF;
           command_text := jsonb_build_object('version', 1,
             'command', 'UpdateTicket', 'ticket', in_ticket,
             'expectedRevision', in_expected_revision,
             'authoringVersion', revised.authoring_version,
             'configurationRevision', in_configuration)::text;
           move_key := encode(sha256(convert_to('configuration-following:'
             || in_ticket::text || ':' || in_expected_revision::text || ':'
             || in_configuration, 'UTF8')), 'hex');
           payload := encode(sha256(convert_to(command_text, 'UTF8')), 'hex');
           SELECT * INTO accepted FROM accept_operation(
             in_tenant, in_project, in_operation, 'Service', in_authority_subject,
             'configuration-following-v1', move_key, payload, ARRAY[move_key],
             ARRAY[payload], command_text, in_ordinary_soft_limit, in_hard_limit,
             NULL);
           IF accepted.result IS DISTINCT FROM 'Accepted' THEN
             answer := accepted.result;
             RAISE EXCEPTION USING ERRCODE = '${moveRefused}';
           END IF;
         EXCEPTION WHEN SQLSTATE '${moveRefused}' THEN
           RETURN QUERY SELECT answer, NULL::text;
           RETURN;
         END;
         RETURN QUERY SELECT 'Accepted'::text, accepted.operation::text;
       END
     $$`,
  ],
};
