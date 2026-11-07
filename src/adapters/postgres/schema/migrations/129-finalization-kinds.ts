/**
 * A draft's brief and a repository's landing default each store a whole
 * finalization: its kind, and for a `GitMerge` its mode and policy.
 *
 * `draft_brief` GAINS `finalization_kind` AND `finalization_policy`, and its
 * `finalization_mode` holds a `GitMerge`'s mode alone. A row stored by mode
 * moves forward the way the reader before this read it: a push or a merged
 * proposal is a `GitMerge` under the policy beside it, a pull request a
 * `PullRequest` and landing nothing `None`, a policy beside either of those
 * dropped. `landing_policy` is retired with the doors that read it. A released
 * brief keeps `ticket_definition.brief` exactly as its release stored it.
 *
 * `project_repository` GAINS `landing_kind` AND `landing_policy` the same way,
 * its `landing_mode` likewise a `GitMerge`'s mode alone, a binding standing at
 * a push or a merged proposal moving forward `Direct`. A binding made from here
 * on lands by pull request, as 028 made it. The immutability trigger lets the
 * two new columns move beside the mode, the boundary owner is granted their
 * update, and the landing door compares and writes the three as one value.
 *
 * EVERY DOOR ANSWERING EITHER IS DROPPED AND RECREATED, because each answers
 * the columns and a function's answer cannot be widened in place, each
 * otherwise what it was and granted to the roles it held. `create_draft`,
 * `create_draft_in_epic` and `revise_draft` take the kind and the policy in
 * place of the landing 115 gave them, and a draft naming no kind takes the
 * whole of its repository's, or `GitMerge` by `Push` ordered `Direct` where it
 * names no repository. The configuration importer's move door maps the
 * released brief's finalization forward as the rows are, and hands it to
 * `revise_draft`.
 */

import { epicContentBytesMaxAt122, epicTicketsMaxAt122 } from "./122-epics.ts";
import {
  apiRole,
  boundaryOwnerRole,
  configurationFollowingMoveFunction,
  draftCreateFunction,
  draftInEpicFunction,
  finalizerRole,
  repositoryBindingListFunction,
  repositoryLandingReadFunction,
  repositoryLandingWriteFunction,
  repositoryRetirementWriteFunction,
  schedulerRole,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const draftParameters =
  "in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_selection text, in_kind text, in_subject text, in_origin_session text";
const createDraftOld = `public.${draftCreateFunction}(${draftParameters}, in_landing text)`;
const createDraft = `public.${draftCreateFunction}(${draftParameters}, in_finalization_kind text, in_finalization_policy text)`;

const inEpicOld = `public.${draftInEpicFunction}(${draftParameters}, in_landing text, in_epic bigint)`;
const inEpic = `public.${draftInEpicFunction}(${draftParameters}, in_finalization_kind text, in_finalization_policy text, in_epic bigint)`;
const inEpicForwarded =
  "in_tenant, in_project, in_configuration, in_configuration_digest, in_expected_head, in_authoring, in_title, in_intent, in_links, in_images, in_checks, in_branch, in_finalization_mode, in_finalization_target, in_repository, in_overrides, in_selection, in_kind, in_subject, in_origin_session, in_finalization_kind, in_finalization_policy";

const reviseParameters =
  "in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_selection text, in_kind text, in_subject text";
const reviseDraftOld = `public.revise_draft(${reviseParameters}, in_landing text)`;
const reviseDraft = `public.revise_draft(${reviseParameters}, in_finalization_kind text, in_finalization_policy text)`;

const readProjectDrafts = `public.read_project_drafts(in_tenant text, in_project text, in_after bigint, in_max bigint)`;

const move = `public.${configurationFollowingMoveFunction}(in_tenant text, in_project text, in_ticket bigint, in_expected_revision bigint, in_configuration text, in_program text, in_operation text, in_authority_subject text, in_ordinary_soft_limit bigint, in_hard_limit bigint)`;

const list = `public.${repositoryBindingListFunction}(in_tenant text, in_project text, in_max bigint)`;
const read = `public.${repositoryLandingReadFunction}(in_tenant text, in_project text, in_repository text)`;
const retire = `public.${repositoryRetirementWriteFunction}(in_tenant text, in_project text, in_repository text)`;
const setOld = `public.${repositoryLandingWriteFunction}(in_tenant text, in_project text, in_repository text, in_expected_mode text, in_mode text, in_expected_pipelines_writable boolean, in_pipelines_writable boolean)`;
const set = `public.${repositoryLandingWriteFunction}(in_tenant text, in_project text, in_repository text, in_expected_kind text, in_expected_mode text, in_expected_policy text, in_kind text, in_mode text, in_policy text, in_expected_pipelines_writable boolean, in_pipelines_writable boolean)`;

/** The columns every binding door answers, in the order each answers them. */
const bindingColumns =
  "repository text, bound_at timestamp with time zone, landing_kind text, landing_mode text, landing_policy text, pipelines_writable boolean, retired_at timestamp with time zone";

/** The SQLSTATE the move door raises to undo its revise, and catches. */
const moveRefused = "CHF01";

/** The kind a finalization stored by `mode` maps forward to, null where it names none. */
function migration129KindOf(mode: string): string {
  return `CASE WHEN ${mode} IN ('Push','PullRequestMerge') THEN 'GitMerge' ELSE ${mode} END`;
}

/** The mode a `GitMerge` mapped forward from `mode` keeps, and null for any other kind. */
function migration129ModeOf(mode: string): string {
  return `CASE WHEN ${mode} IN ('Push','PullRequestMerge') THEN ${mode} END`;
}

/** The policy beside `mode` a `GitMerge` keeps, `Direct` where `policy` is null, and null for any other kind. */
function migration129PolicyOf(mode: string, policy: string): string {
  return `CASE WHEN ${mode} IN ('Push','PullRequestMerge') THEN coalesce(${policy},'Direct') END`;
}

/** One array of the released brief, in its order. */
function migration129BriefArray(field: string): string {
  return `ARRAY(SELECT x.value FROM jsonb_array_elements_text(COALESCE(brief->'${field}','[]'::jsonb)) WITH ORDINALITY AS x(value, ordinal) ORDER BY x.ordinal)`;
}

/** The statements that own one door and grant it to exactly the roles named, as `ALL` where its earlier grant was. */
function migration129Owned(
  signature: string,
  roles: readonly string[],
  privilege: "ALL" | "EXECUTE" = "EXECUTE",
): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...roles.map(
      (role) => `GRANT ${privilege} ON FUNCTION ${signature} TO ${role}`,
    ),
  ];
}

