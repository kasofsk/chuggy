import { assertNever } from "../../domain/assertNever.ts";
import type {
  AuthorizedResult,
  NativeCancellation,
  NativeSubmissionResult,
  OperationResource,
  ProjectInventoryPage,
  ProjectRead,
} from "../../interpreter/nativeWeb.ts";
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
    headers: { "content-type": nativeHttpMediaType, ...headers },
    body,
  };
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
  operation: OperationId,
  accepted: Accepted,
): NativeHttpResponse {
  const location = operationPath(partition, operation);
  switch (accepted.accepted) {
    case "Accepted":
    case "Original":
      return response(
        202,
        { operation, state: accepted.operation.state },
        {
          location,
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
  operation: OperationId,
  result: NativeSubmissionResult,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Backlogged":
      return retry(429, result.retryAfterSeconds, "DispatchBacklog");
    case "Authorized":
      return acceptedResponse(partition, operation, result.acceptance);
    default:
      return assertNever(result);
  }
}

export function operationResponse(
  resource: OperationResource | undefined,
): NativeHttpResponse {
  return resource === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, resource);
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
      return response(200, result.value);
  }
}

export function inventoryResponse(
  page: ProjectInventoryPage,
): NativeHttpResponse {
  return response(200, {
    projects: page.projects,
    ...(page.nextAfter === undefined
      ? {}
      : { nextCursor: encodeInventoryCursor(page.nextAfter) }),
  });
}
