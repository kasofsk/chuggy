import { z } from "zod";

import { assertNever } from "../../domain/assertNever.ts";
import type {
  ConfigurationCreated,
  ConfigurationRevisionResource,
  DraftCreated,
  DraftDeleted,
  DraftResource,
  DraftRevised,
} from "../../interpreter/authoring.ts";
import type { DispatchViewPage } from "../../interpreter/dispatchView.ts";
import type {
  AuthorizedResult,
  NativeCancellation,
  NativeSubmissionResult,
  OperationResource,
  ProjectInventoryPage,
  ProjectRead,
  TicketResource,
} from "../../interpreter/nativeWeb.ts";
import type {
  ExecutionPage,
  ExecutionResource,
  ProjectOperationalStatus,
  OutputContentRead,
} from "../../interpreter/operationsView.ts";
import type {
  Accepted,
  Cancelled,
  OperationId,
} from "../../interpreter/operationInbox.ts";
import type { NotificationBatch } from "../../interpreter/notifications.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  encodeInventoryCursor,
  nativeHttpError,
  nativeHttpMediaType,
} from "./contract.ts";
import {
  encodeDispatchViewResponse,
  encodeNotificationsResponse,
  encodeOperationResponse,
  encodeProjectInventoryResponse,
  encodeProposalSubmissionResponse,
} from "./codecs.ts";

export interface NativeHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

function response(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): NativeHttpResponse {
  return {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": nativeHttpMediaType,
      ...headers,
    },
    body,
  };
}

const clientFaultStatusMin = 400;
const clientFaultStatusMax = 499;

function invalidRequest(status: number): NativeHttpResponse {
  return response(
    status,
    nativeHttpError("InvalidRequest", "The request is invalid."),
  );
}

function requestShapeFault(failure: unknown): boolean {
  return (
    failure instanceof RangeError ||
    failure instanceof TypeError ||
    failure instanceof z.ZodError
  );
}

function transportFaultStatus(failure: unknown): number | undefined {
  if (typeof failure !== "object" || failure === null) return undefined;
  const status = (failure as Readonly<Record<string, unknown>>)["statusCode"];
  return typeof status === "number" &&
    status >= clientFaultStatusMin &&
    status <= clientFaultStatusMax
    ? status
    : undefined;
}

export function failureResponse(failure: unknown): NativeHttpResponse {
  const status = transportFaultStatus(failure);
  if (status === 413)
    return response(
      413,
      nativeHttpError("BodyTooLarge", "The request body is too large."),
    );
  if (status !== undefined) return invalidRequest(status);
  if (requestShapeFault(failure)) return invalidRequest(400);
  return response(
    500,
    nativeHttpError("InternalError", "The request could not be completed."),
  );
}

function operationPath(partition: Partition, operation: OperationId): string {
  return [
    "/api/v1/tenants",
    encodeURIComponent(partition.tenant),
    "projects",
    encodeURIComponent(partition.project),
    "operations",
    encodeURIComponent(operation),
  ].join("/");
}

function retry(
  status: number,
  seconds: number,
  code: string,
): NativeHttpResponse {
  return response(
    status,
    nativeHttpError(code, "The request can be retried."),
    {
      "retry-after": String(seconds),
    },
  );
}

function acceptedResponse(
  partition: Partition,
  accepted: Accepted,
): NativeHttpResponse {
  switch (accepted.accepted) {
    case "Accepted":
    case "Original":
      return response(
        202,
        encodeProposalSubmissionResponse({
          operation: accepted.operation.operation,
          state: accepted.operation.state,
        }),
        {
          location: operationPath(partition, accepted.operation.operation),
        },
      );
    case "IdempotencyConflict":
      return response(
        409,
        nativeHttpError(
          "IdempotencyConflict",
          "The idempotency key conflicts.",
        ),
      );
    case "InvalidCommand":
      return response(
        422,
        nativeHttpError("InvalidMutation", "The mutation was not accepted."),
      );
    case "Backpressure":
      return retry(429, accepted.retryAfterSeconds, "MailboxBackpressure");
    case "Unavailable":
      return retry(503, accepted.retryAfterSeconds, "MailboxUnavailable");
    case "NotAdmitted":
      return response(
        409,
        nativeHttpError("MutationNotAdmitted", "The mutation is not admitted."),
      );
  }
}

export function submissionResponse(
  partition: Partition,
  result: NativeSubmissionResult,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Backlogged":
      return retry(429, result.retryAfterSeconds, "DispatchBacklog");
    case "Authorized":
      return acceptedResponse(partition, result.acceptance);
    default:
      return assertNever(result);
  }
}

export function operationResponse(
  resource: OperationResource | undefined,
): NativeHttpResponse {
  return resource === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, encodeOperationResponse(resource));
}

export function projectResponse(result: ProjectRead): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Behind":
      return response(409, {
        ...nativeHttpError(
          "ProjectionBehind",
          "The projection has not reached the required sequence.",
        ),
        observedSequence: result.observedSequence,
      });
    case "Found":
      return response(200, result.project);
  }
}

export function ticketResponse(
  resource: TicketResource | undefined,
): NativeHttpResponse {
  return resource === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, resource);
}

export function operationalStatusResponse(
  result: AuthorizedResult<ProjectOperationalStatus>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, result.value);
}

export function executionsResponse(
  result: AuthorizedResult<ExecutionPage>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, result.value);
}

export function executionResponse(
  resource: ExecutionResource | undefined,
): NativeHttpResponse {
  return resource === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, resource);
}

