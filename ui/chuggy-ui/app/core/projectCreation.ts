/**
 * Creating a project: what each name may be, and what one answer came to, in a
 * line short enough to sit under the form.
 *
 * The name rule is the wire's own schema, so this only spares the reader a
 * round trip to be told what the api would refuse anyway.
 */

import type { z } from "zod";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  projectNameCharsMax,
  projectNameSchema,
} from "../../../../src/contract/requests.ts";
import type { projectCreationSchema } from "../../../../src/contract/requests.ts";
import type { ProjectCreatedResponse } from "../../../../src/contract/responses.ts";

import type { ApiResult } from "./apiRequest.ts";

export type ProjectCreationForm = z.infer<typeof projectCreationSchema>;

/** The form's own address, outside every partition because it makes one. */
export const projectCreationRoutePath = "/projects/new";

export const projectNameCharsFault = "Letters, digits and -";
export const projectNameLengthFault = "Too long";

/** Why one name cannot be sent, or nothing while it is empty, which the submit
 * being unavailable already says. */
export function projectCreationNameFault(name: string): string | undefined {
  if (name === "") return undefined;
  if (name.length > projectNameCharsMax) return projectNameLengthFault;
  return projectNameSchema.safeParse(name).success
    ? undefined
    : projectNameCharsFault;
}

/** Whether both names are ones the api takes. */
export function projectCreationSendable(form: ProjectCreationForm): boolean {
  return (
    projectNameSchema.safeParse(form.tenant).success &&
    projectNameSchema.safeParse(form.project).success
  );
}

export type ProjectCreationOutcome =
  | { readonly outcome: "Created"; readonly partition: PartitionIdentity }
  | { readonly outcome: "Refused"; readonly status: string };

function projectCreationConflict(code: string): string {
  switch (code) {
    case "TenantTaken":
      return "Name taken";
    case "ProjectExists":
      return "Project exists";
    default:
      return "Conflict";
  }
}

function projectCreationRejected(code: string): string {
  switch (code) {
    case "TenantNameInvalid":
    case "ProjectNameInvalid":
      return projectNameCharsFault;
    case "TenantNameReserved":
      return "Reserved";
    default:
      return "Refused";
  }
}

/** What one creation came to. A `200` replay is a creation too, because the
 * project it names stands and is the caller's. */
export function projectCreationOutcome(
  result: ApiResult<ProjectCreatedResponse>,
): ProjectCreationOutcome {
  switch (result.outcome) {
    case "Ok":
      return { outcome: "Created", partition: result.value };
    case "Conflict":
      return {
        outcome: "Refused",
        status: projectCreationConflict(result.code),
      };
    case "Rejected":
      return {
        outcome: "Refused",
        status: projectCreationRejected(result.code),
      };
    case "Absent":
    case "Retryable":
      return { outcome: "Refused", status: "Unavailable" };
    case "Unauthenticated":
      return { outcome: "Refused", status: "Not signed in" };
    case "Fault":
      return { outcome: "Refused", status: "Failed" };
    case "Unreachable":
      return { outcome: "Refused", status: "Unreachable" };
    case "Unreadable":
      return { outcome: "Refused", status: "Unreadable" };
  }
}
