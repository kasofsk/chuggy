/**
 * A draft names a configuration and, optionally, the parts of it the ticket
 * replaces, and a released ticket keeps the ones it was released under.
 *
 * THE OVERRIDES ARE THE REVISION'S. A draft revision is immutable and names the
 * configuration it pins, so the overrides of that pin are a column beside it:
 * a release reads the revision it names, and a revision that omits them has
 * none. A released ticket keeps them where it keeps its brief, in
 * `ticket_definition`, because the draft is revised in place while the ticket
 * is Pending and nothing else recovers the ones a release took.
 *
 * `create_draft`, `revise_draft` AND `read_project_drafts` ARE DROPPED AND
 * RECREATED for the reason 039 gives: a parameter or a returned column cannot
 * be added in place. `revise_draft` is otherwise 039's, its Pending guard
 * included. The overrides travel as text and are stored as `jsonb`, so a value
 * that is not a JSON object is refused by the column rather than stored.
 *
 * THE GRANTS ARE BY COLUMN where 016 granted `ticket_definition` by column: the
 * ticket service updates the overrides an update replaces, and the API reads
 * them for the ticket's own read. Every other role holds the tables whole.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

/** The longest stored overrides the columns admit, as their text. */
const overridesCharsMax = 65_536;

const createDraftOldSignature = `public.create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text)`;
const createDraftSignature = `public.create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_kind text, in_subject text)`;

const reviseDraftOldSignature = `public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text)`;
const reviseDraftSignature = `public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_kind text, in_subject text)`;

const readProjectDraftsSignature = `public.read_project_drafts(in_tenant text, in_project text, in_after bigint, in_max bigint)`;

/** The CHECK one overrides column carries: absent, or one bounded object. */
function overridesBounded(table: string): string {
  return `ALTER TABLE public.${table}
       ADD COLUMN overrides jsonb,
       ADD CONSTRAINT ${table}_overrides_is_bounded CHECK (((overrides IS NULL) OR ((jsonb_typeof(overrides) = 'object'::text) AND (length((overrides)::text) <= ${String(overridesCharsMax)}))))`;
}

export const migration040: Migration = {
  version: 40,
  name: "a draft names overrides to its configuration, and a released ticket keeps the ones it was released under",
  statements: [
    overridesBounded("draft_revision"),
    overridesBounded("ticket_definition"),
    `GRANT UPDATE(overrides) ON TABLE public.ticket_definition TO ${ticketServiceRole}`,
    `GRANT SELECT(overrides) ON TABLE public.ticket_definition TO ${apiRole}`,
    `DROP FUNCTION ${createDraftOldSignature}`,
    `CREATE FUNCTION ${createDraftSignature} RETURNS TABLE(result text, ticket bigint, authoring_version bigint, state text)
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
       INSERT INTO draft VALUES (in_tenant,in_project,minted,1,'Draft',in_configuration);
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,overrides,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,minted,1,in_configuration,in_authoring,in_overrides::jsonb,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target,repository)
         VALUES (in_tenant,in_project,minted,in_title,in_intent,in_branch,landing,target,in_repository);
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
    `ALTER FUNCTION ${createDraftSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${createDraftSignature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${createDraftSignature} TO ${apiRole}`,
    `DROP FUNCTION ${reviseDraftOldSignature}`,
    `CREATE FUNCTION ${reviseDraftSignature} RETURNS TABLE(result text, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE; next_version bigint; landing text; target text;
       phase text; offered jsonb; locked jsonb;
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
       IF current.state = 'Released' THEN
         IF in_authoring IS JSON OBJECT THEN
           offered := in_authoring::jsonb;
         END IF;
         SELECT CASE WHEN r.authoring IS JSON OBJECT THEN r.authoring::jsonb END INTO locked
           FROM draft_revision r
          WHERE r.tenant=in_tenant AND r.project=in_project AND r.ticket=in_ticket
            AND r.authoring_version=current.released_authoring_version;
         IF jsonb_typeof(offered->'dependencies') IS DISTINCT FROM 'array'
            OR jsonb_typeof(locked->'dependencies') IS DISTINCT FROM 'array'
         THEN RETURN QUERY SELECT 'DependenciesLocked',current.authoring_version,current.state; RETURN; END IF;
         IF (SELECT array_agg(DISTINCT dependency ORDER BY dependency)
                  FROM jsonb_array_elements(offered->'dependencies') AS offered_dependencies(dependency))
               IS DISTINCT FROM
               (SELECT array_agg(DISTINCT dependency ORDER BY dependency)
                  FROM jsonb_array_elements(locked->'dependencies') AS locked_dependencies(dependency))
         THEN RETURN QUERY SELECT 'DependenciesLocked',current.authoring_version,current.state; RETURN; END IF;
       END IF;
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
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,overrides,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_ticket,next_version,in_configuration,in_authoring,in_overrides::jsonb,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target,repository)
         VALUES (in_tenant,in_project,in_ticket,in_title,in_intent,in_branch,landing,target,in_repository)
         ON CONFLICT (tenant,project,ticket) DO UPDATE SET title=EXCLUDED.title,intent=EXCLUDED.intent,
           branch=EXCLUDED.branch,repository=EXCLUDED.repository,
           finalization_mode=EXCLUDED.finalization_mode,finalization_target=EXCLUDED.finalization_target;
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
    `ALTER FUNCTION ${reviseDraftSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${reviseDraftSignature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${reviseDraftSignature} TO ${apiRole}`,
    `DROP FUNCTION ${readProjectDraftsSignature}`,
    `CREATE FUNCTION ${readProjectDraftsSignature} RETURNS TABLE(ticket bigint, authoring_version bigint, state text, configuration_revision text, authoring text, title text, intent text, branch text, repository text, finalization_mode text, finalization_target text, links text[], images text[], checks text[], version_name text, version_number bigint, overrides text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT d.ticket,d.authoring_version,d.state,d.configuration_revision,
              r.authoring,b.title,b.intent,b.branch,b.repository,
              b.finalization_mode,b.finalization_target,
              (SELECT array_agg(k.url ORDER BY k.ordinal) FROM draft_brief_link k
                WHERE k.tenant=d.tenant AND k.project=d.project
                  AND k.ticket=d.ticket),
              (SELECT array_agg(i.artifact ORDER BY i.ordinal) FROM draft_brief_image i
                WHERE i.tenant=d.tenant AND i.project=d.project
                  AND i.ticket=d.ticket),
              (SELECT array_agg(c.command ORDER BY c.ordinal) FROM draft_brief_check c
                WHERE c.tenant=d.tenant AND c.project=d.project
                  AND c.ticket=d.ticket),
              v.name,v.number,r.overrides::text
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
    `ALTER FUNCTION ${readProjectDraftsSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${readProjectDraftsSignature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${readProjectDraftsSignature} TO ${apiRole}`,
  ],
};