export function outputContentResponse(
  result: OutputContentRead,
): NativeHttpResponse {
  switch (result.read) {
    case "Content":
      return response(200, result);
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "TooLarge":
      return response(413, {
        ...nativeHttpError(
          "OutputTooLarge",
          "The output is too large to preview.",
        ),
        bytes: result.bytes,
      });
    case "Unavailable":
      return retry(503, result.retryAfterSeconds, "OutputUnavailable");
    case "Corrupt":
      return response(
        409,
        nativeHttpError("OutputCorrupt", "The output failed verification."),
      );
  }
}

function cancellationFound(cancellation: Cancelled): NativeHttpResponse {
  switch (cancellation.cancelled) {
    case "Cancelled":
    case "AlreadyCancelled":
      return response(200, {
        operation: cancellation.operation.operation,
        state: cancellation.operation.state,
      });
    case "NotPending":
      return response(409, {
        ...nativeHttpError(
          "OperationNotPending",
          "The operation is no longer pending.",
        ),
        state: cancellation.state,
      });
    case "Unknown":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
  }
}

export function cancellationResponse(
  result: NativeCancellation,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Found":
      return cancellationFound(result.cancellation);
  }
}

export function notificationsResponse(
  result: AuthorizedResult<NotificationBatch>,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Authorized":
      return response(200, encodeNotificationsResponse(result.value));
  }
}

export function inventoryResponse(
  page: ProjectInventoryPage,
): NativeHttpResponse {
  return response(
    200,
    encodeProjectInventoryResponse({
      projects: page.projects,
      ...(page.nextAfter === undefined
        ? {}
        : { nextCursor: encodeInventoryCursor(page.nextAfter) }),
    }),
  );
}

function resourcePath(
  partition: Partition,
  collection: string,
  identity: string | number,
): string {
  return [
    "/api/v1/tenants",
    encodeURIComponent(partition.tenant),
    "projects",
    encodeURIComponent(partition.project),
    collection,
    encodeURIComponent(String(identity)),
  ].join("/");
}

function draftBody(draft: DraftResource): unknown {
  return {
    partition: draft.partition,
    ticket: draft.ticket,
    authoringVersion: draft.authoringVersion,
    state: draft.state,
    configurationRevision: draft.configurationRevision,
    authoring: {
      dependencies: [...draft.authoring.deps],
      program: draft.authoring.prog,
      workFanout: draft.authoring.workFanout,
      reworkPolicy: draft.authoring.reworkPolicy,
      finalizationPricing: draft.authoring.finalizationPricing,
      resumePricing: draft.authoring.resumePricing,
      finalizer: draft.authoring.finalizer,
    },
  };
}

export function configurationResponse(
  resource: ConfigurationRevisionResource | undefined,
): NativeHttpResponse {
  return resource === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, resource);
}

function configurationCreated(value: ConfigurationCreated): NativeHttpResponse {
  switch (value.created) {
    case "Created":
      return response(201, value.revision, {
        location: resourcePath(
          value.revision.partition,
          "configurations",
          value.revision.revision,
        ),
      });
    case "AlreadyExists":
      return response(200, value.revision);
    case "IdentityConflict":
      return response(
        409,
        nativeHttpError(
          "ConfigurationIdentityConflict",
          "The configuration identity conflicts.",
        ),
      );
    case "ParentNotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
  }
}

export function configurationCreationResponse(
  result: AuthorizedResult<ConfigurationCreated>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : configurationCreated(result.value);
}

export function draftResponse(
  resource: DraftResource | undefined,
): NativeHttpResponse {
  return resource === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, draftBody(resource));
}

function draftCreated(value: DraftCreated): NativeHttpResponse {
  switch (value.created) {
    case "Created":
      return response(201, draftBody(value.draft), {
        location: resourcePath(
          value.draft.partition,
          "drafts",
          value.draft.ticket,
        ),
      });
    case "ConfigurationNotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
  }
}

export function draftCreationResponse(
  result: AuthorizedResult<DraftCreated>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : draftCreated(result.value);
}

function draftRevised(value: DraftRevised): NativeHttpResponse {
  switch (value.revised) {
    case "Revised":
      return response(200, draftBody(value.draft));
    case "NotFound":
    case "ConfigurationNotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Stale":
      return response(409, {
        ...nativeHttpError("DraftChanged", "The draft has changed."),
        currentVersion: value.currentVersion,
      });
    case "NotDraft":
      return response(409, {
        ...nativeHttpError("DraftNotEditable", "The draft is not editable."),
        state: value.state,
      });
  }
}

export function draftRevisionResponse(
  result: AuthorizedResult<DraftRevised>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : draftRevised(result.value);
}

function draftDeleted(value: DraftDeleted): NativeHttpResponse {
  switch (value.deleted) {
    case "Deleted":
      return response(200, draftBody(value.draft));
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Stale":
      return response(409, {
        ...nativeHttpError("DraftChanged", "The draft has changed."),
        currentVersion: value.currentVersion,
      });
    case "NotDraft":
      return response(409, {
        ...nativeHttpError("DraftNotEditable", "The draft is not editable."),
        state: value.state,
      });
  }
}

export function draftDeletionResponse(
  result: AuthorizedResult<DraftDeleted>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : draftDeleted(result.value);
}

export function dispatchViewResponse(
  result: AuthorizedResult<DispatchViewPage>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, encodeDispatchViewResponse(result.value));
}
