import { z } from "zod";

import { assertNever } from "../../domain/assertNever.ts";
import type {
  ConfigurationCreated,
  ConfigurationPage,
  ConfigurationRevisionResource,
  DraftCreated,
  DraftInitializationRead,
  DraftDeleted,
  DraftPage,
  DraftResource,
  DraftRevised,
} from "../../interpreter/authoring.ts";
import type { DispatchViewPage } from "../../interpreter/dispatchView.ts";
import type {
  AuthorizedResult,
  NativeActionPage,
  NativeCancellation,
  NativeSubmissionResult,
  OperationResource,
  ProjectInventoryPage,
  ProjectRead,
  TicketNativeAction,
  TicketResource,
} from "../../interpreter/nativeWeb.ts";
import type { SelectorOperationalContext } from "../../interpreter/selector.ts";
import type {
  AgenticRefusalsRead,
  TicketAgenticRefusalsRead,
} from "../../interpreter/agenticRefusal.ts";
import {
  handoffNotePreview,
  type LeadRead,
  type LeadTranscriptRead,
  type LeadTurnRecord,
} from "../../interpreter/leadRead.ts";
import type { SelectorHistoryRead } from "../../interpreter/selectorHistory.ts";
import type { SessionStoreEntry } from "../../interpreter/sessionTranscript.ts";
import type {
  SelectorProjectSettingsHistoryRead,
  SelectorProjectSettingsRead,
  SelectorProjectSettingsRecord,
  SelectorProjectSettingsRefusal,
  SelectorProjectSettingsWritten,
} from "../../interpreter/selectorProjectSettings.ts";
import type {
  ExecutionPage,
  ExecutionResource,
  ProjectOperationalStatus,
  OutputContentRead,
} from "../../interpreter/operationsView.ts";
import type {
  RunConfigurationRead,
  RunTranscriptRead,
  RunTurnsPage,
} from "../../interpreter/runEvidence.ts";
import type {
  Accepted,
  Cancelled,
  OperationId,
} from "../../interpreter/operationInbox.ts";
import type { NotificationBatch } from "../../interpreter/notifications.ts";
import type {
  ThreadMessageSent,
  ThreadOpening,
  ThreadRead,
  ThreadTurnRecord,
  ThreadsRead,
} from "../../interpreter/threadRead.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { DraftBrief } from "../../interpreter/ticketBrief.ts";
import type { RepositoryConfigurationImportOutcome } from "../../interpreter/repositoryConfiguration.ts";
import { nativeHttpError, nativeHttpMediaType } from "../../contract/http.ts";
import {
  encodeConfigurationCursor,
  encodeDraftCursor,
  encodeExecutionCursor,
  encodeInventoryCursor,
  encodeNativeActionCursor,
  encodeTicketActivityCursor,
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
      return response(200, {
        partition: result.project.partition,
        sequence: result.project.sequence,
        tickets: result.project.tickets,
        ...(result.project.nextAfter === undefined
          ? {}
          : { nextAfter: result.project.nextAfter }),
        ...(result.project.nextRecentActivityAfter === undefined
          ? {}
          : {
              nextCursor: encodeTicketActivityCursor(
                result.project.partition,
                result.project.nextRecentActivityAfter,
              ),
            }),
      });
  }
}

/** One project as the inventory lists it, which is the representation a project-level change carries. */
export function projectEntryResponse(result: ProjectRead): NativeHttpResponse {
  return result.result === "Found"
    ? response(200, result.project.partition)
    : response(404, nativeHttpError("NotFound", "Resource not found."));
}

export function ticketResponse(
  resource: TicketResource | undefined,
): NativeHttpResponse {
  return resource === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, resource);
}

/** A ticket nobody may read and a ticket that does not exist answer alike. */
export function ticketNativeActionsResponse(
  actions: readonly TicketNativeAction[] | undefined,
): NativeHttpResponse {
  return actions === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, { actions });
}

