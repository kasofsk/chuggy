/**
 * Creating a repository on the forge and binding it here: what the form must
 * carry, and what the one answer came to.
 *
 * A creation reports every step it took because a step that did not take leaves
 * a repository that stands, so a refusal is one line and a success is several.
 */

import type { z } from "zod";

import { errorEnvelopeSchema } from "../../../../src/contract/http.ts";
import { forgeApps } from "../../../../src/contract/rosters.ts";
import type {
  ForgeAppName,
  ForgeRepositoryVisibilityName,
} from "../../../../src/contract/rosters.ts";
import { projectRepositoryCreateSchema } from "../../../../src/contract/requests.ts";
import type {
  ProjectRepositoryCreatedResponse,
  ProjectRepositoryRulesetResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiResult } from "./apiRequest.ts";
import {
  repositoryConfigurationsStatus,
  repositoryRefusalStatus,
} from "./projectRepositories.ts";

/** What the dialog holds, which is the body the route takes and nothing else. */
export type RepositoryCreateForm = z.infer<
  typeof projectRepositoryCreateSchema
>;

/**
 * Why the name cannot be sent, decided by the wire's own field rather than by a
 * rule spelled a second time here. The api is the authority on what a name may
 * be; this only spares the reader a round trip to be told so.
 */
export function repositoryCreateNameFault(name: string): string | undefined {
  return projectRepositoryCreateSchema.shape.name.safeParse(name).success
    ? undefined
    : "Empty";
}

/** One of the two visibilities, as a person reads it. */
export function repositoryVisibilityLabel(
  visibility: ForgeRepositoryVisibilityName,
): string {
  switch (visibility) {
    case "private":
      return "Private";
    case "public":
      return "Public";
  }
}

/** What reserving the new repository's default branch came to. */
export function repositoryRulesetStatus(
  ruleset: ProjectRepositoryRulesetResponse,
): string {
  switch (ruleset.result) {
    case "Created":
      return "Created";
    case "Refused":
      return `Refused · ${ruleset.message}`;
    case "Skipped":
      return "Skipped";
    case "Unavailable":
      return "Unavailable";
  }
}

function envelopeMessage(body: unknown): string | undefined {
  const parsed = errorEnvelopeSchema.safeParse(body);
  return parsed.success ? parsed.data.error.message : undefined;
}

/**
 * WHICH APP THE ACCOUNT IS MISSING IS READ OUT OF THE PROSE. The envelope
 * carries a code and a message and nothing else, so the roster's own words are
 * what the message is searched for, and a message naming none is drawn bare.
 */
function repositoryMissingStatus(body: unknown): string {
  const message = envelopeMessage(body);
  const app: ForgeAppName | undefined =
    message === undefined
      ? undefined
      : forgeApps.find((named) => message.includes(named));
  return app === undefined ? "Missing" : `Missing: ${app}`;
}

/** The refusals a create earns that a bind does not, each in its own words. */
function repositoryCreateRejected(code: string, body: unknown): string {
  switch (code) {
    case "InstallationMissing":
      return repositoryMissingStatus(body);
    case "PersonalAccountCreatesOnGitHub":
      return "Create on GitHub, then add";
    case "ForgeRefused":
      return `Refused · ${envelopeMessage(body) ?? "a step"}`;
    case "RepositoryNotInstalled":
      return "Not installed";
    default:
      return "Refused";
  }
}

function repositoryCreateConflict(code: string): string {
  switch (code) {
    case "RepositoryExists":
      return "Exists — add it";
    case "RepositoryBound":
      return "Bound elsewhere";
    default:
      return "Conflict";
  }
}

export type RepositoryCreateOutcome =
  | {
      readonly outcome: "Created";
      readonly created: ProjectRepositoryCreatedResponse;
    }
  | { readonly outcome: "Refused"; readonly status: string };

/**
 * What one create came to. The route finishes by binding what it made, so the
 * bind's own refusals arrive here too and are drawn in the bind's words.
 */
export function repositoryCreateOutcome(
  result: ApiResult<ProjectRepositoryCreatedResponse>,
): RepositoryCreateOutcome {
  if (result.outcome === "Ok")
    return { outcome: "Created", created: result.value };
  if (result.outcome === "Rejected")
    return {
      outcome: "Refused",
      status: repositoryCreateRejected(result.code, result.body),
    };
  if (result.outcome === "Conflict")
    return {
      outcome: "Refused",
      status: repositoryCreateConflict(result.code),
    };
  return { outcome: "Refused", status: repositoryRefusalStatus(result) };
}

/** One thing a create did, and what it came to. */
export interface RepositoryCreatedRow {
  readonly label: string;
  readonly detail: string;
}

/** Every step the create took, in the order it took them. */
export function repositoryCreatedRows(
  created: ProjectRepositoryCreatedResponse,
): readonly RepositoryCreatedRow[] {
  return [
    { label: "Seed", detail: created.seeded ? "Seeded" : "Not seeded" },
    { label: "Ruleset", detail: repositoryRulesetStatus(created.ruleset) },
    {
      label: "Configurations",
      detail: repositoryConfigurationsStatus(created.configurations),
    },
  ];
}