/**
 * The finalization a draft write stores, resolved into `kind`, `mode` and
 * `policy`: the one written, or else the whole of its repository's, or else
 * `GitMerge` by `Push` ordered `Direct`. A mode or a policy written with no
 * kind is a caller's fault and is raised.
 */
const draftResolved = `
       IF in_finalization_kind IS NULL
          AND (in_finalization_mode IS NOT NULL OR in_finalization_policy IS NOT NULL) THEN
         RAISE EXCEPTION 'draft finalization: a mode or a policy names the kind it belongs to'
           USING ERRCODE = 'invalid_parameter_value';
       END IF;
       kind := in_finalization_kind; mode := in_finalization_mode; policy := in_finalization_policy;
       IF kind IS NULL THEN
         SELECT b.landing_kind,b.landing_mode,b.landing_policy INTO kind,mode,policy
           FROM project_repository b
          WHERE b.tenant=in_tenant AND b.project=in_project AND b.repository=in_repository;
       END IF;
       IF kind IS NULL THEN kind := 'GitMerge'; mode := 'Push'; policy := 'Direct'; END IF;
       target := in_finalization_target;`;

/** Whether the resolved finalization opens a proposal, which needs a branch to open it from. */
const draftProposes = `(kind = 'PullRequest' OR mode IS NOT DISTINCT FROM 'PullRequestMerge')`;