export function nativeActionsResponse(
  partition: Partition,
  result: AuthorizedResult<NativeActionPage>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, {
        actions: result.value.actions,
        ...(result.value.nextAfter === undefined
          ? {}
          : {
              nextCursor: encodeNativeActionCursor(
                partition,
                result.value.nextAfter,
              ),
            }),
      });
}

export function operationalStatusResponse(
  result: AuthorizedResult<ProjectOperationalStatus>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, result.value);
}

export function selectorOperationalContextResponse(
  result: AuthorizedResult<SelectorOperationalContext>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, result.value);
}

/** The record on the wire, whose effective half names no partition twice. */
function selectorProjectSettingsBody(
  settings: SelectorProjectSettingsRecord,
): unknown {
  const effective = settings.effective;
  return {
    partition: settings.partition,
    revision: settings.revision,
    overrides: settings.overrides,
    effective: {
      revision: effective.revision,
      projectRevision: effective.projectRevision,
      mode: effective.mode,
      installationMode: effective.installationMode,
      dispatchMode: effective.dispatchMode,
      basePrompt: effective.basePrompt,
      ...(effective.northStar === undefined
        ? {}
        : { northStar: effective.northStar }),
      modelAllowlist: effective.modelAllowlist,
      toolAllowlist: effective.toolAllowlist,
      limits: effective.limits,
      operationalContextMaxAgeMs: effective.operationalContextMaxAgeMs,
    },
  };
}

export function selectorProjectSettingsResponse(
  result: SelectorProjectSettingsRead,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, selectorProjectSettingsBody(result.settings));
}

/**
 * A refusal a caller can act on. A write that did not complete is the one worth
 * waiting out, so it carries the retry the caller would otherwise guess at.
 */
function selectorProjectSettingsRefusal(
  refusal: SelectorProjectSettingsRefusal,
): NativeHttpResponse {
  switch (refusal) {
    case "AutomaticDispatchUnavailable":
      return response(
        409,
        nativeHttpError(
          refusal,
          "Automatic dispatch needs a production-ready selector policy host.",
        ),
      );
    case "SettingsWriteContended":
      return retry(503, 1, refusal);
    default:
      return assertNever(refusal);
  }
}

export function selectorProjectSettingsWriteResponse(
  result: SelectorProjectSettingsWritten,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Conflict":
      return response(409, {
        ...nativeHttpError(
          "SettingsRevisionConflict",
          "The selector settings moved under this write.",
        ),
        settings: selectorProjectSettingsBody(result.settings),
      });
    case "Refused":
      return selectorProjectSettingsRefusal(result.refusal);
    case "Written":
      return response(200, selectorProjectSettingsBody(result.settings));
    default:
      return assertNever(result);
  }
}

export function selectorSettingsHistoryResponse(
  result: SelectorProjectSettingsHistoryRead,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, { revisions: result.revisions });
}

export function executionsResponse(
  partition: Partition,
  result: AuthorizedResult<ExecutionPage>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, {
        executions: result.value.executions,
        ...(result.value.nextAfter === undefined
          ? {}
          : {
              nextCursor: encodeExecutionCursor(
                partition,
                result.value.nextAfter,
              ),
            }),
      });
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

/** A run nobody may read and a run that never happened answer alike. */
export function runTurnsResponse(
  page: RunTurnsPage | undefined,
): NativeHttpResponse {
  return page === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, page);
}

export function runTranscriptResponse(
  result: RunTranscriptRead,
): NativeHttpResponse {
  switch (result.read) {
    case "Page":
      return response(200, result.page);
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Unavailable":
      return retry(503, result.retryAfterSeconds, "TranscriptUnavailable");
    case "Corrupt":
      return response(
        409,
        nativeHttpError(
          "TranscriptCorrupt",
          "The transcript failed verification.",
        ),
      );
  }
}

