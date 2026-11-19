/**
 * A project's connectors and the history of their changes.
 *
 * A CONNECTOR IS ONE ROW, keyed in its project by its name, holding its kind,
 * its settings and a revision that counts from one. Its doors are the boundary
 * owner's and the API's to call, the read of one the worker plane's too. A
 * write is fenced on the revision its writer read: a create names none and
 * finds no row, a replace or a removal names the one that stands, and any
 * other answers the revision that stands and changes nothing. Writes to one
 * project's connectors are taken one at a time under a lock of that project,
 * so its bound is counted against the rows that stand.
 *
 * EVERY CREATE, REPLACE AND REMOVAL APPENDS ONE CHANGE in its own transaction:
 * the authority, the instant, the name, what happened, and the kind and
 * settings it left, none for a removal. `project_creation_is_immutable`
 * refuses every update and every delete of a change but the project's own
 * deletion.
 *
 * `delete_unrun_project` IS REPLACED by 211's with both relations among those
 * it empties, `projectDeletionRelationsAt215`.
 */

import {
  apiRole,
  boundaryOwnerRole,
  connectorChangesListFunction,
  connectorListFunction,
  connectorReadFunction,
  connectorRemoveFunction,
  connectorWriteFunction,
  projectDeleteFunction,
  projectDeletionHoldsFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";
import { projectDeletionRelationsAt211 } from "./211-access-tokens.ts";

/** Every relation keyed by a project that its deletion empties, children before the relations they point at. */
export const projectDeletionRelationsAt215 = [
  "project_connector_change",
  "project_connector",
  ...projectDeletionRelationsAt211,
] as const;

const read = `public.${connectorReadFunction}(in_tenant text, in_project text, in_name text)`;
const list = `public.${connectorListFunction}(in_tenant text, in_project text)`;
const write = `public.${connectorWriteFunction}(in_tenant text, in_project text, in_name text, in_kind text, in_settings jsonb, in_expected_revision bigint, in_authority_kind text, in_authority_subject text)`;
const remove = `public.${connectorRemoveFunction}(in_tenant text, in_project text, in_name text, in_expected_revision bigint, in_authority_kind text, in_authority_subject text)`;
const changes = `public.${connectorChangesListFunction}(in_tenant text, in_project text, in_before bigint, in_max bigint)`;
const projectDelete = `public.${projectDeleteFunction}(in_tenant text, in_project text)`;

/** The statements that own one door and grant it to exactly the roles named. */
function migration215Owned(
  signature: string,
  roles: readonly string[],
): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...roles.map((role) => `GRANT ALL ON FUNCTION ${signature} TO ${role}`),
  ];
}

const kindIsKnown = `kind IN ('Aws','Gcp','Azure','Anthropic')`;

/** The lock every write to one project's connectors is taken under. */
const projectLocked = `PERFORM pg_advisory_xact_lock(hashtextextended(
         'project-connector:' || in_tenant || '/' || in_project, 0));`;

