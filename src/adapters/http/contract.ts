/** Translates surviving public request shapes into interpreter values. */
import { z } from "zod";
import {
  nativeHttpCursorCharsMax,
  nativeHttpVersion,
  textCodePointsCount,
} from "../../contract/http.ts";
import {
  forgeCredentialRequestSchema,
  forgeInstallationClaimSchema,
  leadInquirySchema,
  projectRepositoryBindSchema,
  projectRepositoryCreateSchema,
  projectRepositoryLandingSchema,
  projectRepositoryRetirementSchema,
  threadHideRequestSchema,
  threadMessageSchema,
  threadRenameRequestSchema,
} from "../../contract/requests.ts";
import {
  asSessionId,
  asSessionTurnId,
  type SessionId,
  type SessionTurnId,
} from "../../interpreter/agentSession.ts";
import type { ForgeCredentialRequest } from "../../interpreter/forgeCredentials.ts";
import {
  asForgeAccount,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
  asForgeRepositoryName,
  type ForgeInstallationId,
} from "../../interpreter/forgeInstallation.ts";
import type {
  ForgeInstallationClaimRequest,
  ProjectRepositoryBindRequest,
  ProjectRepositoryCreateRequest,
} from "../../interpreter/repositoryOnboarding.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import {
  asRepositoryId,
  type RepositoryId,
} from "../../interpreter/finalizer.ts";
import {
  asRepositoryLanding,
  type RepositoryLanding,
} from "../../interpreter/repositoryBinding.ts";

import {
  workerPoolRedemptionSchema,
  workerPoolRegistrationTokenRequestSchema,
  type WorkerPoolRedemptionRequest,
  type WorkerPoolRegistrationTokenRequest,
} from "../../contract/workerPool.ts";

const inventoryCursorSchema = z.strictObject({
  version: z.literal(nativeHttpVersion),
  tenant: z.string(),
  project: z.string(),
});

export function parseForgeCredentialRequest(
  body: unknown,
): ForgeCredentialRequest {
  const parsed = forgeCredentialRequestSchema.parse(body);
  return {
    repository: asRepositoryId(parsed.repository),
    permissions: parsed.permissions,
  };
}

export function parseWorkerPoolTokenRequest(
  body: unknown,
): WorkerPoolRegistrationTokenRequest {
  return workerPoolRegistrationTokenRequestSchema.parse(body);
}

export function parseWorkerPoolRedemption(
  body: unknown,
): WorkerPoolRedemptionRequest {
  return workerPoolRedemptionSchema.parse(body);
}

export function parseForgeInstallationClaim(
  body: unknown,
): ForgeInstallationClaimRequest {
  const parsed = forgeInstallationClaimSchema.parse(body);
  return {
    forge: asForgeId(parsed.forge),
    app: asForgeApp(parsed.app),
    installationId: asForgeInstallationId(parsed.installationId),
  };
}

export function parseForgeInstallationId(value: string): ForgeInstallationId {
  return asForgeInstallationId(value);
}

export function parseProjectRepositoryBind(
  body: unknown,
  operation: string,
): ProjectRepositoryBindRequest {
  const parsed = projectRepositoryBindSchema.parse(body);
  return {
    repository: asRepositoryId(parsed.repository),
    operation: asOperationId(operation),
  };
}

export function parseProjectRepositoryLanding(body: unknown): {
  readonly repository: RepositoryId;
  readonly expected: RepositoryLanding;
  readonly landing: RepositoryLanding;
} {
  const parsed = projectRepositoryLandingSchema.parse(body);
  return {
    repository: asRepositoryId(parsed.repository),
    expected: asRepositoryLanding(parsed.expected.mode),
    landing: asRepositoryLanding(parsed.landing.mode),
  };
}

export function parseProjectRepositoryRetirement(body: unknown): RepositoryId {
  return asRepositoryId(
    projectRepositoryRetirementSchema.parse(body).repository,
  );
}

export function parseProjectRepositoryCreate(
  body: unknown,
  operation: string,
): ProjectRepositoryCreateRequest {
  const parsed = projectRepositoryCreateSchema.parse(body);
  return {
    account: asForgeAccount(parsed.account),
    name: asForgeRepositoryName(parsed.name),
    visibility: parsed.visibility,
    operation: asOperationId(operation),
  };
}

function decodedCursor(value: string): unknown {
  if (
    value.length === 0 ||
    textCodePointsCount(value) > nativeHttpCursorCharsMax
  )
    throw new RangeError("inventory cursor is empty or too long");
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString());
  } catch (cause) {
    throw new RangeError("inventory cursor is not base64url JSON", { cause });
  }
}

export function encodeInventoryCursor(partition: Partition): string {
  return Buffer.from(
    JSON.stringify({
      version: nativeHttpVersion,
      tenant: partition.tenant,
      project: partition.project,
    }),
  ).toString("base64url");
}

export function parseInventoryCursor(value: string): Partition {
  const cursor = inventoryCursorSchema.parse(decodedCursor(value));
  const partition = parsePartition(cursor.tenant, cursor.project);
  if (encodeInventoryCursor(partition) !== value)
    throw new RangeError("inventory cursor is not canonically encoded");
  return partition;
}

export function parsePartition(tenant: string, project: string): Partition {
  return { tenant: asTenantId(tenant), project: asProjectId(project) };
}

export function parseThreadMessage(body: unknown): {
  readonly turn: SessionTurnId;
  readonly message: string;
} {
  const value = threadMessageSchema.parse(body);
  return { turn: asSessionTurnId(value.turn), message: value.message };
}

export function parseThreadRename(body: unknown): { readonly title: string } {
  return { title: threadRenameRequestSchema.parse(body).title };
}
export function parseThreadHide(body: unknown): { readonly hidden: boolean } {
  return { hidden: threadHideRequestSchema.parse(body).hidden };
}

export function parseLeadInquiry(body: unknown): {
  readonly session: SessionId;
  readonly turn: SessionTurnId;
  readonly question: string;
} {
  const value = leadInquirySchema.parse(body);
  return {
    session: asSessionId(value.session),
    turn: asSessionTurnId(value.turn),
    question: value.question,
  };
}
