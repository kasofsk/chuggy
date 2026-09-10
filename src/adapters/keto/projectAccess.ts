/**
 * `ProjectAccess` answered by Ory Keto's read API, and the readiness probe
 * beside it.
 *
 * A CHECK IS ONE QUESTION AND THE ANSWER IS ONE FLAG. The permit a kind asks
 * for and the object a partition is addressed by are the interpreter's, so this
 * module holds the transport and no rule: it spells the query, reads `allowed`
 * and derives the authority the port promises.
 *
 * A NAMESPACE THE AUTHORITY DOES NOT KNOW ANSWERS "not allowed" rather than a
 * fault, so the model this deployment names is proved by the readiness probe
 * listing each namespace instead — a check cannot tell a missing model from an
 * empty one, and a deployment carrying the wrong model would refuse every
 * request while reporting itself healthy.
 */

import {
  memberAuthority,
  ProjectAccessUnavailable,
  projectAccessNamespace,
  projectAccessPermits,
  projectAccessObject,
  projectAccessTenantNamespace,
  type ProjectAccess,
  type ProjectAccessSettings,
} from "../../interpreter/projectAccess.ts";
import { ketoRequest } from "./request.ts";

/** The read API's check, whose query names the tuple being asked about. */
const ketoCheckPath = "relation-tuples/check/openapi";

/** The read API's listing, which answers 404 for a namespace the model does not declare. */
const ketoTuplesPath = "relation-tuples";

/** The read API's readiness, which reports the server rather than its model. */
const ketoReadyPath = "health/ready";

function ketoAllowed(answered: unknown, what: string): boolean {
  if (
    typeof answered !== "object" ||
    answered === null ||
    !("allowed" in answered) ||
    typeof answered.allowed !== "boolean"
  )
    throw new ProjectAccessUnavailable(`${what} answered no verdict`);
  return answered.allowed;
}

export function ketoProjectAccess(
  settings: ProjectAccessSettings,
  fetcher: typeof fetch = fetch,
): ProjectAccess {
  return {
    authorize: async (principal, partition, access) => {
      const authority = memberAuthority(principal);
      const url = new URL(ketoCheckPath, settings.readUrl);
      url.searchParams.set("namespace", projectAccessNamespace);
      url.searchParams.set("object", projectAccessObject(partition));
      url.searchParams.set("relation", projectAccessPermits[access]);
      url.searchParams.set("subject_id", principal);
      const answered = await ketoRequest({
        url,
        method: "GET",
        requestTimeoutMs: settings.requestTimeoutMs,
        fetcher,
      });
      return ketoAllowed(answered, "the access check") ? authority : undefined;
    },
  };
}

/**
 * Whether the authority is up AND carries the model this deployment names.
 * Both namespaces are listed because a check against a namespace the model
 * lacks reads exactly like a subject that holds nothing.
 */
export function ketoReadiness(
  settings: ProjectAccessSettings,
  fetcher: typeof fetch = fetch,
): { ready(): Promise<boolean> } {
  return {
    ready: async () => {
      try {
        await ketoRequest({
          url: new URL(ketoReadyPath, settings.readUrl),
          method: "GET",
          requestTimeoutMs: settings.requestTimeoutMs,
          fetcher,
        });
        for (const namespace of [
          projectAccessNamespace,
          projectAccessTenantNamespace,
        ]) {
          const url = new URL(ketoTuplesPath, settings.readUrl);
          url.searchParams.set("namespace", namespace);
          url.searchParams.set("page_size", "1");
          await ketoRequest({
            url,
            method: "GET",
            requestTimeoutMs: settings.requestTimeoutMs,
            fetcher,
          });
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}
