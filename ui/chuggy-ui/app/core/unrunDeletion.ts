/**
 * Deleting a project that never ran work, or a workspace that holds no
 * project: what holds either, in the console's words, and a deletion refused
 * because something does taken as the holding it names rather than a failure.
 */

import {
  deletionHeldCode,
  projectDeletionResponseSchema,
  tenantDeletionResponseSchema,
} from "../../../../src/contract/responses.ts";
import type {
  ProjectDeletionResponse,
  TenantDeletionResponse,
} from "../../../../src/contract/responses.ts";
import type { ApiResult } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";

export type ProjectDeletionHolding = ProjectDeletionResponse["held"][number];
export type TenantDeletionHolding = TenantDeletionResponse["held"][number];
export type UnrunDeletionHolding =
  ProjectDeletionHolding | TenantDeletionHolding;

function unrunDeletionHoldingCopy(holding: UnrunDeletionHolding): Copy {
  switch (holding) {
    case "ReleasedTicket":
      return { id: "settings-delete-held-released-ticket" };
    case "Execution":
      return { id: "settings-delete-held-execution" };
    case "Session":
      return { id: "settings-delete-held-session" };
    case "WorkerPool":
      return { id: "settings-delete-held-worker-pool" };
    case "ActionObservation":
      return { id: "settings-delete-held-action-observation" };
    case "Project":
      return { id: "settings-delete-held-project" };
    case "PersonalRunner":
      return { id: "settings-delete-held-personal-runner" };
    case "ChatHost":
      return { id: "settings-delete-held-chat-host" };
  }
}

/** Why it cannot be deleted, naming each thing that holds it; nothing where nothing does. */
export function unrunDeletionHeldCopy(
  held: readonly UnrunDeletionHolding[],
): Copy | undefined {
  const named = held
    .map(unrunDeletionHoldingCopy)
    .reduceRight<Copy | undefined>(
      (rest, lead) =>
        rest === undefined
          ? lead
          : { id: "settings-delete-held-joined", args: { lead, rest } },
      undefined,
    );
  return named === undefined
    ? undefined
    : { id: "settings-delete-held", args: { held: named } };
}

/** What a deletion answered: nothing held where it deleted, and what holds it
 * where it was refused as a conflict naming that. */
export function unrunDeletionAnswered<Held>(
  result: ApiResult<undefined>,
  parsed: (body: unknown) => { readonly held: readonly Held[] } | undefined,
): ApiResult<readonly Held[]> {
  if (result.outcome === "Ok") return { outcome: "Ok", value: [] };
  if (result.outcome === "Conflict" && result.code === deletionHeldCode) {
    const held = parsed(result.body);
    if (held !== undefined) return { outcome: "Ok", value: held.held };
  }
  return result;
}

/** The holding a refusal's body names beside its error. */
function unrunDeletionHeldOf<Held>(
  body: unknown,
  held: { safeParse: (value: unknown) => { success: boolean; data?: Held[] } },
): { readonly held: readonly Held[] } | undefined {
  if (typeof body !== "object" || body === null || !("held" in body))
    return undefined;
  const parsed = held.safeParse(body.held);
  return parsed.success && parsed.data !== undefined
    ? { held: parsed.data }
    : undefined;
}

export function projectDeletionHeldParsed(
  body: unknown,
): { readonly held: readonly ProjectDeletionHolding[] } | undefined {
  return unrunDeletionHeldOf(body, projectDeletionResponseSchema.shape.held);
}

export function tenantDeletionHeldParsed(
  body: unknown,
): { readonly held: readonly TenantDeletionHolding[] } | undefined {
  return unrunDeletionHeldOf(body, tenantDeletionResponseSchema.shape.held);
}
