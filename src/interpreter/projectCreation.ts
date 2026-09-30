/**
 * A signed-in principal creating a project: the service the API's creation
 * route answers from.
 *
 * A TENANT NAME IS FIRST-COME. Any principal may create a tenant no row holds
 * and becomes its administrator; a tenant that stands takes a project only from
 * a principal the authority says administers it, and anyone else is told the
 * name is taken rather than that it was not found, because a tenant name is not
 * a secret. The door decides the race between two creators of one new tenant,
 * so the loser is `TenantTaken` and never a project in the winner's tenant.
 *
 * ACCESS IS WRITTEN AFTER THE ROW COMMITS, AND A REPLAY WRITES IT AGAIN. Both
 * grants are idempotent, so an authority that failed after the commit is
 * repaired by sending the same request under the same idempotency key.
 */

import { assertNever } from "../domain/assertNever.ts";
import { projectNameSchema } from "../contract/requests.ts";
import type { OperationId, Authority } from "./operationInbox.ts";
import { memberAuthority, type ProjectAccess } from "./projectAccess.ts";
import {
  projectTenantGrant,
  tenantAdministratorGrant,
  type ProjectGrant,
  type ProjectGrantWriter,
} from "./projectGrant.ts";
import type { Principal } from "./principal.ts";
import { asProjectId, asTenantId, type Partition } from "./projectStore.ts";

/** One creation as the wire names it, before either name is held to the rule. */
export interface ProjectCreationRequest {
  readonly tenant: string;
  readonly project: string;
  readonly operation: OperationId;
}

/** The name a refusal is about. */
export type ProjectCreationField = "tenant" | "project";

/** Every answer the door gives. */
export const allProjectCreationOutcomes = [
  "Created",
  "AlreadyCreated",
  "ProjectExists",
  "TenantTaken",
  "OperationConflict",
] as const;

export type ProjectCreationOutcome =
  (typeof allProjectCreationOutcomes)[number];

/** What the door answered, and whether the operation it accepted made the tenant. */
export interface ProjectCreationAnswer {
  readonly outcome: ProjectCreationOutcome;
  readonly tenantCreated: boolean;
}

/** One creation as the door takes it: whether the caller expects the tenant to be new is the caller's standing. */
export interface ProjectCreationWrite {
  readonly partition: Partition;
  readonly tenantNew: boolean;
  readonly operation: OperationId;
  readonly authority: Authority;
}

/** The durable side: the tenant, the project and the operation, in one transaction. */
export interface ProjectCreationStore {
  create(write: ProjectCreationWrite): Promise<ProjectCreationAnswer>;
}

/** What creation reaches, with no grant writer on a deployment that names no authority to write to. */
export interface ProjectCreationPorts {
  readonly access: ProjectAccess;
  readonly store: ProjectCreationStore;
  readonly grants?: ProjectGrantWriter;
}

export type ProjectCreationResult =
  | { readonly result: "Created"; readonly partition: Partition }
  | { readonly result: "AlreadyCreated"; readonly partition: Partition }
  | { readonly result: "ProjectExists" }
  | { readonly result: "TenantTaken" }
  | { readonly result: "OperationConflict" }
  | { readonly result: "NameInvalid"; readonly field: ProjectCreationField }
  | { readonly result: "NotConfigured" };

export interface ProjectCreation {
  create(
    principal: Principal,
    request: ProjectCreationRequest,
  ): Promise<ProjectCreationResult>;
}

/** The first name the rule refuses, tenant before project. */
export function projectCreationNameFault(
  request: Pick<ProjectCreationRequest, "tenant" | "project">,
): ProjectCreationField | undefined {
  if (!projectNameSchema.safeParse(request.tenant).success) return "tenant";
  if (!projectNameSchema.safeParse(request.project).success) return "project";
  return undefined;
}

/** The grants an accepted creation writes: the tenant's administrator only where it made the tenant. */
export function projectCreationGrants(
  principal: Principal,
  partition: Partition,
  tenantCreated: boolean,
): readonly ProjectGrant[] {
  const placed = projectTenantGrant(partition);
  return tenantCreated
    ? [tenantAdministratorGrant(principal, partition.tenant), placed]
    : [placed];
}

async function projectCreationCreate(
  ports: ProjectCreationPorts,
  grants: ProjectGrantWriter,
  principal: Principal,
  request: ProjectCreationRequest,
): Promise<ProjectCreationResult> {
  const field = projectCreationNameFault(request);
  if (field !== undefined) return { result: "NameInvalid", field };
  const partition: Partition = {
    tenant: asTenantId(request.tenant),
    project: asProjectId(request.project),
  };
  const administers = await ports.access.authorizeTenant(
    principal,
    partition.tenant,
    "AdministerTenant",
  );
  const answer = await ports.store.create({
    partition,
    tenantNew: administers === undefined,
    operation: request.operation,
    authority: memberAuthority(principal),
  });
  switch (answer.outcome) {
    case "Created":
    case "AlreadyCreated":
      for (const grant of projectCreationGrants(
        principal,
        partition,
        answer.tenantCreated,
      ))
        await grants.write(grant);
      return { result: answer.outcome, partition };
    case "ProjectExists":
    case "TenantTaken":
    case "OperationConflict":
      return { result: answer.outcome };
    default:
      return assertNever(answer.outcome);
  }
}

export function projectCreation(ports: ProjectCreationPorts): ProjectCreation {
  return {
    create: (principal, request) => {
      const grants = ports.grants;
      if (grants === undefined)
        return Promise.resolve({ result: "NotConfigured" });
      return projectCreationCreate(ports, grants, principal, request);
    },
  };
}
