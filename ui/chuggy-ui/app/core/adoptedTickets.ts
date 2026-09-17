import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  adoptedOperationAcceptanceSchema,
  adoptedOperationOutcomeSchema,
  adoptedTicketsSchema,
  type AdoptedOperationAcceptance,
  type AdoptedOperationOutcome,
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

interface AuthoringRequest {
  readonly source: string;
  readonly catalogCommit: string;
  readonly repository?: string;
  readonly idempotencyKey: string;
}

function authoringHeaders(request: AuthoringRequest): Record<string, string> {
  return {
    "x-chug-catalog-commit": request.catalogCommit,
    ...(request.repository === undefined
      ? {}
      : { "x-chug-repository": request.repository }),
  };
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
