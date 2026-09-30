/**
 * `ProjectAccess` answered by Ory Keto's read API, with the tenant claims a
 * creation asks of the same API and the readiness probe beside them.
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
  projectAccessTenantObject,
  tenantAccessPermits,
  type ProjectAccess,
  type ProjectAccessSettings,
} from "../../interpreter/projectAccess.ts";
import type { Authority } from "../../interpreter/operationInbox.ts";
import type { TenantClaims } from "../../interpreter/projectCreation.ts";
import { projectTenantRelation } from "../../interpreter/projectGrant.ts";
import type { Principal } from "../../interpreter/principal.ts";
import { ketoSubjectSetRelation } from "./projectGrants.ts";
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

/** Whether a listing holds any tuple, which is all a claim asks of it. */
function ketoListed(answered: unknown): boolean {
  if (
    typeof answered !== "object" ||
    answered === null ||
    !("relation_tuples" in answered) ||
    !Array.isArray(answered.relation_tuples)
  )
    throw new ProjectAccessUnavailable("the tuple listing answered no tuples");
  return answered.relation_tuples.length > 0;
}

/** The check URL for one tuple, which is the only shape either question takes. */
function ketoCheckUrl(
  readUrl: string,
  namespace: string,
  object: string,
  relation: string,
  subject: string,
): URL {
  const url = new URL(ketoCheckPath, readUrl);
  url.searchParams.set("namespace", namespace);
  url.searchParams.set("object", object);
  url.searchParams.set("relation", relation);
  url.searchParams.set("subject_id", subject);
  return url;
}

export function ketoProjectAccess(
  settings: ProjectAccessSettings,
  fetcher: typeof fetch = fetch,
): ProjectAccess {
  const checked = async (
    principal: Principal,
    namespace: string,
    object: string,
    permit: string,
  ): Promise<Authority | undefined> => {
    const answered = await ketoRequest({
      url: ketoCheckUrl(settings.readUrl, namespace, object, permit, principal),
      method: "GET",
      requestTimeoutMs: settings.requestTimeoutMs,
      fetcher,
    });
    return ketoAllowed(answered, "the access check")
      ? memberAuthority(principal)
      : undefined;
  };
  return {
    authorize: (principal, partition, access) =>
      checked(
        principal,
        projectAccessNamespace,
        projectAccessObject(partition),
        projectAccessPermits[access],
      ),
    authorizeTenant: (principal, tenant, access) =>
      checked(
        principal,
        projectAccessTenantNamespace,
        projectAccessTenantObject(tenant),
        tenantAccessPermits[access],
      ),
  };
}

/** A tenant is claimed by a tuple on its own object or by a project naming it as its tenant. */
export function ketoTenantClaims(
  settings: ProjectAccessSettings,
  fetcher: typeof fetch = fetch,
): TenantClaims {
  const listed = async (
    query: Readonly<Record<string, string>>,
  ): Promise<boolean> => {
    const url = new URL(ketoTuplesPath, settings.readUrl);
    for (const [name, value] of Object.entries(query))
      url.searchParams.set(name, value);
    url.searchParams.set("page_size", "1");
    return ketoListed(
      await ketoRequest({
        url,
        method: "GET",
        requestTimeoutMs: settings.requestTimeoutMs,
        fetcher,
      }),
    );
  };
  return {
    claimed: async (tenant) => {
      const object = projectAccessTenantObject(tenant);
      return (
        (await listed({ namespace: projectAccessTenantNamespace, object })) ||
        (await listed({
          namespace: projectAccessNamespace,
          relation: projectTenantRelation,
          "subject_set.namespace": projectAccessTenantNamespace,
          "subject_set.object": object,
          "subject_set.relation": ketoSubjectSetRelation,
        }))
      );
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
  const probe = (namespace: string, permit: string): URL =>
    ketoCheckUrl(
      settings.readUrl,
      namespace,
      projectAccessProbe,
      permit,
      projectAccessProbe,
    );
  const probed: readonly (readonly [string, string])[] = [
    ...[...new Set(Object.values(projectAccessPermits))].map(
      (permit) => [projectAccessNamespace, permit] as const,
    ),
    ...[...new Set(Object.values(tenantAccessPermits))].map(
      (permit) => [projectAccessTenantNamespace, permit] as const,
    ),
  ];
  return {
    ready: async () => {
      try {
        await ask(new URL(ketoReadyPath, settings.readUrl));
        for (const namespace of [
          projectAccessNamespace,
          projectAccessTenantNamespace,
        ])
          await ask(listing(namespace));
        for (const [namespace, permit] of probed)
          ketoAllowed(
            await ask(probe(namespace, permit)),
            `the ${namespace} ${permit} probe`,
          );
        return true;
      } catch {
        return false;
      }
    },
  };
}
