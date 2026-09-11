/**
 * `ProjectGrantWriter` over Ory Keto's write API.
 *
 * A GRANT IS A PUT AND A REVOCATION IS A DELETE, which is what makes both
 * idempotent: the server holds one tuple however many times it is written, and
 * a delete of a tuple that is not there is the state the caller asked for.
 */

import type {
  ProjectGrant,
  ProjectGrantSettings,
  ProjectGrantWriter,
} from "../../interpreter/projectGrant.ts";
import { projectAccessTenantNamespace } from "../../interpreter/projectAccess.ts";
import { ketoRequest } from "./request.ts";

/** The write API's tuple resource, which both verbs address. */
const ketoAdminTuplesPath = "admin/relation-tuples";

/**
 * A subject set's relation is empty, which names the tenant object itself
 * rather than anyone standing in one of its relations.
 */
const ketoSubjectSetRelation = "";

function ketoGrantBody(grant: ProjectGrant): Record<string, unknown> {
  return {
    namespace: grant.namespace,
    object: grant.object,
    relation: grant.relation,
    ...(grant.holder.subject === "Principal"
      ? { subject_id: grant.holder.principal }
      : {
          subject_set: {
            namespace: projectAccessTenantNamespace,
            object: grant.holder.tenantObject,
            relation: ketoSubjectSetRelation,
          },
        }),
  };
}

/** The same tuple as a query, which is how the write API is asked to remove one. */
function ketoGrantQuery(grant: ProjectGrant, at: URL): URL {
  at.searchParams.set("namespace", grant.namespace);
  at.searchParams.set("object", grant.object);
  at.searchParams.set("relation", grant.relation);
  if (grant.holder.subject === "Principal")
    at.searchParams.set("subject_id", grant.holder.principal);
  else {
    at.searchParams.set("subject_set.namespace", projectAccessTenantNamespace);
    at.searchParams.set("subject_set.object", grant.holder.tenantObject);
    at.searchParams.set("subject_set.relation", ketoSubjectSetRelation);
  }
  return at;
}

export function ketoProjectGrants(
  settings: ProjectGrantSettings,
  fetcher: typeof fetch = fetch,
): ProjectGrantWriter {
  return {
    write: async (grant) => {
      await ketoRequest({
        url: new URL(ketoAdminTuplesPath, settings.writeUrl),
        method: "PUT",
        requestTimeoutMs: settings.requestTimeoutMs,
        fetcher,
        body: ketoGrantBody(grant),
      });
    },
    remove: async (grant) => {
      await ketoRequest({
        url: ketoGrantQuery(
          grant,
          new URL(ketoAdminTuplesPath, settings.writeUrl),
        ),
        method: "DELETE",
        requestTimeoutMs: settings.requestTimeoutMs,
        fetcher,
      });
    },
  };
}