const draftBriefStatements: readonly string[] = [
  `ALTER TABLE public.draft_brief
     DROP CONSTRAINT draft_brief_finalization_is_whole,
     DROP CONSTRAINT draft_brief_finalization_mode_is_known,
     DROP CONSTRAINT draft_brief_finalization_none_names_no_reference,
     DROP CONSTRAINT draft_brief_finalization_target_needs_a_mode,
     ADD COLUMN finalization_kind text,
     ADD COLUMN finalization_policy text`,
  `UPDATE public.draft_brief
      SET finalization_kind=coalesce(${migration129KindOf("finalization_mode")},'None'),
          finalization_policy=${migration129PolicyOf("finalization_mode", "landing_policy")},
          finalization_mode=${migration129ModeOf("finalization_mode")}`,
  `ALTER TABLE public.draft_brief
     ALTER COLUMN finalization_kind SET NOT NULL,
     DROP COLUMN landing_policy,
     ADD CONSTRAINT draft_brief_finalization_kind_is_known CHECK ((finalization_kind = ANY (ARRAY['GitMerge'::text, 'PullRequest'::text, 'None'::text]))),
     ADD CONSTRAINT draft_brief_finalization_mode_is_known CHECK ((finalization_mode = ANY (ARRAY['Push'::text, 'PullRequestMerge'::text]))),
     ADD CONSTRAINT draft_brief_finalization_policy_is_known CHECK ((finalization_policy = ANY (ARRAY['Direct'::text, 'Serialized'::text]))),
     ADD CONSTRAINT draft_brief_finalization_is_by_kind CHECK (((finalization_kind = 'GitMerge'::text) = (finalization_mode IS NOT NULL)) AND ((finalization_kind = 'GitMerge'::text) = (finalization_policy IS NOT NULL))),
     ADD CONSTRAINT draft_brief_finalization_none_names_no_reference CHECK (((finalization_kind <> 'None'::text) OR (finalization_target IS NULL))),
     ADD CONSTRAINT draft_brief_finalization_is_whole CHECK ((NOT ((finalization_kind = 'PullRequest'::text) OR (finalization_mode IS NOT DISTINCT FROM 'PullRequestMerge'::text))) OR ((branch IS NOT NULL) AND ((finalization_target IS NULL) OR (branch <> finalization_target))))`,
];

const projectRepositoryStatements: readonly string[] = [
  `CREATE OR REPLACE FUNCTION public.project_repository_is_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$ BEGIN
     IF TG_OP='UPDATE'
        AND to_jsonb(NEW)-'landing_kind'-'landing_mode'-'landing_policy'-'pipelines_writable'-'retired_at'
          = to_jsonb(OLD)-'landing_kind'-'landing_mode'-'landing_policy'-'pipelines_writable'-'retired_at'
       THEN RETURN NEW; END IF;
     RAISE EXCEPTION 'repository bindings are immutable but for their landing, their pipeline definitions and their retirement'
       USING ERRCODE='integrity_constraint_violation'; END $$`,
  `ALTER TABLE public.project_repository
     DROP CONSTRAINT project_repository_landing_mode_is_known,
     ALTER COLUMN landing_mode DROP NOT NULL,
     ALTER COLUMN landing_mode DROP DEFAULT,
     ADD COLUMN landing_kind text DEFAULT 'PullRequest'::text NOT NULL,
     ADD COLUMN landing_policy text`,
  `UPDATE public.project_repository
      SET landing_kind=${migration129KindOf("landing_mode")},
          landing_policy=${migration129PolicyOf("landing_mode", "NULL")},
          landing_mode=${migration129ModeOf("landing_mode")}`,
  `ALTER TABLE public.project_repository
     ADD CONSTRAINT project_repository_landing_kind_is_known CHECK ((landing_kind = ANY (ARRAY['GitMerge'::text, 'PullRequest'::text, 'None'::text]))),
     ADD CONSTRAINT project_repository_landing_mode_is_known CHECK ((landing_mode = ANY (ARRAY['Push'::text, 'PullRequestMerge'::text]))),
     ADD CONSTRAINT project_repository_landing_policy_is_known CHECK ((landing_policy = ANY (ARRAY['Direct'::text, 'Serialized'::text]))),
     ADD CONSTRAINT project_repository_landing_is_by_kind CHECK (((landing_kind = 'GitMerge'::text) = (landing_mode IS NOT NULL)) AND ((landing_kind = 'GitMerge'::text) = (landing_policy IS NOT NULL)))`,
  `GRANT UPDATE(landing_kind, landing_policy) ON TABLE public.project_repository TO ${boundaryOwnerRole}`,
];

