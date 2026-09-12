/**
 * The writer reads the provenance of the configuration a release pins.
 *
 * 020 granted this table to the API and the boundary owner, which was every
 * role that joined it then. 081 made a release read the repository its
 * configuration was imported from, and that read is in the decision
 * transaction — `src/adapters/postgres/decision.ts`, under the ticket
 * service's own role, which holds nothing on the table.
 *
 * SELECT IS THE WHOLE OF IT. `import_repository_configuration` is what writes
 * a provenance row, and 020's grant of INSERT to the boundary owner is what
 * lets that body write one; a writer that could insert here could claim a
 * configuration came from a repository nobody imported it from.
 */

import { ticketServiceRole, type Migration } from "../shared.ts";

export const migration087: Migration = {
  version: 87,
  name: "the ticket service reads configuration provenance",
  statements: [
    `GRANT SELECT ON repository_configuration_provenance TO ${ticketServiceRole}`,
  ],
};