const tableStatements: readonly string[] = [
  `CREATE TABLE public.project_connector (
     tenant text NOT NULL,
     project text NOT NULL,
     name text NOT NULL
       CONSTRAINT project_connector_name_is_a_name
       CHECK (name ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' AND length(name) <= 40),
     kind text NOT NULL
       CONSTRAINT project_connector_kind_is_known CHECK (${kindIsKnown}),
     settings jsonb NOT NULL
       CONSTRAINT project_connector_settings_is_an_object
       CHECK (jsonb_typeof(settings) = 'object'),
     revision bigint NOT NULL
       CONSTRAINT project_connector_revision_is_positive CHECK (revision >= 1),
     CONSTRAINT project_connector_pkey PRIMARY KEY (tenant, project, name),
     CONSTRAINT project_connector_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project))`,
  `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.project_connector TO ${boundaryOwnerRole}`,
  `CREATE TABLE public.project_connector_change (
     tenant text NOT NULL,
     project text NOT NULL,
     change bigint GENERATED ALWAYS AS IDENTITY,
     changed_at timestamptz NOT NULL DEFAULT now(),
     authority_kind text NOT NULL
       CONSTRAINT project_connector_change_authority_kind_is_bounded
       CHECK (length(authority_kind) BETWEEN 1 AND 256),
     authority_subject text NOT NULL
       CONSTRAINT project_connector_change_authority_subject_is_bounded
       CHECK (length(authority_subject) BETWEEN 1 AND 256),
     name text NOT NULL,
     action text NOT NULL
       CONSTRAINT project_connector_change_action_is_known
       CHECK (action IN ('Created','Changed','Removed')),
     kind text
       CONSTRAINT project_connector_change_kind_is_known CHECK (${kindIsKnown}),
     settings jsonb
       CONSTRAINT project_connector_change_settings_is_an_object
       CHECK (jsonb_typeof(settings) = 'object'),
     CONSTRAINT project_connector_change_pkey PRIMARY KEY (tenant, project, change),
     CONSTRAINT project_connector_change_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project),
     CONSTRAINT project_connector_change_holds_what_it_left
       CHECK ((action = 'Removed') = (kind IS NULL)
          AND (kind IS NULL) = (settings IS NULL)))`,
  `CREATE TRIGGER project_connector_change_is_immutable
     BEFORE DELETE OR UPDATE ON public.project_connector_change
     FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
  `GRANT SELECT,INSERT,DELETE ON TABLE public.project_connector_change TO ${boundaryOwnerRole}`,
];

const readStatements: readonly string[] = [
  `CREATE FUNCTION ${read}
     RETURNS TABLE(name text, kind text, settings jsonb, revision bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT c.name, c.kind, c.settings, c.revision
         FROM project_connector c
        WHERE c.tenant=in_tenant AND c.project=in_project AND c.name=in_name
     $$`,
  ...migration215Owned(read, [apiRole, workerPlaneRole]),
  `CREATE FUNCTION ${list}
     RETURNS TABLE(name text, kind text, settings jsonb, revision bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT c.name, c.kind, c.settings, c.revision
         FROM project_connector c
        WHERE c.tenant=in_tenant AND c.project=in_project
        ORDER BY c.name COLLATE "C"
        LIMIT 32
     $$`,
  ...migration215Owned(list, [apiRole]),
  `CREATE FUNCTION ${changes}
     RETURNS TABLE(change bigint, changed_at timestamptz, authority_kind text,
                   authority_subject text, name text, action text, kind text,
                   settings jsonb)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT h.change, h.changed_at, h.authority_kind, h.authority_subject,
              h.name, h.action, h.kind, h.settings
         FROM project_connector_change h
        WHERE h.tenant=in_tenant AND h.project=in_project
          AND (in_before IS NULL OR h.change < in_before)
        ORDER BY h.change DESC
        LIMIT least(coalesce(in_max, 100), 100)
     $$`,
  ...migration215Owned(changes, [apiRole]),
];

const writeStatements: readonly string[] = [
  `CREATE FUNCTION ${write}
     RETURNS TABLE(outcome text, connector_revision bigint)
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
     DECLARE standing bigint;
     BEGIN
       PERFORM 1 FROM project p
        WHERE p.tenant=in_tenant AND p.project=in_project FOR KEY SHARE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'ProjectAbsent'::text, NULL::bigint; RETURN;
       END IF;
       ${projectLocked}
       SELECT c.revision INTO standing FROM project_connector c
        WHERE c.tenant=in_tenant AND c.project=in_project AND c.name=in_name;
       IF in_expected_revision IS DISTINCT FROM standing THEN
         RETURN QUERY SELECT 'Stale'::text, standing; RETURN;
       END IF;
       IF standing IS NULL THEN
         IF (SELECT count(*) FROM project_connector c
              WHERE c.tenant=in_tenant AND c.project=in_project) >= 32 THEN
           RETURN QUERY SELECT 'LimitReached'::text, NULL::bigint; RETURN;
         END IF;
         INSERT INTO project_connector(tenant,project,name,kind,settings,revision)
           VALUES(in_tenant,in_project,in_name,in_kind,in_settings,1);
         INSERT INTO project_connector_change(tenant,project,authority_kind,
             authority_subject,name,action,kind,settings)
           VALUES(in_tenant,in_project,in_authority_kind,in_authority_subject,
             in_name,'Created',in_kind,in_settings);
         RETURN QUERY SELECT 'Created'::text, 1::bigint; RETURN;
       END IF;
       UPDATE project_connector c
          SET kind=in_kind, settings=in_settings, revision=standing+1
        WHERE c.tenant=in_tenant AND c.project=in_project AND c.name=in_name;
       INSERT INTO project_connector_change(tenant,project,authority_kind,
           authority_subject,name,action,kind,settings)
         VALUES(in_tenant,in_project,in_authority_kind,in_authority_subject,
           in_name,'Changed',in_kind,in_settings);
       RETURN QUERY SELECT 'Changed'::text, standing+1;
     END $$`,
  ...migration215Owned(write, [apiRole]),
  `CREATE FUNCTION ${remove}
     RETURNS TABLE(outcome text, connector_revision bigint)
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
     DECLARE standing bigint;
     BEGIN
       ${projectLocked}
       SELECT c.revision INTO standing FROM project_connector c
        WHERE c.tenant=in_tenant AND c.project=in_project AND c.name=in_name;
       IF standing IS NULL OR in_expected_revision IS DISTINCT FROM standing THEN
         RETURN QUERY SELECT 'Stale'::text, standing; RETURN;
       END IF;
       DELETE FROM project_connector c
        WHERE c.tenant=in_tenant AND c.project=in_project AND c.name=in_name;
       INSERT INTO project_connector_change(tenant,project,authority_kind,
           authority_subject,name,action)
         VALUES(in_tenant,in_project,in_authority_kind,in_authority_subject,
           in_name,'Removed');
       RETURN QUERY SELECT 'Removed'::text, standing;
     END $$`,
  ...migration215Owned(remove, [apiRole]),
];

const projectDeletion = `CREATE OR REPLACE FUNCTION ${projectDelete} RETURNS TABLE(outcome text, held text[])
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE holdings text[];
         BEGIN
           PERFORM 1 FROM public.project p
             WHERE p.tenant=in_tenant AND p.project=in_project FOR UPDATE;
           IF NOT FOUND THEN
             RETURN QUERY SELECT 'NotFound'::text, ARRAY[]::text[];
             RETURN;
           END IF;
           holdings := public.${projectDeletionHoldsFunction}(in_tenant, in_project);
           IF cardinality(holdings) > 0 THEN
             RETURN QUERY SELECT 'Held'::text, holdings;
             RETURN;
           END IF;
           UPDATE public.project p SET lifecycle='Deleting'
            WHERE p.tenant=in_tenant AND p.project=in_project;
           DELETE FROM public.project_creation_grant g WHERE g.operation IN (
             SELECT o.operation FROM public.project_creation_operation o
              WHERE o.tenant=in_tenant AND o.project=in_project);
           ${projectDeletionRelationsAt215
             .map(
               (relation) =>
                 `DELETE FROM public.${relation} d WHERE d.tenant=in_tenant AND d.project=in_project;`,
             )
             .join("\n           ")}
           DELETE FROM public.invite_link l WHERE l.tenant=in_tenant
              AND l.projects @> jsonb_build_array(jsonb_build_object('project', in_project));
           DELETE FROM public.project p WHERE p.tenant=in_tenant AND p.project=in_project;
           INSERT INTO public.project_vacancy(tenant,project) VALUES(in_tenant,in_project)
             ON CONFLICT DO NOTHING;
           DELETE FROM public.capacity_account c
            WHERE c.account=public.project_capacity_account(in_tenant, in_project);
           RETURN QUERY SELECT 'Deleted'::text, ARRAY[]::text[];
         END $$`;

export const migration215: Migration = {
  version: 215,
  name: "a project's connectors and the history of their changes",
  statements: [
    ...tableStatements,
    ...readStatements,
    ...writeStatements,
    projectDeletion,
    `ALTER FUNCTION ${projectDelete} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${projectDelete} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${projectDelete} TO ${apiRole}`,
  ],
};