const bindingDoorStatements: readonly string[] = [
  `DROP FUNCTION ${list}`,
  `CREATE FUNCTION ${list} RETURNS TABLE(${bindingColumns})
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     SELECT b.repository,b.bound_at,b.landing_kind,b.landing_mode,b.landing_policy,
            b.pipelines_writable,b.retired_at
       FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
      ORDER BY b.bound_at,b.repository
      LIMIT least(coalesce(in_max,200),
                  200)
     $$`,
  ...migration129Owned(list, [apiRole, schedulerRole], "ALL"),
  `DROP FUNCTION ${read}`,
  `CREATE FUNCTION ${read} RETURNS TABLE(${bindingColumns})
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     SELECT b.repository,b.bound_at,b.landing_kind,b.landing_mode,b.landing_policy,
            b.pipelines_writable,b.retired_at
       FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project AND b.repository=in_repository
     $$`,
  ...migration129Owned(read, [apiRole, workerPlaneRole, finalizerRole], "ALL"),
  `DROP FUNCTION ${retire}`,
  `CREATE FUNCTION ${retire} RETURNS TABLE(outcome text, ${bindingColumns})
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE standing project_repository%ROWTYPE;
   BEGIN
     SELECT * INTO standing FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository FOR UPDATE;
     IF NOT FOUND THEN
       RETURN QUERY SELECT 'NotBound',NULL::text,NULL::timestamptz,
         NULL::text,NULL::text,NULL::text,NULL::boolean,NULL::timestamptz; RETURN;
     END IF;
     IF standing.retired_at IS NULL THEN
       UPDATE project_repository b SET retired_at=now()
        WHERE b.tenant=in_tenant AND b.project=in_project
          AND b.repository=in_repository
        RETURNING b.retired_at INTO standing.retired_at;
     END IF;
     RETURN QUERY SELECT 'Retired',standing.repository,standing.bound_at,
       standing.landing_kind,standing.landing_mode,standing.landing_policy,
       standing.pipelines_writable,standing.retired_at;
   END $$`,
  ...migration129Owned(retire, [apiRole], "ALL"),
  `DROP FUNCTION ${setOld}`,
  `CREATE FUNCTION ${set} RETURNS TABLE(outcome text, ${bindingColumns})
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE standing project_repository%ROWTYPE;
   BEGIN
     SELECT * INTO standing FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository FOR UPDATE;
     IF NOT FOUND THEN
       RETURN QUERY SELECT 'NotBound',NULL::text,NULL::timestamptz,
         NULL::text,NULL::text,NULL::text,NULL::boolean,NULL::timestamptz; RETURN;
     END IF;
     IF ((standing.landing_kind,standing.landing_mode,standing.landing_policy)
           IS DISTINCT FROM (in_expected_kind,in_expected_mode,in_expected_policy)
         AND (standing.landing_kind,standing.landing_mode,standing.landing_policy)
           IS DISTINCT FROM (in_kind,in_mode,in_policy))
        OR (standing.pipelines_writable<>in_expected_pipelines_writable
            AND standing.pipelines_writable<>in_pipelines_writable) THEN
       RETURN QUERY SELECT 'LandingMoved',standing.repository,standing.bound_at,
         standing.landing_kind,standing.landing_mode,standing.landing_policy,
         standing.pipelines_writable,standing.retired_at; RETURN;
     END IF;
     UPDATE project_repository b
        SET landing_kind=in_kind,landing_mode=in_mode,landing_policy=in_policy,
            pipelines_writable=in_pipelines_writable
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository;
     RETURN QUERY SELECT 'Written',standing.repository,standing.bound_at,
       in_kind,in_mode,in_policy,in_pipelines_writable,standing.retired_at;
   END $$`,
  ...migration129Owned(set, [apiRole], "ALL"),
];

