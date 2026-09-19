import { z } from "zod";

import { assertNever } from "../../domain/assertNever.ts";
import type { ProjectInventoryPage } from "../../interpreter/nativeWeb.ts";
import {
  type LeadRead,
  type LeadTranscriptRead,
  type LeadTurnRecord,
} from "../../interpreter/leadRead.ts";
import type { SessionStoreEntry } from "../../interpreter/sessionTranscript.ts";
import type {
  ThreadClosing,
  ThreadHiding,
  ThreadMessageSent,
  ThreadOpening,
  ThreadRead,
  ThreadRenaming,
  ThreadTurnRecord,
  ThreadsRead,
} from "../../interpreter/threadRead.ts";
import { ProjectAccessUnavailable } from "../../interpreter/projectAccess.ts";
import type { ForgeCredentialMinted } from "../../interpreter/forgeCredentials.ts";
import type {
  WorkerPoolTokenMinted,
  WorkerPoolTokenRedeemed,
} from "../../interpreter/workerPoolRegistrationToken.ts";
import type {
  ForgeAppsResult,
  ForgeInstallationClaimResult,
  ForgeInstallationsResult,
  ForgeRepositoriesResult,
  ProjectRepositoriesResult,
  ProjectRepositoryBindResult,
  ProjectRepositoryCreateResult,
  ProjectRepositoryLandingResult,
  ProjectRepositoryRetirementResult,
} from "../../interpreter/repositoryOnboarding.ts";
import type { Partition, TenantId } from "../../interpreter/projectStore.ts";
import type { ThreadMessageRefusalCode } from "../../contract/rosters.ts";
import type {
  LeadInquiriesRead,
  LeadInquiryAsked,
  LeadInquiryRead,
} from "../../interpreter/leadInquiry.ts";
import { nativeHttpError, nativeHttpMediaType } from "../../contract/http.ts";
import { encodeInventoryCursor } from "./contract.ts";
import { encodeProjectInventoryResponse } from "./codecs.ts";

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

/** The most issues one refusal renders, a body of bad fields being one finding repeated. */
export const invalidRequestIssuesMax = 8;

/** The longest reason one refusal carries, so a raised message cannot become the body. */
export const invalidRequestReasonCharsMax = 1_024;

/** One issue as a caller reads it, a root-level one having no field to name. */
function invalidRequestIssueLine(issue: z.core.$ZodIssue): string {
  const at = issue.path.join(".");
  return at.length === 0 ? issue.message : `${at}: ${issue.message}`;
}

/** Why a shape fault was refused, in the fault's own words, or nothing where it has none. */
function invalidRequestReason(failure: unknown): string | undefined {
  const stated =
    failure instanceof z.ZodError
      ? failure.issues
          .slice(0, invalidRequestIssuesMax)
          .map(invalidRequestIssueLine)
          .join("\n")
      : failure instanceof RangeError
        ? failure.message
        : "";
  const points = [...stated];
  if (points.length === 0) return undefined;
  return points.slice(0, invalidRequestReasonCharsMax).join("");
}

