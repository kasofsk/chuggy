/**
 * A brief carries project-owned images, stored and read back exactly as its
 * links and its checks are, and named as an input bundle's own kind.
 *
 * THE IDENTITY IS OPAQUE HERE TOO. `draft_brief_image` holds the text a brief
 * names an artifact by and nothing else: no media type, no digest, both of
 * which are either recoverable from the identity itself or derived from the
 * artifact's own bytes where a bundle is built, and standing rule 3 rejects a
 * second row holding either as a stored duplicate of a derivable fact.
 *
 * THE ROSTER WIDENS WHERE `create_draft` AND `revise_draft` ALREADY NARROW IT.
 * Both doors take a new positional array between the links and the checks,
 * which is why they are dropped and recreated rather than replaced in place —
 * PostgreSQL will not let `CREATE OR REPLACE FUNCTION` insert a parameter
 * into the middle of an existing list. `read_project_drafts` is the same
 * widening for the same reason, its own column added to the table it returns.
 *
 * `input_bundle_reference_kind_is_known` WIDENS TO ADMIT THE NEW REFERENCE
 * KIND A DISPATCH'S BUNDLE NOW CARRIES ONE OF PER IMAGE, alongside the six
 * this tree already wrote down. 005's own header is the proof that widening a
 * CHECK needs no guard a narrowing would: every row already written still
 * satisfies it.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const createDraftOldSignature = `public.create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text)`;
const createDraftSignature = `public.create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text)`;

const reviseDraftOldSignature = `public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text)`;
const reviseDraftSignature = `public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text)`;

const readProjectDraftsOldSignature = `public.read_project_drafts(in_tenant text, in_project text, in_after bigint, in_max bigint)`;

export const migration039: Migration = {
  version: 39,
  name: "a brief carries project-owned images, which a dispatch's bundle pins as its own reference kind",
  statements: [
    `CREATE TABLE public.draft_brief_image (
       tenant text NOT NULL,
       project text NOT NULL,
       ticket bigint NOT NULL,
       ordinal integer NOT NULL,
       artifact text NOT NULL,
       CONSTRAINT draft_brief_image_is_a_bounded_identity CHECK ((((length(artifact) >= 1) AND (length(artifact) <= 256)) AND (artifact !~ '[[:cntrl:]]'::text))),
       CONSTRAINT draft_brief_image_ordinal_is_bounded CHECK (((ordinal >= 1) AND (ordinal <= 8)))
     )`,
    `ALTER TABLE ONLY public.draft_brief_image
       ADD CONSTRAINT draft_brief_image_pkey PRIMARY KEY (tenant, project, ticket, ordinal)`,
    `ALTER TABLE ONLY public.draft_brief_image
       ADD CONSTRAINT draft_brief_image_belongs_to_brief FOREIGN KEY (tenant, project, ticket) REFERENCES public.draft_brief(tenant, project, ticket)`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.draft_brief_image TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.draft_brief_image TO ${apiRole}`,
    `GRANT SELECT ON TABLE public.draft_brief_image TO ${ticketServiceRole}`,
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
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,minted,1,in_configuration,in_authoring,in_kind,in_subject);
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
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_ticket,next_version,in_configuration,in_authoring,in_kind,in_subject);
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
    `DROP FUNCTION ${readProjectDraftsOldSignature}`,
    `CREATE FUNCTION ${readProjectDraftsOldSignature} RETURNS TABLE(ticket bigint, authoring_version bigint, state text, configuration_revision text, authoring text, title text, intent text, branch text, repository text, finalization_mode text, finalization_target text, links text[], images text[], checks text[], version_name text, version_number bigint)
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
              v.name,v.number
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
    `ALTER FUNCTION ${readProjectDraftsOldSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${readProjectDraftsOldSignature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${readProjectDraftsOldSignature} TO ${apiRole}`,
    `ALTER TABLE public.input_bundle_reference
       DROP CONSTRAINT input_bundle_reference_kind_is_known,
       ADD CONSTRAINT input_bundle_reference_kind_is_known CHECK ((reference_kind = ANY (ARRAY['ResultManifest'::text, 'ConfigurationRevision'::text, 'Repository'::text, 'FinalizationAttempt'::text, 'ConflictManifest'::text, 'TargetCommit'::text, 'ProjectArtifact'::text])))`,
  ],
};