export function runConfigurationResponse(
  result: RunConfigurationRead,
): NativeHttpResponse {
  switch (result.read) {
    case "Content":
      return response(200, result);
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Unavailable":
      return retry(503, result.retryAfterSeconds, "ConfigurationUnavailable");
    case "Corrupt":
      return response(
        409,
        nativeHttpError(
          "ConfigurationCorrupt",
          "The configuration snapshot failed verification.",
        ),
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

/**
 * The brief as the wire reads it, absent for a draft authored without one. Every
 * list is answered whether or not it has members, because a reader that revises
 * sends back what it read and an omitted list is what a revision erases.
 */
function briefBody(brief: DraftBrief): unknown {
  return {
    intent: brief.intent,
    links: [...brief.links],
    checks: [...brief.checks],
    ...(brief.branch === undefined ? {} : { branch: brief.branch }),
    ...(brief.finalization === undefined
      ? {}
      : { finalization: { ...brief.finalization } }),
  };
}

function draftBody(draft: DraftResource): unknown {
  return {
    partition: draft.partition,
    ticket: draft.ticket,
    authoringVersion: draft.authoringVersion,
    state: draft.state,
    configurationRevision: draft.configurationRevision,
    ...(draft.configurationVersion === undefined
      ? {}
      : { configurationVersion: draft.configurationVersion }),
    authoring: {
      dependencies: [...draft.authoring.deps],
      program: draft.authoring.prog,
      workFanout: draft.authoring.workFanout,
      reworkPolicy: draft.authoring.reworkPolicy,
      finalizationPricing: draft.authoring.finalizationPricing,
      resumePricing: draft.authoring.resumePricing,
      finalizer: draft.authoring.finalizer,
    },
    ...(draft.brief === undefined ? {} : { brief: briefBody(draft.brief) }),
  };
}

export function configurationResponse(
  resource: ConfigurationRevisionResource | undefined,
): NativeHttpResponse {
  return resource === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, resource);
}

export function configurationsResponse(
  result: AuthorizedResult<ConfigurationPage>,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, {
        configurations: result.value.configurations,
        ...(result.value.nextAfter === undefined
          ? {}
          : {
              nextCursor: encodeConfigurationCursor(
                result.value.partition,
                result.value.nextAfter,
              ),
            }),
      });
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

export function repositoryConfigurationImportResponse(
  result: RepositoryConfigurationImportOutcome,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
    case "RepositoryAbsent":
    case "SnapshotAbsent":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Unavailable":
      return retry(503, 1, "RepositoryUnavailable");
    case "SnapshotRefused":
      return response(
        422,
        nativeHttpError(
          "RepositorySnapshotRefused",
          "The snapshot was refused.",
        ),
      );
    case "DeclarationsRefused":
      return response(422, {
        ...nativeHttpError(
          "RepositoryConfigurationsRefused",
          "The repository configurations were refused.",
        ),
        faults: result.faults,
      });
    case "IdentityConflict":
      return response(
        409,
        nativeHttpError(
          "ConfigurationIdentityConflict",
          "The configuration identity conflicts.",
        ),
      );
    case "StaleBinding":
      return response(
        409,
        nativeHttpError(
          "RepositoryBindingChanged",
          "The repository binding changed.",
        ),
      );
    case "Imported":
      return response(200, { imported: true });
    default:
      return assertNever(result);
  }
}

export function draftResponse(
  resource: DraftResource | undefined,
): NativeHttpResponse {
  return resource === undefined
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, draftBody(resource));
}

/**
 * One page of open drafts. `nextCursor` is answered exactly where `more` is
 * true, so a client reads one field or the other and never both.
 */
export function draftsResponse(
  result: AuthorizedResult<DraftPage>,
): NativeHttpResponse {
  if (result.result === "NotFound")
    return response(404, nativeHttpError("NotFound", "Resource not found."));
  const page = result.value;
  return response(200, {
    drafts: page.drafts.map(draftBody),
    ...(page.nextCursor === undefined
      ? {}
      : { nextCursor: encodeDraftCursor(page.partition, page.nextCursor) }),
    more: page.more,
  });
}

