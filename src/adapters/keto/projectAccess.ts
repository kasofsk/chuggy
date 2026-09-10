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
 * instead — a check cannot tell a missing model from an empty one, and a
 * deployment carrying the wrong model would refuse every request while
 * reporting itself healthy. The probe lists each namespace and asks for each
 * permit, because a relation the model does not declare is the one part of a
 * check that IS a fault: a permit renamed away is a 400 rather than a refusal.
 */

import {
  memberAuthority,
  ProjectAccessUnavailable,
  projectAccessNamespace,
  projectAccessPermits,
  projectAccessObject,
  projectAccessProbe,
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
 * Whether the authority is up, carries both namespaces, and declares every
 * permit a check will ask it for. A permit that is still declared under a
 * changed meaning is not detected, because a subject nothing granted is
 * refused either way.
 */
export function ketoReadiness(
  settings: ProjectAccessSettings,
  fetcher: typeof fetch = fetch,
): { ready(): Promise<boolean> } {
  const ask = (url: URL): Promise<unknown> =>
    ketoRequest({
      url,
      method: "GET",
      requestTimeoutMs: settings.requestTimeoutMs,
      fetcher,
    });
  const listing = (namespace: string): URL => {
    const url = new URL(ketoTuplesPath, settings.readUrl);
    url.searchParams.set("namespace", namespace);
    url.searchParams.set("page_size", "1");
    return url;
  };
  const probe = (permit: string): URL => {
    const url = new URL(ketoCheckPath, settings.readUrl);
    url.searchParams.set("namespace", projectAccessNamespace);
    url.searchParams.set("object", projectAccessProbe);
    url.searchParams.set("relation", permit);
    url.searchParams.set("subject_id", projectAccessProbe);
    return url;
  };
  return {
    ready: async () => {
      try {
        await ask(new URL(ketoReadyPath, settings.readUrl));
        for (const namespace of [
          projectAccessNamespace,
          projectAccessTenantNamespace,
        ])
          await ask(listing(namespace));
        for (const permit of new Set(Object.values(projectAccessPermits)))
          ketoAllowed(await ask(probe(permit)), `the ${permit} probe`);
        return true;
      } catch {
        return false;
      }
    },
  };
}