function invalidRequest(status: number, reason?: string): NativeHttpResponse {
  return response(
    status,
    nativeHttpError("InvalidRequest", reason ?? "The request is invalid."),
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

/**
 * A project authority this server could not reach is this server failing, and
 * a caller is told to wait rather than told they may not.
 */
export function failureResponse(failure: unknown): NativeHttpResponse {
  if (failure instanceof ProjectAccessUnavailable)
    return retry(503, authorityRetryAfterSeconds, "AuthorityUnavailable");
  const status = transportFaultStatus(failure);
  if (status === 413)
    return response(
      413,
      nativeHttpError("BodyTooLarge", "The request body is too large."),
    );
  if (status !== undefined) return invalidRequest(status);
  if (requestShapeFault(failure))
    return invalidRequest(400, invalidRequestReason(failure));
  return response(
    500,
    nativeHttpError("InternalError", "The request could not be completed."),
  );
}

/** How long a caller is told to wait before asking an unreachable authority again. */
export const authorityRetryAfterSeconds = 1;

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

export function forgeCredentialResponse(
  result: ForgeCredentialMinted,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Unavailable":
      return retry(503, authorityRetryAfterSeconds, "ForgeUnavailable");
    case "Authorized":
      return response(200, {
        token: result.value.token,
        expiresAtMs: result.value.expiresAtMs,
      });
    default:
      return assertNever(result);
  }
}

/**
 * A registration token, answered once and never readable again: only its digest
 * is stored, so a caller that loses this answer mints another.
 */
export function workerPoolTokenResponse(
  result: WorkerPoolTokenMinted,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "Minted":
      return response(201, {
        token: result.value.token,
        expiresAtMs: result.value.expiresAtMs,
      });
    default:
      return assertNever(result);
  }
}

/**
 * A redemption, answered with the client and its secret once. A capability the
 * token does not permit is named rather than folded into `NotFound`, because it
 * is the one refusal here an operator can act on.
 */
export function workerPoolRedemptionResponse(
  result: WorkerPoolTokenRedeemed,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "CapabilityNotPermitted":
      return response(
        403,
        nativeHttpError(
          "CapabilityNotPermitted",
          "The registration token does not permit every capability declared.",
        ),
      );
    case "Registered":
      return response(201, {
        clientId: result.value.clientId,
        clientSecret: result.value.clientSecret,
      });
    default:
      return assertNever(result);
  }
}

/** The path one tenant-scoped resource is addressed by, beside `resourcePath`'s. */
function tenantResourcePath(
  tenant: TenantId,
  collection: string,
  identity: string,
): string {
  return [
    "/api/v1/tenants",
    encodeURIComponent(tenant),
    collection,
    encodeURIComponent(identity),
  ].join("/");
}

/** A resource that is not found, which every refused permit in this file answers with. */
function notFound(): NativeHttpResponse {
  return response(404, nativeHttpError("NotFound", "Resource not found."));
}

/**
 * A deployment holding no key for the app asked about has no app to describe
 * rather than one it is hiding, so that is 404 and not a refusal. A forge that
 * could not be reached is a wait instead.
 */
function forgeNotConfigured(): NativeHttpResponse {
  return response(
    404,
    nativeHttpError(
      "ForgeNotConfigured",
      "This deployment names no such forge app.",
    ),
  );
}

/** Every app this deployment holds a key for, which onboarding installs all of. */
export function forgeAppsResponse(result: ForgeAppsResult): NativeHttpResponse {
  switch (result.result) {
    case "Apps":
      return response(200, { apps: result.apps });
    case "NotConfigured":
      return forgeNotConfigured();
    case "Unavailable":
      return retry(503, authorityRetryAfterSeconds, "ForgeUnavailable");
    default:
      return assertNever(result);
  }
}

/**
 * A claim. The first one is created at its own address; a claim of the same
 * installation replays as it stands; an account another tenant holds is a
 * conflict, because the claim exists and is not this caller's to move.
 */
export function forgeInstallationClaimResponse(
  tenant: TenantId,
  result: ForgeInstallationClaimResult,
): NativeHttpResponse {
  switch (result.result) {
    case "Claimed":
      return response(201, result.installation, {
        location: tenantResourcePath(
          tenant,
          "forge-installations",
          result.installation.installationId,
        ),
      });
    case "AlreadyClaimed":
      return response(200, result.installation);
    case "ClaimedElsewhere":
      return response(
        409,
        nativeHttpError(
          "InstallationClaimed",
          "The installation is claimed by another tenant.",
        ),
      );
    case "InstallationUnknown":
      return response(
        404,
        nativeHttpError(
          "InstallationUnknown",
          "The installation is not one of this app's.",
        ),
      );
    case "NotConfigured":
      return forgeNotConfigured();
    case "NotFound":
      return notFound();
    case "Unavailable":
      return retry(503, authorityRetryAfterSeconds, "ForgeUnavailable");
    default:
      return assertNever(result);
  }
}

