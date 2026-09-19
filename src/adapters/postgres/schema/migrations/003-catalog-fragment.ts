import { apiRole, ticketServiceRole, type Migration } from "../shared.ts";
import {
  ticketCatalogDocumentBytesMax,
  ticketCatalogReferenceBytesMax,
} from "../../../../interpreter/ticketCatalog.ts";

/**
 * A project may hold catalog fragments here as well as in its repository, so a
 * fragment can be authored through the API without a commit-push-reconcile
 * cycle. The key is the authored reference a document names, which is what
 * makes the merged view one namespace rather than two; the content bound is the
 * one a committed document is already read under, because a reader cannot tell
 * the two apart and must not have to.
 */
export const migration003: Migration = {
  version: 3,
  name: "catalog-fragment",
  statements: [
    `CREATE TABLE ticket_machine_catalog_fragment (
       tenant text NOT NULL, project text NOT NULL,
       path text NOT NULL CHECK(length(path) BETWEEN 1 AND ${String(ticketCatalogReferenceBytesMax)}),
       content text NOT NULL CHECK(octet_length(content)<=${String(ticketCatalogDocumentBytesMax)}),
       written_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY(tenant,project,path),
       FOREIGN KEY(tenant,project) REFERENCES project(tenant,project))`,
    `GRANT SELECT,INSERT,UPDATE(content,written_at),DELETE
       ON ticket_machine_catalog_fragment TO ${apiRole}`,
    `GRANT SELECT ON ticket_machine_catalog_fragment TO ${ticketServiceRole}`,
  ],
};
