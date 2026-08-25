import {
  boundaryOwnerRole,
  finalizerRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";
import {
  buildHandoffOutputBytesMax,
  buildHandoffOutputsMax,
} from "../../../../interpreter/buildHandoffConfiguration.ts";
import { handoffPathCharsMax } from "../../../../interpreter/handoffConfiguration.ts";

export const migration029: Migration = {
  version: 29,
  name: "bounded handoff output sets",
  statements: [
    `ALTER TABLE finalization_request_configuration
       ADD COLUMN source_repository text,
       ADD COLUMN source_commit text,
       DROP CONSTRAINT finalization_request_configuration_kind_is_known,
       ADD CONSTRAINT finalization_request_configuration_kind_is_known CHECK (
         kind IN ('RunFinalizer','PromoteForHandoff','PublishHandoff')),
       DROP CONSTRAINT finalization_request_configuration_is_whole,
       ADD CONSTRAINT finalization_request_configuration_is_whole CHECK (
         (kind = 'PublishHandoff') = (accepted_work_repository IS NOT NULL)
         AND (kind = 'PublishHandoff') = (accepted_work_commit IS NOT NULL)
         AND (kind IN ('RunFinalizer','PublishHandoff')) = (request_digest IS NOT NULL)
         AND (kind = 'RunFinalizer') = (source_repository IS NOT NULL)
         AND (kind = 'RunFinalizer') = (source_commit IS NOT NULL)
         AND (destination_path IS NULL) = (output IS NULL)
         AND (kind = 'PublishHandoff' OR destination_path IS NULL)),
       ADD CONSTRAINT finalization_request_configuration_source_is_bounded CHECK
         (source_repository IS NULL OR length(source_repository) BETWEEN 1 AND 256),
       ADD CONSTRAINT finalization_request_configuration_source_is_object_id CHECK
         (source_commit IS NULL OR source_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$')`,
    `CREATE TABLE finalization_request_output (
       tenant   text NOT NULL,
       project  text NOT NULL,
       request  text NOT NULL,
       ordinal  integer NOT NULL,
       path     text NOT NULL,
       content  text NOT NULL,
       PRIMARY KEY (tenant,project,request,ordinal),
       CONSTRAINT finalization_request_output_has_configuration FOREIGN KEY
         (tenant,project,request) REFERENCES finalization_request_configuration,
       CONSTRAINT finalization_request_output_ordinal_is_bounded CHECK
         (ordinal BETWEEN 0 AND ${buildHandoffOutputsMax - 1}),
       CONSTRAINT finalization_request_output_path_is_bounded CHECK
         (length(path) BETWEEN 1 AND ${handoffPathCharsMax}),
       CONSTRAINT finalization_request_output_content_is_bounded CHECK
         (octet_length(content) BETWEEN 1 AND ${buildHandoffOutputBytesMax}),
       CONSTRAINT finalization_request_output_path_is_unique
         UNIQUE (tenant,project,request,path))`,
    `CREATE TRIGGER finalization_request_output_is_written_once
       BEFORE UPDATE OR DELETE ON finalization_request_output
       FOR EACH ROW EXECUTE FUNCTION finalization_request_configuration_is_written_once()`,
    `GRANT SELECT,INSERT ON finalization_request_output TO ${boundaryOwnerRole}`,
    `GRANT INSERT ON finalization_request_output TO ${ticketServiceRole}`,
    `GRANT SELECT ON finalization_request_output TO ${finalizerRole}`,
  ],
};