/** Every installation one tenant holds. */
export function forgeInstallationsResponse(
  result: ForgeInstallationsResult,
): NativeHttpResponse {
  return result.result === "Installations"
    ? response(200, {
        installations: result.installations,
        truncated: result.truncated,
      })
    : notFound();
}

/** What one installation grants, and whether the listing is all of it. */
export function forgeRepositoriesResponse(
  result: ForgeRepositoriesResult,
): NativeHttpResponse {
  switch (result.result) {
    case "Repositories":
      return response(200, {
        repositories: result.repositories,
        truncated: result.truncated,
      });
    case "NotConfigured":
      return forgeNotConfigured();
    case "NotFound":
      return notFound();
    case "Unavailable":
      return retry(503, authorityRetryAfterSeconds, "ForgeUnavailable");
    default:
      return assertNever(result);
  }
}

/**
 * A binding. A repository no claimed installation grants is refused as the
 * request's own fault rather than as a missing resource, because the caller may
 * see the project and the repository both; an epoch that moved under the
 * request is a wait, because the same request will land once it is read again.
 */
export function projectRepositoryBindResponse(
  partition: Partition,
  result: ProjectRepositoryBindResult,
): NativeHttpResponse {
  switch (result.result) {
    case "Bound":
      return response(
        201,
        {
          repository: result.repository,
          landing: result.landing,
        },
        {
          location: resourcePath(partition, "repositories", result.repository),
        },
      );
    case "AlreadyBound":
      return response(200, { repository: result.repository });
    case "NotInstalled":
      return response(
        422,
        nativeHttpError(
          "RepositoryNotInstalled",
          "No claimed installation grants the repository.",
        ),
      );
    case "OperationConflict":
      return response(
        409,
        nativeHttpError(
          "OperationConflict",
          "The operation identity names a different request.",
        ),
      );
    case "BoundElsewhere":
      return response(
        409,
        nativeHttpError(
          "RepositoryBound",
          "The repository is bound to another project.",
        ),
      );
    case "EpochChanged":
      return retry(503, authorityRetryAfterSeconds, "RecoveryEpochChanged");
    case "NotFound":
      return notFound();
    case "Unavailable":
      return retry(503, authorityRetryAfterSeconds, "ForgeUnavailable");
    default:
      return assertNever(result);
  }
}

/**
 * A creation. A repository the forge made and then refused something about is
 * the request's own fault and not a missing resource: the caller may see the
 * project and the account both, the refusal names how far it got so the bind
 * route can finish what this one started, and a name already taken is a
 * conflict pointing at that same route.
 */
export function projectRepositoryCreateResponse(
  partition: Partition,
  result: ProjectRepositoryCreateResult,
): NativeHttpResponse {
  switch (result.result) {
    case "Created":
      return response(
        201,
        {
          repository: result.repository,
          landing: result.landing,
          created: result.created,
          seeded: result.seeded,
          ruleset: result.ruleset,
        },
        {
          location: resourcePath(partition, "repositories", result.repository),
        },
      );
    case "InstallationMissing":
      return response(
        422,
        nativeHttpError(
          "InstallationMissing",
          `This tenant has claimed no ${result.app} installation on the account.`,
        ),
      );
    case "PersonalAccountCreatesOnGitHub":
      return response(
        422,
        nativeHttpError(
          "PersonalAccountCreatesOnGitHub",
          "Create the repository on the forge and bind it here.",
        ),
      );
    case "RepositoryExists":
      return response(
        409,
        nativeHttpError(
          "RepositoryExists",
          "The account already has a repository of that name; bind it here instead.",
        ),
      );
    case "ForgeRefused":
      return response(
        422,
        nativeHttpError(
          "ForgeRefused",
          `The forge refused the ${result.step}: ${result.message}`,
        ),
      );
    case "BindRefused":
      return projectRepositoryBindResponse(partition, result.bind);
    case "NotConfigured":
      return forgeNotConfigured();
    case "NotFound":
      return notFound();
    case "Unavailable":
      return retry(503, authorityRetryAfterSeconds, "ForgeUnavailable");
    default:
      return assertNever(result);
  }
}

