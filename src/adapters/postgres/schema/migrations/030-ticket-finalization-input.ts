import {
  boundaryOwnerRole,
  finalizerRole,
  schedulerRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";
import { artifactDigestChars } from "../../../../interpreter/resultManifest.ts";
import {
  finalizerIdentityCharsMax,
  gitObjectIdPattern,
  gitRefNameCharsMax,
} from "../../../../interpreter/finalizer.ts";

export const migration030: Migration = {
  version: 30,
  name: "immutable ticket finalization input",
  statements: [
    `CREATE TABLE ticket_finalization_input (
       tenant                 text NOT NULL,
       project                text NOT NULL,
       ticket                 bigint NOT NULL,
       configuration_revision text NOT NULL,
       configuration_digest  text NOT NULL,
       repository             text NOT NULL,
       requested_ref          text NOT NULL,
       resolved_commit        text NOT NULL,
       input_digest           text NOT NULL,
       PRIMARY KEY (tenant,project,ticket),
       CONSTRAINT ticket_finalization_input_has_ticket FOREIGN KEY
         (tenant,project,ticket) REFERENCES ticket_projection,
       CONSTRAINT ticket_finalization_input_has_configuration FOREIGN KEY
         (tenant,project,configuration_revision,configuration_digest)
         REFERENCES configuration_revision (tenant,project,revision,digest),
       CONSTRAINT ticket_finalization_input_text_is_bounded CHECK
         (length(repository) BETWEEN 1 AND ${finalizerIdentityCharsMax}
          AND length(requested_ref) BETWEEN 1 AND ${gitRefNameCharsMax}),
       CONSTRAINT ticket_finalization_input_commit_is_object_id CHECK
         (resolved_commit ~ '${gitObjectIdPattern()}'),
       CONSTRAINT ticket_finalization_input_digest_is_hex CHECK
         (input_digest ~ '^[0-9a-f]{${artifactDigestChars}}$'))`,
    `CREATE TRIGGER ticket_finalization_input_is_written_once
       BEFORE UPDATE OR DELETE ON ticket_finalization_input
       FOR EACH ROW EXECUTE FUNCTION finalization_request_configuration_is_written_once()`,
    `GRANT SELECT,INSERT ON ticket_finalization_input TO ${boundaryOwnerRole}`,
    `GRANT INSERT,SELECT ON ticket_finalization_input TO ${ticketServiceRole}`,
    `GRANT SELECT ON ticket_finalization_input TO ${schedulerRole},${finalizerRole}`,
  ],
};
