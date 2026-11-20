/**
 * A project's access tokens, each kept as the digest of its secret.
 *
 * A ROW IS ONE TOKEN, keyed in its project by an identity the API draws and
 * named once per maker there. Its expiry is after its making and no further
 * on than `accessTokenLifetimeDaysMax` allows, and it records the newest
 * recovery epoch at its making, so a token older than a restore can be told
 * from one made since. The API alone reads, inserts and deletes it; of the
 * boundary owner, only the project's deletion does.
 *
 * `delete_unrun_project` IS REPLACED by 205's with `access_token` among the
 * relations it empties, `projectDeletionRelationsAt211`.
 */

import {
  apiRole,
  boundaryOwnerRole,
  projectDeleteFunction,
  projectDeletionHoldsFunction,
  type Migration,
} from "../shared.ts";
import { projectDeletionRelationsAt205 } from "./205-selector-retired.ts";

/** Every relation keyed by a project that its deletion empties, children before the relations they point at. */
export const projectDeletionRelationsAt211 = [
  "access_token",
  ...projectDeletionRelationsAt205,
] as const;

const projectDelete = `public.${projectDeleteFunction}(in_tenant text, in_project text)`;

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
           ${projectDeletionRelationsAt211
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

export const migration211: Migration = {
  version: 211,
  name: "a project's access tokens",
  statements: [
    `CREATE TABLE public.access_token (
       tenant text NOT NULL,
       project text NOT NULL,
       token text NOT NULL,
       name text NOT NULL,
       access text NOT NULL
         CONSTRAINT access_token_access_is_known
         CHECK (access IN ('Read','Write')),
       maker text NOT NULL,
       secret_digest text NOT NULL
         CONSTRAINT access_token_secret_digest_is_unique UNIQUE
         CONSTRAINT access_token_secret_digest_is_hex
         CHECK (secret_digest ~ '^[0-9a-f]{64}$'),
       created_at timestamptz NOT NULL DEFAULT now(),
       expires_at timestamptz NOT NULL,
       recovery_epoch text NOT NULL
         CONSTRAINT access_token_recovery_epoch_fkey
         REFERENCES public.recovery_epoch(epoch),
       CONSTRAINT access_token_pkey PRIMARY KEY (tenant, project, token),
       CONSTRAINT access_token_belongs_to_project
         FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project),
       CONSTRAINT access_token_name_is_the_makers_once
         UNIQUE (tenant, project, maker, name),
       CONSTRAINT access_token_expires_within_its_lifetime
         CHECK (expires_at > created_at
           AND expires_at <= created_at + interval '366 days'))`,
    `CREATE INDEX access_token_by_maker ON public.access_token(tenant, project, maker)`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.access_token TO ${apiRole}`,
    `GRANT SELECT,DELETE ON TABLE public.access_token TO ${boundaryOwnerRole}`,
    projectDeletion,
    `ALTER FUNCTION ${projectDelete} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${projectDelete} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${projectDelete} TO ${apiRole}`,
  ],
};
