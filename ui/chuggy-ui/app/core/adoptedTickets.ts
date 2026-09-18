import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  adoptedCatalogEntriesSchema,
  adoptedCatalogFileSchema,
  adoptedOperationAcceptanceSchema,
  adoptedOperationOutcomeSchema,
  adoptedTicketDefinitionSchema,
  adoptedTicketValidationSchema,
  adoptedTicketsSchema,
  type AdoptedCatalogEntries,
  type AdoptedCatalogFile,
  type AdoptedOperationAcceptance,
  type AdoptedOperationOutcome,
  type AdoptedTicketDefinition,
  type AdoptedTicketValidation,
  type AdoptedTickets,
} from "../../../../src/contract/adoptedTickets.ts";
import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import { apiRead } from "./apiRequest.ts";

function root(partition: PartitionIdentity): string {
  return `/api/v1/tenants/${encodeURIComponent(partition.tenant)}/projects/${encodeURIComponent(partition.project)}/ticket-machine`;
}

export function adoptedTickets(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<AdoptedTickets>> {
  return apiRead(
    ports,
    { method: "GET", path: `${root(partition)}/tickets` },
    (value) => adoptedTicketsSchema.parse(value),
  );
}

export function adoptedTicketDefinition(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
): Promise<ApiResult<AdoptedTicketDefinition>> {
  return apiRead(
    ports,
    { method: "GET", path: `${root(partition)}/tickets/${String(ticket)}` },
    (value) => adoptedTicketDefinitionSchema.parse(value),
  );
}

/**
 * Which catalog a call works against. The server resolves the bound
 * repository's tip itself, so a caller names only which binding to use when a
 * project holds more than one, and sends back `expectedCommit` — the commit
 * validation answered with — to have a write refused if the tree has moved.
 */
export interface CatalogPin {
  readonly repository?: string;
  readonly expectedCommit?: string;
}

function catalogQuery(pin: CatalogPin): string {
  const query = new URLSearchParams();
  if (pin.repository !== undefined) query.set("repository", pin.repository);
  return query.toString();
}

export function adoptedCatalog(
  ports: ApiPorts,
  partition: PartitionIdentity,
  pin: CatalogPin,
): Promise<ApiResult<AdoptedCatalogEntries>> {
  return apiRead(
    ports,
    { method: "GET", path: `${root(partition)}/catalog?${catalogQuery(pin)}` },
    (value) => adoptedCatalogEntriesSchema.parse(value),
  );
}

export function adoptedCatalogFile(
  ports: ApiPorts,
  partition: PartitionIdentity,
  pin: CatalogPin,
  path: string,
): Promise<ApiResult<AdoptedCatalogFile>> {
  return apiRead(
    ports,
    {
      method: "GET",
      path: `${root(partition)}/catalog?${catalogQuery(pin)}&path=${encodeURIComponent(path)}`,
    },
    (value) => adoptedCatalogFileSchema.parse(value),
  );
}

interface AuthoringRequest extends CatalogPin {
  readonly source: string;
  readonly idempotencyKey: string;
}

function authoringHeaders(request: CatalogPin): Record<string, string> {
  return {
    ...(request.repository === undefined
      ? {}
      : { "x-chug-repository": request.repository }),
    ...(request.expectedCommit === undefined
      ? {}
      : { "if-catalog-match": request.expectedCommit }),
  };
}

export function adoptedTicketValidate(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: Omit<AuthoringRequest, "idempotencyKey">,
): Promise<ApiResult<AdoptedTicketValidation>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: `${root(partition)}/tickets/validate`,
      rawBody: request.source,
      contentType: "application/yaml",
      headers: authoringHeaders(request),
    },
    (value) => adoptedTicketValidationSchema.parse(value),
  );
}

export function adoptedTicketCreate(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: AuthoringRequest,
): Promise<ApiResult<AdoptedOperationAcceptance>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: `${root(partition)}/tickets`,
      rawBody: request.source,
      contentType: "application/yaml",
      headers: authoringHeaders(request),
      idempotencyKey: request.idempotencyKey,
    },
    (value) => adoptedOperationAcceptanceSchema.parse(value),
  );
}

export function adoptedTicketUpdate(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
  revision: number,
  request: AuthoringRequest,
): Promise<ApiResult<AdoptedOperationAcceptance>> {
  return apiRead(
    ports,
    {
      method: "PUT",
      path: `${root(partition)}/tickets/${String(ticket)}`,
      rawBody: request.source,
      contentType: "application/yaml",
      headers: {
        ...authoringHeaders(request),
        "if-match": String(revision),
      },
      idempotencyKey: request.idempotencyKey,
    },
    (value) => adoptedOperationAcceptanceSchema.parse(value),
  );
}

export function adoptedTicketAction(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
  action: "dispatch" | "revoke" | "resume",
  idempotencyKey: string,
  source?: { readonly repository: string; readonly commit: string },
): Promise<ApiResult<AdoptedOperationAcceptance>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: `${root(partition)}/tickets/${String(ticket)}/${action}`,
      body: source ?? {},
      idempotencyKey,
    },
    (value) => adoptedOperationAcceptanceSchema.parse(value),
  );
}

export function adoptedOperation(
  ports: ApiPorts,
  partition: PartitionIdentity,
  identity: string,
): Promise<ApiResult<AdoptedOperationOutcome>> {
  return apiRead(
    ports,
    {
      method: "GET",
      path: `${root(partition)}/operations?identity=${encodeURIComponent(identity)}`,
    },
    (value) => adoptedOperationOutcomeSchema.parse(value),
  );
}

export function adoptedOperationRefusal(
  outcome: AdoptedOperationOutcome,
): string | undefined {
  return outcome.decision.type === "TicketRefused"
    ? outcome.decision.reason.type
    : undefined;
}

export function assertAdoptedOperationSucceeded(
  outcome: AdoptedOperationOutcome,
): void {
  const refusal = adoptedOperationRefusal(outcome);
  if (refusal !== undefined)
    throw new Error(`The ticket operation was refused: ${refusal}.`);
}