/** Every repository one project binds, oldest first, which privileges none of them. */
export function projectRepositoriesResponse(
  result: ProjectRepositoriesResult,
): NativeHttpResponse {
  return result.result === "Repositories"
    ? response(200, { repositories: result.repositories })
    : notFound();
}

/**
 * One landing moved. A conflict answers the binding as it stands rather than a
 * bare code, because the writer's next act is to read it again; a repository
 * this project does not bind is the same miss as a project the caller may not
 * see, which is what every refused permit here answers.
 */
export function projectRepositoryLandingResponse(
  result: ProjectRepositoryLandingResult,
): NativeHttpResponse {
  switch (result.result) {
    case "Written":
      return response(200, { repository: result.repository });
    case "LandingMoved":
      return response(409, {
        ...nativeHttpError(
          "RepositoryLandingMoved",
          "The repository's landing is not the one this write was made against.",
        ),
        repository: result.repository,
      });
    case "NotBound":
    case "NotFound":
      return notFound();
    case "Unavailable":
      return retry(
        503,
        authorityRetryAfterSeconds,
        "RepositoryLandingContended",
      );
    default:
      return assertNever(result);
  }
}

/**
 * One binding retired, answering the row as it now stands: a caller reads the
 * retirement off the answer rather than asking for the listing again. A repeat
 * is the same answer, because retirement has one direction and no second
 * value, and a repository this project does not bind is the same miss as a
 * project the caller may not see.
 */
export function projectRepositoryRetirementResponse(
  result: ProjectRepositoryRetirementResult,
): NativeHttpResponse {
  switch (result.result) {
    case "Retired":
      return response(200, { repository: result.repository });
    case "NotBound":
    case "NotFound":
      return notFound();
    case "Unavailable":
      return retry(
        503,
        authorityRetryAfterSeconds,
        "RepositoryRetirementContended",
      );
    default:
      return assertNever(result);
  }
}

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
        ...(result.lead.agentReference === undefined
          ? {}
          : { agentReference: result.lead.agentReference }),
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
 * Closing a thread is idempotent and terminal, so both ways it succeeds are one
 * status and the entry as it now stands: a caller pressing twice is told the
 * thread is closed, which is what they asked. A session that is no thread of
 * this project's is not found, as every thread read answers it.
 */
export function closeThreadResponse(result: ThreadClosing): NativeHttpResponse {
  if (result.result === "NotFound")
    return response(404, nativeHttpError("NotFound", "Resource not found."));
  return response(200, result.thread);
}

/**
 * Renaming is the owner's alone, so a caller pressing another member's thread
 * meets the same refusal the message door answers a stale mailbox with.
 * Idempotent otherwise: a caller is given the thread they wrote rather than
 * sent to read it again.
 */
export function renameThreadResponse(
  result: ThreadRenaming,
): NativeHttpResponse {
  if (result.result === "NotFound")
    return response(404, nativeHttpError("NotFound", "Resource not found."));
  if (result.result === "NotYourThread")
    return response(
      403,
      nativeHttpError(
        threadMessageRefusalCode.NotYourThread,
        "The thread is not yours to rename.",
      ),
    );
  return response(200, result.thread);
}

/**
 * Hiding is the owner's alone, so a caller pressing another member's thread
 * meets the same refusal the message door answers a stale mailbox with.
 */
