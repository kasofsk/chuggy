/**
 * Which of the form's fields a refused creation is about, so the refusal is
 * drawn under that field: the workspace for a workspace taken, reserved,
 * misnamed or not the reader's to make, the project's address for one that
 * exists or is misnamed, and its name for one the wire refuses. A refusal
 * about none, or a creation that was never answered, names no field and is
 * drawn beside the submit.
 */

import type { ApiFailure } from "./apiRequest.ts";
import type { ProjectCreationForm } from "./projectCreation.ts";

export type ProjectCreationField = keyof ProjectCreationForm;

export function projectCreationRefusalField(
  failure: ApiFailure | undefined,
): ProjectCreationField | undefined {
  if (failure === undefined) return undefined;
  if (failure.outcome !== "Conflict" && failure.outcome !== "Rejected")
    return undefined;
  switch (failure.code) {
    case "TenantTaken":
    case "TenantNameInvalid":
    case "TenantNameReserved":
    case "TenantCreationNotPermitted":
      return "tenant";
    case "ProjectExists":
    case "ProjectNameInvalid":
      return "project";
    case "ProjectDisplayNameInvalid":
      return "name";
    default:
      return undefined;
  }
}
