/**
 * The public wire schemas of `src/contract/`, branded into the interpreter's
 * own types.
 *
 * The server sends a response by parsing it here, and the selector's client
 * reads one back the same way, so the shape is stated once and both directions
 * are held to it.
 */

import { asTicketId } from "../../domain/ids.ts";
import { errorEnvelopeSchema } from "../../contract/http.ts";
import {
  dispatchViewResponseSchema as dispatchViewWireSchema,
  notificationsResponseSchema as notificationsWireSchema,
  operationAcceptanceSchema,
  operationResponseSchema as operationWireSchema,
  projectInventoryResponseSchema as projectInventoryWireSchema,
} from "../../contract/responses.ts";
import type {
  DispatchViewResponse,
  OperationResponse,
} from "../../contract/responses.ts";
import type { DispatchViewPage } from "../../interpreter/dispatchView.ts";
import type {
  OperationResource,
  ProjectInventoryPage,
} from "../../interpreter/nativeWeb.ts";
import { asPublicInstant } from "../../interpreter/publicResource.ts";
import type { NotificationBatch } from "../../interpreter/notifications.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import type { Refusal } from "../../interpreter/refusal.ts";
import {
  encodeRefusalValue,
  parseRefusalValue,
} from "../../interpreter/wire.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import { asConfigurationVersion } from "../../interpreter/repositoryConfigurationIdentity.ts";
import { parseInventoryCursor } from "./contract.ts";

export const errorResponseSchema = errorEnvelopeSchema;

export const projectInventoryResponseSchema =
  projectInventoryWireSchema.transform((value): ProjectInventoryPage => ({
    projects: value.projects.map((project) => ({
      tenant: asTenantId(project.tenant),
      project: asProjectId(project.project),
    })),
    ...(value.nextCursor === undefined
      ? {}
      : { nextAfter: parseInventoryCursor(value.nextCursor) }),
  }));

export const notificationsResponseSchema = notificationsWireSchema.transform(
  (value): NotificationBatch => {
    if (value.result === "Reset") return value;
    return {
      result: "Events",
      cursor: value.cursor,
      events: value.events.map((event) => ({
        ordinal: event.ordinal,
        kind: event.kind,
        resource: event.resource,
        ...(event.projectSequence === undefined
          ? {}
          : { projectSequence: event.projectSequence }),
        ...(event.authoringVersion === undefined
          ? {}
          : { authoringVersion: event.authoringVersion }),
      })),
    };
  },
);

function dispatchViewPage(value: DispatchViewResponse): DispatchViewPage {
  if (value.result === "Reset") return value;
  return {
    result: "Page",
    token: value.token,
    candidates: value.candidates.map(
      ({ configurationVersion, ...candidate }) => ({
        ...candidate,
        ticket: asTicketId(candidate.ticket),
        ...(configurationVersion === undefined
          ? {}
          : {
              configurationVersion:
                asConfigurationVersion(configurationVersion),
            }),
      }),
    ),
    ...(value.nextAfter === undefined
      ? {}
      : { nextAfter: asTicketId(value.nextAfter) }),
    notificationCursor: value.notificationCursor,
  };
}

export const dispatchViewResponseSchema =
  dispatchViewWireSchema.transform(dispatchViewPage);

/**
 * The refusal a refused operation's wire carries, read back through the
 * model's codec. The contract has already held the pair to its shape, so a
 * refusal the codec will not read is the two statements of it disagreeing.
 */
function operationRefusal(
  value: Extract<OperationResponse, { readonly state: "Refused" }>,
): Refusal {
  const refusal = parseRefusalValue(
    value.code,
    "refusal" in value ? value.refusal : undefined,
  );
  if (refusal.parsed === "Refused")
    throw new Error(`operation response: ${refusal.why}`);
  return refusal.value;
}

function operationResource(value: OperationResponse): OperationResource {
  const identity = {
    operation: asOperationId(value.operation),
    acceptedAt: asPublicInstant(value.acceptedAt),
  };
  switch (value.state) {
    case "Succeeded":
      return {
        ...identity,
        state: "Succeeded",
        decidedSequence: value.decidedSequence,
      };
    case "Refused":
      return {
        ...identity,
        state: "Refused",
        refusal: operationRefusal(value),
        refusedHead: value.refusedHead,
        refusedLifecycleGeneration: value.refusedLifecycleGeneration,
      };
    case "Pending":
    case "Answered":
    case "Cancelled":
      return { ...identity, state: value.state };
  }
}

export const operationResponseSchema =
  operationWireSchema.transform(operationResource);

export const proposalSubmissionResponseSchema =
  operationAcceptanceSchema.transform((value) => ({
    operation: asOperationId(value.operation),
    state: value.state,
  }));

export function encodeProjectInventoryResponse(value: unknown): unknown {
  return projectInventoryWireSchema.parse(value);
}

export function encodeNotificationsResponse(value: NotificationBatch): unknown {
  return notificationsWireSchema.parse(value);
}

export function encodeDispatchViewResponse(value: DispatchViewPage): unknown {
  return dispatchViewWireSchema.parse(value);
}

export function encodeOperationResponse(value: OperationResource): unknown {
  if (value.state !== "Refused") return operationWireSchema.parse(value);
  const { refusal, ...refused } = value;
  const payload = encodeRefusalValue(refusal);
  return operationWireSchema.parse({
    ...refused,
    code: refusal.type,
    ...(payload === undefined ? {} : { refusal: payload }),
  });
}

export function encodeProposalSubmissionResponse(value: unknown): unknown {
  return operationAcceptanceSchema.parse(value);
}