const draftDoorStatements: readonly string[] = [
  `DROP FUNCTION ${inEpicOld}`,
  `DROP FUNCTION ${createDraftOld}`,
  `CREATE FUNCTION public.${draftCreateFunction}(${draftParameters}, in_finalization_kind text DEFAULT NULL, in_finalization_policy text DEFAULT NULL) RETURNS TABLE(result text, ticket bigint, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE minted bigint; kind text; mode text; policy text; target text;
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project
            AND revision=in_configuration AND digest=in_configuration_digest)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       IF in_repository IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_repository
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository
              AND retired_at IS NULL)
         THEN RETURN QUERY SELECT 'RepositoryNotBound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;${draftResolved}
       IF ${draftProposes} AND in_branch IS NULL THEN
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
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_kind,finalization_mode,finalization_target,finalization_policy,repository)
         VALUES (in_tenant,in_project,minted,in_title,in_intent,in_branch,kind,mode,target,policy,in_repository);
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
  ...migration129Owned(createDraft, [apiRole]),
  `CREATE FUNCTION ${inEpic}
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
           RETURN QUERY SELECT d.result, d.ticket FROM ${draftCreateFunction}(${inEpicForwarded}) d;
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
         IF cardinality(members) > ${String(epicTicketsMaxAt122)} THEN
           RETURN QUERY SELECT 'ManyTickets', NULL::bigint;
           RETURN;
         END IF;
         IF octet_length('{"description":' || to_json(found_epic.description)::text
              || CASE WHEN found_epic.summary IS NULL THEN '' ELSE ',"summary":' || to_json(found_epic.summary)::text END
              || ',"tickets":[' || array_to_string(members, ',')
              || '],"title":' || to_json(found_epic.title)::text
              || ',"visibility":' || to_json(found_epic.visibility)::text || '}')
            > ${String(epicContentBytesMaxAt122)} THEN
           RETURN QUERY SELECT 'LargeContent', NULL::bigint;
           RETURN;
         END IF;
         SELECT d.result, d.ticket INTO created_result, created_ticket
           FROM ${draftCreateFunction}(${inEpicForwarded}) d;
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
  ...migration129Owned(inEpic, [apiRole]),
  `DROP FUNCTION ${reviseDraftOld}`,
  `CREATE FUNCTION public.revise_draft(${reviseParameters}, in_finalization_kind text DEFAULT NULL, in_finalization_policy text DEFAULT NULL) RETURNS TABLE(result text, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE; next_version bigint; kind text; mode text; policy text;
       target text; phase text;
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
         THEN RETURN QUERY SELECT 'RepositoryNotBound',current.authoring_version,current.state; RETURN; END IF;${draftResolved}
       IF ${draftProposes} AND in_branch IS NULL THEN
         RETURN QUERY SELECT 'LandingUnbranched',current.authoring_version,current.state; RETURN;
       END IF;
       next_version := current.authoring_version+1;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,overrides,selection,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_ticket,next_version,in_configuration,in_authoring,in_overrides::jsonb,in_selection::jsonb,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_kind,finalization_mode,finalization_target,finalization_policy,repository)
         VALUES (in_tenant,in_project,in_ticket,in_title,in_intent,in_branch,kind,mode,target,policy,in_repository)
         ON CONFLICT (tenant,project,ticket) DO UPDATE SET title=EXCLUDED.title,intent=EXCLUDED.intent,
           branch=EXCLUDED.branch,repository=EXCLUDED.repository,
           finalization_kind=EXCLUDED.finalization_kind,finalization_mode=EXCLUDED.finalization_mode,
           finalization_target=EXCLUDED.finalization_target,finalization_policy=EXCLUDED.finalization_policy;
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
  ...migration129Owned(reviseDraft, [apiRole]),
  `DROP FUNCTION ${readProjectDrafts}`,
  `CREATE FUNCTION ${readProjectDrafts} RETURNS TABLE(ticket bigint, authoring_version bigint, state text, configuration_revision text, authoring text, title text, intent text, branch text, repository text, finalization_kind text, finalization_mode text, finalization_target text, finalization_policy text, links text[], images text[], checks text[], version_name text, version_number bigint, overrides text, selection text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT d.ticket,d.authoring_version,d.state,d.configuration_revision,
              r.authoring,b.title,b.intent,b.branch,b.repository,
              b.finalization_kind,b.finalization_mode,b.finalization_target,b.finalization_policy,
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
  ...migration129Owned(readProjectDrafts, [apiRole]),
];

/** The released brief's finalization mode, which a release stores by mode. */
const releasedMode = "brief->'finalization'->>'mode'";

const moveStatement = `CREATE OR REPLACE FUNCTION ${move}
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
             brief->>'title', brief->>'intent', ${migration129BriefArray("links")},
             ${migration129BriefArray("images")}, ${migration129BriefArray("checks")}, brief->>'branch',
             ${migration129ModeOf(releasedMode)}, brief->'finalization'->>'target',
             brief->>'repository', held.overrides, held.selection, 'Service',
             in_authority_subject, ${migration129KindOf(releasedMode)},
             ${migration129PolicyOf(releasedMode, "brief->>'landing'")});
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
     $$`;

export const migration129: Migration = {
  version: 129,
  name: "a brief and a repository's landing default store a finalization by its kind",
  statements: [
    ...draftBriefStatements,
    ...projectRepositoryStatements,
    ...bindingDoorStatements,
    ...draftDoorStatements,
    moveStatement,
  ],
};
