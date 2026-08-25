import { artifactDigestChars } from "../../../../interpreter/resultManifest.ts";
import {
  finalizerIdentityCharsMax,
  gitObjectIdPattern,
  gitRefNameCharsMax,
} from "../../../../interpreter/finalizer.ts";
import {
  handoffOutputBytesMaxLimit,
  handoffPathCharsMax,
} from "../../../../interpreter/handoffConfiguration.ts";
import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  repositoryBindingReadFunction,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

export const migration025: Migration = {
  version: 25,
  name: "durable cross repository finalization",
  statements: [
    `ALTER TABLE project_repository DROP CONSTRAINT project_repository_pkey,
       DROP CONSTRAINT project_repository_is_exclusive,
       ADD CONSTRAINT project_repository_pkey PRIMARY KEY (tenant, project, repository)`,
    `CREATE OR REPLACE FUNCTION ${repositoryBindingReadFunction}(in_tenant text,in_project text)
       RETURNS TABLE(repository text,recovery_epoch text)
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT b.repository,b.recovery_epoch FROM project_repository b
        WHERE b.tenant=in_tenant AND b.project=in_project
        ORDER BY b.bound_at,b.repository LIMIT 1
       $$`,
    `CREATE TABLE finalization_request_configuration (
       tenant                    text NOT NULL,
       project                   text NOT NULL,
       request                   text NOT NULL,
       kind                      text NOT NULL,
       configuration_revision    text NOT NULL,
       configuration_digest      text NOT NULL,
       repository                text NOT NULL,
       target_ref                text NOT NULL,
       credential_reference      text NOT NULL,
       accepted_work_repository  text,
       accepted_work_commit      text,
       destination_path          text,
       output                    text,
       request_digest            text,
       PRIMARY KEY (tenant, project, request),
       CONSTRAINT finalization_request_configuration_has_request
         FOREIGN KEY (tenant, project, request)
         REFERENCES finalization_request (tenant, project, request),
       CONSTRAINT finalization_request_configuration_is_pinned
         FOREIGN KEY (tenant, project, configuration_revision, configuration_digest)
         REFERENCES configuration_revision (tenant, project, revision, digest),
       CONSTRAINT finalization_request_configuration_kind_is_known CHECK (
         kind IN ('PromoteForHandoff', 'PublishHandoff')),
       CONSTRAINT finalization_request_configuration_is_whole CHECK (
         (kind = 'PublishHandoff') = (accepted_work_repository IS NOT NULL)
         AND (kind = 'PublishHandoff') = (accepted_work_commit IS NOT NULL)
         AND (kind = 'PublishHandoff') = (destination_path IS NOT NULL)
         AND (kind = 'PublishHandoff') = (output IS NOT NULL)
         AND (kind = 'PublishHandoff') = (request_digest IS NOT NULL)),
       CONSTRAINT finalization_request_configuration_commit_is_object_id CHECK (
         accepted_work_commit IS NULL OR accepted_work_commit ~ '${gitObjectIdPattern()}'),
       CONSTRAINT finalization_request_configuration_digest_is_hex CHECK (
         configuration_digest ~ '^[0-9a-f]{${artifactDigestChars}}$'
         AND (request_digest IS NULL OR request_digest ~ '^[0-9a-f]{${artifactDigestChars}}$')),
       CONSTRAINT finalization_request_configuration_text_is_bounded CHECK (
         length(repository) BETWEEN 1 AND ${finalizerIdentityCharsMax}
         AND length(target_ref) BETWEEN 1 AND ${gitRefNameCharsMax}
         AND length(credential_reference) BETWEEN 1 AND ${finalizerIdentityCharsMax}
         AND coalesce(length(accepted_work_repository), 1) BETWEEN 1 AND ${finalizerIdentityCharsMax}
         AND coalesce(length(destination_path), 1) BETWEEN 1 AND ${handoffPathCharsMax}),
       CONSTRAINT finalization_request_configuration_output_is_bounded CHECK (
         output IS NULL OR octet_length(output) BETWEEN 1 AND ${handoffOutputBytesMaxLimit})
     )`,
    `CREATE FUNCTION read_accepted_handoff_promotion(
       in_tenant text,in_project text,in_ticket bigint)
       RETURNS TABLE(repository text,candidate_commit text,
         configuration_revision text,configuration_digest text)
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT a.repository,a.candidate_commit,a.configuration_revision,a.configuration_digest
         FROM finalization_request f
         JOIN finalization_attempt a
           ON a.tenant=f.tenant AND a.project=f.project AND a.request=f.request
         JOIN commit_permit p
           ON p.tenant=a.tenant AND p.project=a.project AND p.attempt=a.attempt
         JOIN finalization_reconciliation r
           ON r.tenant=p.tenant AND r.project=p.project AND r.permit=p.permit
        WHERE f.tenant=in_tenant AND f.project=in_project AND f.ticket=in_ticket
          AND f.kind='PromoteForHandoff' AND p.state='Concluded'
          AND r.verdict='Promoted'
        ORDER BY f.authorizing_seq DESC,a.prepared_at DESC LIMIT 1
       $$`,
    `ALTER FUNCTION read_accepted_handoff_promotion(text,text,bigint)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION read_accepted_handoff_promotion(text,text,bigint) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION read_accepted_handoff_promotion(text,text,bigint)
       TO ${ticketServiceRole}`,
    `CREATE FUNCTION finalization_request_configuration_is_written_once()
       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
         RAISE EXCEPTION 'finalization request configuration is immutable'
           USING ERRCODE = 'integrity_constraint_violation';
       END $$`,
    `ALTER FUNCTION finalization_request_configuration_is_written_once()
       OWNER TO ${boundaryOwnerRole}`,
    `CREATE TRIGGER finalization_request_configuration_is_written_once
       BEFORE UPDATE OR DELETE ON finalization_request_configuration
       FOR EACH ROW EXECUTE FUNCTION finalization_request_configuration_is_written_once()`,
    `REVOKE ALL ON finalization_request_configuration
       FROM ${apiRole}, ${ticketServiceRole}, ${selectorServiceRole}, ${schedulerRole}`,
    `GRANT INSERT ON finalization_request_configuration TO ${ticketServiceRole}`,
    `GRANT SELECT ON finalization_request_configuration TO ${finalizerRole}`,
  ],
};