export function draftInitializationResponse(
  result: AuthorizedResult<DraftInitializationRead>,
): NativeHttpResponse {
  if (result.result === "NotFound")
    return response(404, nativeHttpError("NotFound", "Resource not found."));
  const initialized = result.value;
  if (initialized.initialized === "ConfigurationNotFound")
    return response(404, nativeHttpError("NotFound", "Resource not found."));
  if (initialized.initialized === "ConfigurationIncomplete")
    return response(
      409,
      nativeHttpError(
        "ConfigurationIncomplete",
        "The configuration is not ready.",
      ),
    );
  if (initialized.initialized === "PolicyUnavailable")
    return retry(503, 1, "DraftInitializationUnavailable");
  const value = initialized.value;
  return response(200, {
    configuration: value.configuration,
    fence: {
      projectSequence: value.projectSequence,
      configurationDigest: value.configuration.digest,
    },
    defaults: {
      dependencies: [...value.defaults.deps],
      program: value.defaults.prog,
      workFanout: value.defaults.workFanout,
      reworkPolicy: value.defaults.reworkPolicy,
      finalizationPricing: value.defaults.finalizationPricing,
      resumePricing: value.defaults.resumePricing,
      finalizer: value.defaults.finalizer,
    },
    choices: value.choices,
    dependencyCandidates: value.dependencyCandidates,
    dependencyCandidatesTruncated: value.dependencyCandidatesTruncated,
    ...(value.commandedCheckStage === undefined
      ? {}
      : { commandedCheckStage: value.commandedCheckStage }),
  });
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
    case "Stale":
      return response(
        409,
        nativeHttpError(
          "DraftInitializationStale",
          "The draft initialization is stale.",
        ),
      );
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

/**
 * One turn of the lead's mailbox on the wire. The turn's identity is the
 * decision's for an observation turn — that is what makes offering one
 * idempotent — so the decision is named rather than stored twice, and no other
 * input kind has one.
 */
function leadTurnBody(turn: LeadTurnRecord): unknown {
  return {
    turn: turn.turn,
    ordinal: turn.ordinal,
    inputKind: turn.inputKind,
    state: turn.state,
    ...(turn.inputKind === "Observation" ? { decision: turn.turn } : {}),
    ...(turn.failure === undefined ? {} : { failure: turn.failure }),
    ...(turn.measured === undefined ? {} : turn.measured),
    ...(turn.batchFirst === undefined ? {} : { batchFirst: turn.batchFirst }),
    ...(turn.batchLast === undefined ? {} : { batchLast: turn.batchLast }),
  };
}

export function leadResponse(result: LeadRead): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, {
        session: result.lead.session,
        state: result.lead.state,
        attention: result.lead.attention,
        ...(result.lead.agentReference === undefined
          ? {}
          : { agentReference: result.lead.agentReference }),
        notificationCursor: result.lead.notificationCursor,
        handoffNote: handoffNotePreview(result.lead.handoffNote),
        turns: result.lead.turns.map(leadTurnBody),
        streams: result.streams,
      });
}

/**
 * One transcript entry as the contract declares it. The stored entry carries the
 * parent links and the compaction metadata the walk needed, and a reader is
 * given neither: the wire says what the chain is, not how it was found.
 */
function leadTranscriptEntryBody(entry: SessionStoreEntry): unknown {
  return {
    ...(entry.uuid === undefined ? {} : { uuid: entry.uuid }),
    type: entry.type,
    ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }),
    ...(entry.message === undefined ? {} : { message: entry.message }),
  };
}

export function leadTranscriptResponse(
  result: LeadTranscriptRead,
): NativeHttpResponse {
  switch (result.read) {
    case "Page":
      return response(200, {
        ...result.page,
        entries: result.page.entries.map(leadTranscriptEntryBody),
      });
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Unavailable":
      return retry(503, result.retryAfterSeconds, "TranscriptUnavailable");
  }
}

export function agenticRefusalsResponse(
  result: AgenticRefusalsRead,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, { refusals: result.refusals, more: result.more });
}