export function hideThreadResponse(result: ThreadHiding): NativeHttpResponse {
  if (result.result === "NotFound")
    return response(404, nativeHttpError("NotFound", "Resource not found."));
  if (result.result === "NotYourThread")
    return response(
      403,
      nativeHttpError(
        threadMessageRefusalCode.NotYourThread,
        "The thread is not yours to hide.",
      ),
    );
  return response(200, result.thread);
}

/**
 * Which code each of the door's refusals answers with, as one record over the
 * roster the console reads. It is a record rather than six literals at the call
 * sites so the compiler is what holds the two ends together: a code renamed on
 * one side of the wire and not the other is the failure the roster exists to
 * stop, and a literal is a rename nothing notices.
 */
const threadMessageRefusalCode: Readonly<
  Record<
    Exclude<ThreadMessageSent["result"], "NotFound" | "Sent" | "AlreadySent">,
    ThreadMessageRefusalCode
  >
> = {
  NotYourThread: "NotYourThread",
  Closed: "ThreadClosed",
  TooLarge: "ThreadTurnTooLarge",
  Backlogged: "ThreadBacklogged",
};

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
        nativeHttpError(
          threadMessageRefusalCode.NotYourThread,
          "The thread is not yours to write.",
        ),
      );
    case "Closed":
      return response(
        409,
        nativeHttpError(
          threadMessageRefusalCode.Closed,
          "The thread takes no more turns.",
        ),
      );
    case "TooLarge":
      return response(400, {
        ...nativeHttpError(
          threadMessageRefusalCode.TooLarge,
          "The project's own context and this message do not fit one turn.",
        ),
        charsMax: result.charsMax,
      });
    case "Backlogged":
      return retry(
        429,
        result.retryAfterSeconds,
        threadMessageRefusalCode.Backlogged,
      );
    case "Sent":
    case "AlreadySent":
      return response(202, { turn: result.turn, ordinal: result.ordinal });
  }
}

/**
 * The lead's inquiries, and one of them. `NotFound` covers both a project the
 * caller may not read and a session that is not an inquiry of this project's
 * lead, because a member who may not read the project is owed neither fact and
 * a session that is not this lead's fork is not a resource at all.
 */
export function leadInquiriesResponse(
  result: LeadInquiriesRead,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, { inquiries: result.inquiries });
}

export function leadInquiryResponse(
  result: LeadInquiryRead,
): NativeHttpResponse {
  return result.result === "NotFound"
    ? response(404, nativeHttpError("NotFound", "Resource not found."))
    : response(200, result.inquiry);
}

/**
 * The ask door's refusals, each naming which one it met; `InquiriesInFlight` is
 * `409` and carries no `retry-after`, because a retry cannot succeed until one
 * of the asker's own inquiries settles. Asking is idempotent on the two
 * identities the caller minted, so its two successes are one status and one
 * body — a retry is told the ordinal it has, not that a second fork was opened.
 */
export function askLeadResponse(
  partition: Partition,
  result: LeadInquiryAsked,
): NativeHttpResponse {
  switch (result.result) {
    case "NotFound":
    case "NoLead":
      return response(404, nativeHttpError("NotFound", "Resource not found."));
    case "LeadNotStarted":
      return response(
        409,
        nativeHttpError(
          "LeadNotStarted",
          "The lead has taken no turn there is a transcript to fork.",
        ),
      );
    case "LeadClosed":
      return response(
        409,
        nativeHttpError("LeadClosed", "The lead takes no more turns."),
      );
    case "InFlight":
      return response(
        409,
        nativeHttpError(
          "InquiriesInFlight",
          "Your own inquiries are unanswered.",
        ),
      );
    case "Asked":
    case "AlreadyAsked":
      return response(
        202,
        {
          session: result.session,
          turn: result.turn,
          ordinal: result.ordinal,
        },
        {
          location: resourcePath(partition, "lead/inquiries", result.session),
        },
      );
  }
}
