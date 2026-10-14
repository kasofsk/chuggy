import { repositoryBindingWriteFunction, type Migration } from "../shared.ts";

/**
 * A retired binding releases its repository. The schema holds at most one LIVE
 * binding per repository, so one a project retired may be bound by another
 * project, in its tenant or another. The retired row stays, because the
 * tickets, drafts, landings and actions that name it reference it by its whole
 * key.
 *
 * The bind door is replaced to ask the same: a live binding in another project
 * answers `RepositoryBoundElsewhere`, and a binding this project retired is
 * reinstated only while no other project holds the repository live.
 */
export const migration052: Migration = {
  version: 52,
  name: "a retired binding releases its repository",
  statements: [
    `ALTER TABLE public.project_repository DROP CONSTRAINT project_repository_is_exclusive`,
    `CREATE UNIQUE INDEX project_repository_one_live ON public.project_repository USING btree (repository) WHERE (retired_at IS NULL)`,
    `CREATE OR REPLACE FUNCTION public.${repositoryBindingWriteFunction}(in_tenant text, in_project text, in_repository text, in_recovery_epoch text, in_operation text, in_authority_kind text, in_authority_subject text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE existing project_repository_bind_operation%ROWTYPE;
           standing project_repository%ROWTYPE;
           current_epoch text;
           accepted text;
   BEGIN
     PERFORM pg_advisory_xact_lock(hashtextextended('operation:'||in_operation,0));
     SELECT * INTO existing FROM project_repository_bind_operation
      WHERE operation=in_operation;
     IF FOUND THEN
       IF existing.tenant=in_tenant AND existing.project=in_project
          AND existing.repository=in_repository
          AND existing.recovery_epoch=in_recovery_epoch
          AND existing.authority_kind=in_authority_kind
          AND existing.authority_subject=in_authority_subject
         THEN RETURN 'AlreadyBound'; END IF;
       RETURN 'OperationConflict';
     END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended('repository:'||in_repository,0));
     PERFORM 1 FROM project WHERE tenant=in_tenant AND project=in_project FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='foreign_key_violation',
       MESSAGE='repository binding project is absent'; END IF;
     SELECT epoch INTO current_epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1;
     IF current_epoch IS DISTINCT FROM in_recovery_epoch
       THEN RETURN 'RecoveryEpochMismatch'; END IF;
     PERFORM 1 FROM project_repository b
      WHERE b.repository=in_repository AND b.retired_at IS NULL
        AND (b.tenant<>in_tenant OR b.project<>in_project);
     IF FOUND THEN RETURN 'RepositoryBoundElsewhere'; END IF;
     SELECT * INTO standing FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository;
     IF NOT FOUND THEN
       INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
         VALUES(in_tenant,in_project,in_repository,in_recovery_epoch);
       accepted := 'Bound';
     ELSIF standing.retired_at IS NULL THEN
       accepted := 'AlreadyBound';
     ELSE
       UPDATE project_repository b SET retired_at=NULL
        WHERE b.tenant=in_tenant AND b.project=in_project
          AND b.repository=in_repository;
       accepted := 'Bound';
     END IF;
     INSERT INTO project_repository_bind_operation
       (operation,tenant,project,repository,recovery_epoch,
        authority_kind,authority_subject,outcome)
       VALUES(in_operation,in_tenant,in_project,in_repository,in_recovery_epoch,
              in_authority_kind,in_authority_subject,accepted);
     RETURN accepted;
   END $$`,
  ],
};
