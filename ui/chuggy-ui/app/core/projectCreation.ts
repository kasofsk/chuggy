/**
 * Creating a project: what each name may be, the workspace the form's address
 * may start it on, which press repeats the last, and what a refusal came to,
 * in a line short enough to sit under the form.
 *
 * The name rule is the wire's own schema, so this only spares the reader a
 * round trip to be told what the api would refuse anyway.
 */

import type { z } from "zod";

import {
  projectNameCharsMax,
  projectNameSchema,
} from "../../../../src/contract/requests.ts";
import type { projectCreationSchema } from "../../../../src/contract/requests.ts";

import type { ApiFailure } from "./apiRequest.ts";

export type ProjectCreationForm = z.infer<typeof projectCreationSchema>;

/** The form's own address, outside every partition because it makes one. */
export const projectCreationRoutePath = "/projects/new";

/** What the form's address says about where it starts: on no workspace, or
 * on the one it names. */
export interface ProjectCreationQuery {
  readonly workspace?: string | undefined;
}

/** The workspace the address names, read off the query the router parsed. The
 * key is answered even where it names none, because the router lays this over
 * the query as parsed and a key left out would stand as it was parsed. */
export function projectCreationQueryOf(
  search: Readonly<Record<string, unknown>>,
): ProjectCreationQuery {
  const named = projectNameSchema.safeParse(search["workspace"]);
  return { workspace: named.success ? named.data : undefined };
}

/** A name as the router writes text into a query: quoted where it would
 * otherwise be read back as a number or a word of JSON. */
function projectCreationQueryText(name: string): string {
  try {
    JSON.parse(name);
  } catch {
    return name;
  }
  return JSON.stringify(name);
}

/** The form's address starting on one workspace. */
export function projectCreationPathIn(workspace: string): string {
  return `${projectCreationRoutePath}?workspace=${encodeURIComponent(projectCreationQueryText(workspace))}`;
}

/** The name rule as the form states it under each field before anything is
 * typed, and as it states a name that breaks it. */
export const projectNameRule = "Lowercase letters, digits, inner hyphens";
export const projectNameLengthFault = "Too long";

/** What a workspace name the contract reserves is refused as. */
export const tenantNameReservedFault = "Reserved";

/** What a workspace nobody holds is refused as, to a reader who may make none. */
export const tenantCreationRefusedLine = "New workspace needs an invite link";

/** Why one name cannot be sent, or nothing while it is empty, which the submit
 * being unavailable already says. */
export function projectCreationNameFault(name: string): string | undefined {
  if (name === "") return undefined;
  if (name.length > projectNameCharsMax) return projectNameLengthFault;
  return projectNameSchema.safeParse(name).success
    ? undefined
    : projectNameRule;
}

/** Whether both names are ones the api takes. */
export function projectCreationSendable(form: ProjectCreationForm): boolean {
  return (
    projectNameSchema.safeParse(form.tenant).success &&
    projectNameSchema.safeParse(form.project).success
  );
}

/** What the last press sent: its two names, and the operation identity they
 * went under. */
export interface ProjectCreationSent {
  readonly fields: ProjectCreationForm;
  readonly operation: string;
}

/** What was sent, while the form still holds its two names: a press then
 * repeats it under its identity, and any other names go under a new one. */
export function projectCreationStanding(
  sent: ProjectCreationSent | undefined,
  fields: ProjectCreationForm,
): ProjectCreationSent | undefined {
  return sent?.fields.tenant === fields.tenant &&
    sent.fields.project === fields.project
    ? sent
    : undefined;
}

function projectCreationConflict(code: string): string {
  switch (code) {
    case "TenantTaken":
      return "Taken";
    case "ProjectExists":
      return "Exists";
    default:
      return "Conflict";
  }
}

function projectCreationRejected(code: string): string {
  switch (code) {
    case "TenantNameInvalid":
    case "ProjectNameInvalid":
      return projectNameRule;
    case "TenantNameReserved":
      return tenantNameReservedFault;
    case "TenantCreationNotPermitted":
      return tenantCreationRefusedLine;
    default:
      return "Refused";
  }
}

/** The one short line a refused creation is drawn as. */
export function projectCreationRefusal(failure: ApiFailure): string {
  switch (failure.outcome) {
    case "Conflict":
      return projectCreationConflict(failure.code);
    case "Rejected":
      return projectCreationRejected(failure.code);
    case "Absent":
    case "Retryable":
      return "Unavailable";
    case "Unauthenticated":
      return "Not signed in";
    case "Fault":
      return "Failed";
    case "Unreachable":
      return "Unreachable";
    case "Unreadable":
      return "Unreadable";
  }
}
