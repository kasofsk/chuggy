/**
 * Creating a project: what each name may be, the address a project's name
 * makes, the workspace the form's address may start it on, which press repeats
 * the last, and what a refusal came to, in a line short enough to sit under
 * the form.
 *
 * The name rules are the wire's own schemas, so this only spares the reader a
 * round trip to be told what the api would refuse anyway.
 *
 * THE ADDRESS FOLLOWS THE NAME UNTIL IT IS EDITED. While the reader has typed
 * none, the address is the one the name makes; once they have, it is what they
 * typed, whatever the name becomes. A name that makes none asks for one.
 */

import type { z } from "zod";

import {
  projectDisplayNameCharsMax,
  projectDisplayNameSchema,
  projectNameCharsMax,
  projectNameSchema,
} from "../../../../src/contract/requests.ts";
import type { projectCreationSchema } from "../../../../src/contract/requests.ts";

import type { ApiFailure } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";

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
export const projectNameRule: Copy = { id: "project-creation-name-rule" };
export const projectNameLengthFault: Copy = {
  id: "project-creation-name-too-long",
};

/** What a project's name is held to before anything is typed, and what one
 * the wire would refuse is refused as. */
export const projectDisplayNameRule: Copy = {
  id: "project-creation-display-name-rule",
};
export const projectDisplayNameControlFault: Copy = {
  id: "project-creation-display-name-control",
};

/** What a project is called, and the address it was given where the reader
 * typed one rather than taking the one the name makes. */
export interface ProjectCreationNaming {
  readonly name: string;
  readonly address?: string | undefined;
}

/**
 * The address a name makes: lowercased, each run of anything but a letter or a
 * digit one hyphen, none leading or trailing, and cut to the longest address
 * without leaving one trailing. Empty where the name has no letter or digit.
 */
export function projectAddressOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, projectNameCharsMax)
    .replace(/-+$/u, "");
}

/** The address the project will have: the one typed, or the one its name makes. */
export function projectCreationAddress(naming: ProjectCreationNaming): string {
  return naming.address ?? projectAddressOf(naming.name);
}

/** Whether the address is asked for in a box of its own: once it is edited,
 * and while a name that makes none is typed. */
export function projectCreationAddressAsked(
  naming: ProjectCreationNaming,
): boolean {
  return (
    naming.address !== undefined ||
    (naming.name.trim() !== "" && projectAddressOf(naming.name) === "")
  );
}

/** What the line under the name says: its fault, the address it makes, that
 * it makes none, or before anything is typed, the rule. */
export function projectCreationNameLine(naming: ProjectCreationNaming): {
  readonly line: Copy;
  readonly fault: boolean;
} {
  const fault = projectDisplayNameFault(naming.name);
  if (fault !== undefined) return { line: fault, fault: true };
  if (naming.name.trim() === "")
    return { line: projectDisplayNameRule, fault: false };
  const address = projectCreationAddress(naming);
  return address === ""
    ? { line: { id: "project-creation-address-none" }, fault: false }
    : {
        line: { id: "project-creation-address-made", args: { address } },
        fault: false,
      };
}

/** Why a project's name cannot be sent, or nothing while it is empty, which
 * the submit being unavailable already says. */
export function projectDisplayNameFault(name: string): Copy | undefined {
  const trimmed = name.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > projectDisplayNameCharsMax)
    return projectNameLengthFault;
  return projectDisplayNameSchema.safeParse(name).success
    ? undefined
    : projectDisplayNameControlFault;
}

/** What a workspace name the contract reserves is refused as. */
export const tenantNameReservedFault: Copy = {
  id: "project-creation-tenant-reserved",
};

/** What a workspace nobody holds is refused as, to a reader who may make none. */
export const tenantCreationRefusedLine: Copy = {
  id: "project-creation-tenant-needs-invite",
};

/** Why one name cannot be sent, or nothing while it is empty, which the submit
 * being unavailable already says. */
export function projectCreationNameFault(name: string): Copy | undefined {
  if (name === "") return undefined;
  if (name.length > projectNameCharsMax) return projectNameLengthFault;
  return projectNameSchema.safeParse(name).success
    ? undefined
    : projectNameRule;
}

/** Whether every name is one the api takes. */
export function projectCreationSendable(form: ProjectCreationForm): boolean {
  return (
    projectNameSchema.safeParse(form.tenant).success &&
    projectNameSchema.safeParse(form.project).success &&
    projectDisplayNameSchema.safeParse(form.name).success
  );
}

/** What the last press sent: its names, and the operation identity they went
 * under. */
export interface ProjectCreationSent {
  readonly fields: ProjectCreationForm;
  readonly operation: string;
}

/** What was sent, while the form still holds its names: a press then repeats
 * it under its identity, and any other names go under a new one. */
export function projectCreationStanding(
  sent: ProjectCreationSent | undefined,
  fields: ProjectCreationForm,
): ProjectCreationSent | undefined {
  return sent?.fields.tenant === fields.tenant &&
    sent.fields.project === fields.project &&
    sent.fields.name === fields.name
    ? sent
    : undefined;
}

function projectCreationConflict(code: string): Copy {
  switch (code) {
    case "TenantTaken":
      return { id: "project-creation-refusal-taken" };
    case "ProjectExists":
      return { id: "project-creation-refusal-exists" };
    default:
      return { id: "project-creation-refusal-conflict" };
  }
}

function projectCreationRejected(code: string): Copy {
  switch (code) {
    case "TenantNameInvalid":
    case "ProjectNameInvalid":
      return projectNameRule;
    case "ProjectDisplayNameInvalid":
      return projectDisplayNameControlFault;
    case "TenantNameReserved":
      return tenantNameReservedFault;
    case "TenantCreationNotPermitted":
      return tenantCreationRefusedLine;
    default:
      return { id: "project-creation-refusal-refused" };
  }
}

/** The one short line a refused creation is drawn as. */
export function projectCreationRefusalLabel(failure: ApiFailure): Copy {
  switch (failure.outcome) {
    case "Conflict":
      return projectCreationConflict(failure.code);
    case "Rejected":
      return projectCreationRejected(failure.code);
    case "Absent":
    case "Retryable":
      return { id: "project-creation-refusal-unavailable" };
    case "Unauthenticated":
      return { id: "project-creation-refusal-not-signed-in" };
    case "Fault":
      return { id: "project-creation-refusal-failed" };
    case "Unreachable":
      return { id: "project-creation-refusal-unreachable" };
    case "Unreadable":
      return { id: "project-creation-refusal-unreadable" };
  }
}