/** A ticket's refusals answer with the ticket rather than the partition each entry stands in. */
export function ticketAgenticRefusalsResponse(
  result: TicketAgenticRefusalsRead,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, {
        ticket: result.ticket,
        entries: result.entries.map((entry) => ({
          ordinal: entry.ordinal,
          event: entry.event,
          ticketVersion: entry.ticketVersion,
          reason: entry.reason,
          decision: entry.decision,
          recordedAt: entry.recordedAt,
        })),
        more: result.more,
        ...(result.standing === undefined
          ? {}
          : {
              standing: {
                ticketVersion: result.standing.ticketVersion,
                reason: result.standing.reason,
                recordedAt: result.standing.recordedAt,
              },
            }),
      });
}

export function selectorHistoryResponse(
  result: SelectorHistoryRead,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, {
        decisions: result.decisions,
        ...(result.nextAfter === undefined
          ? {}
          : { nextAfter: result.nextAfter }),
      });
}

/** One turn as the wire carries it, dropping the fields a pod has not measured. */
function threadTurnBody(turn: ThreadTurnRecord): unknown {
  return {
    turn: turn.turn,
    ordinal: turn.ordinal,
    inputKind: turn.inputKind,
    state: turn.state,
    input: turn.input,
    ...(turn.result === undefined ? {} : { result: turn.result }),
    ...(turn.failure === undefined ? {} : { failure: turn.failure }),
    ...(turn.measured === undefined
      ? {}
      : {
          model: turn.measured.model,
          tokens: turn.measured.tokens,
          costMicros: turn.measured.costMicros,
          durationMs: turn.measured.durationMs,
          tools: turn.measured.tools,
        }),
    ...(turn.batchFirst === undefined ? {} : { batchFirst: turn.batchFirst }),
    ...(turn.batchLast === undefined ? {} : { batchLast: turn.batchLast }),
  };
}

export function threadsResponse(result: ThreadsRead): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, { threads: result.threads });
}

export function threadResponse(result: ThreadRead): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, {
        ...result.thread,
        turns: result.turns.map(threadTurnBody),
        ...(result.nextBefore === undefined
          ? {}
          : { nextBefore: result.nextBefore }),
        streams: result.streams,
      });
}

/**
 * Opening a member's thread is idempotent, so the two ways it succeeds are two
 * statuses and one body: a member who already had one is told they had one
 * rather than told a second was created.
 */
export function openThreadResponse(
  partition: Partition,
  result: ThreadOpening,
): NativeHttpResponse {
  if (result.result === "NotFound")
    return response(404, nativeHttpError("NotFound", "Resource not found."));
  return response(result.result === "Opened" ? 201 : 200, result.thread, {
    location: resourcePath(partition, "threads", result.thread.session),
  });
}

/**
 * The message door's refusals, each naming which one it met: `NotYourThread` is
 * `403` rather than `404` because the thread is one this member may read, and
 * the honest answer is that it is not theirs to write to. `ThreadTurnTooLarge`
 * names its ceiling because what overflowed is the project's own context rather
 * than anything the member can shorten.
 */
export function threadMessageResponse(
  result: ThreadMessageSent,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "NotYourThread":
      return response(
        403,
        nativeHttpError("NotYourThread", "The thread is not yours to write."),
      );
    case "Closed":
      return response(
        409,
        nativeHttpError("ThreadClosed", "The thread takes no more turns."),
      );
    case "Orphaned":
      return response(
        409,
        nativeHttpError("ThreadOrphaned", "The thread has no owner."),
      );
    case "TooLarge":
      return response(400, {
        ...nativeHttpError(
          "ThreadTurnTooLarge",
          "The project's own context and this message do not fit one turn.",
        ),
        charsMax: result.charsMax,
      });
    case "Backlogged":
      return retry(429, result.retryAfterSeconds, "ThreadBacklogged");
    case "Sent":
    case "AlreadySent":
      return response(202, { turn: result.turn, ordinal: result.ordinal });
  }
}
