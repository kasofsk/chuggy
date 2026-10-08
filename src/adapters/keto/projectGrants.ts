/**
 * `ProjectGrantWriter` over Ory Keto's write API.
 *
 * A GRANT IS A PUT AND A REVOCATION IS A DELETE, which is what makes both
 * idempotent: a tuple written again changes no answer and one delete removes
 * every copy of it, and a delete of a tuple that is not there is the state the
 * caller asked for.
 */

import type {
  ProjectGrant,
  ProjectGrantSettings,
  ProjectGrantSubject,
  ProjectGrantWriter,
} from "../../interpreter/projectGrant.ts";
import { ketoRequest } from "./request.ts";

/** The write API's tuple resource, which both verbs address. */
const ketoAdminTuplesPath = "admin/relation-tuples";

/**
 * A subject set's relation is empty where it names an object itself rather
 * than anyone standing in one of its relations.
 */
export const ketoSubjectSetRelation = "";

/** How the authority spells one holder: a subject id for a person, a subject set otherwise. */
type KetoGrantSubject =
  | { readonly subject_id: string }
  | {
      readonly subject_set: {
        readonly namespace: string;
        readonly object: string;
        readonly relation: string;
      };
    };

function ketoGrantSubject(holder: ProjectGrantSubject): KetoGrantSubject {
  switch (holder.subject) {
    case "Principal":
      return { subject_id: holder.principal };
    case "Object":
      return {
        subject_set: {
          namespace: holder.namespace,
          object: holder.object,
          relation: ketoSubjectSetRelation,
        },
      };
    case "Holders":
      return {
        subject_set: {
          namespace: holder.namespace,
          object: holder.object,
          relation: holder.relation,
        },
      };
  }
}

function ketoGrantBody(grant: ProjectGrant): Record<string, unknown> {
  return {
    namespace: grant.namespace,
    object: grant.object,
    relation: grant.relation,
    ...ketoGrantSubject(grant.holder),
  };
}

/** The same tuple as a query, which is how the write API is asked to remove one. */
function ketoGrantQuery(grant: ProjectGrant, at: URL): URL {
  at.searchParams.set("namespace", grant.namespace);
  at.searchParams.set("object", grant.object);
  at.searchParams.set("relation", grant.relation);
  const subject = ketoGrantSubject(grant.holder);
  if ("subject_id" in subject)
    at.searchParams.set("subject_id", subject.subject_id);
  else {
    at.searchParams.set("subject_set.namespace", subject.subject_set.namespace);
    at.searchParams.set("subject_set.object", subject.subject_set.object);
    at.searchParams.set("subject_set.relation", subject.subject_set.relation);
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
