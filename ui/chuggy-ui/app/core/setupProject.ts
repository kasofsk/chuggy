/**
 * `project`: one project made in a workspace, under the sign-in the program
 * holds, by the request the console's New project form sends.
 *
 * The address is the one given, or else the one the name makes by the form's
 * own derivation, and the name and the address are held to the form's own
 * rules before anything is sent, so what the form would not send is refused in
 * the form's words with nothing asked of the site. A refusal from the site is
 * said in the form's words for it too. The site answers the person who made a
 * project asking for it again with that project, under any operation, so a run
 * tried again after an answer that never arrived makes no second one. The one
 * write its ports let through is that request.
 */

import { nativeHttpRoutes } from "../../../../src/contract/http.ts";

import type { ApiFailure } from "./apiRequest.ts";
import { apiCreateProject } from "./apiRoutes.ts";
import { base64urlFromBytes } from "./base64url.ts";
import type { Copy } from "./copy.ts";
import { operationIdBytesCount } from "./operationFollow.ts";
import {
  projectCreationAddress,
  projectCreationNameFault,
  projectCreationRefusalLabel,
  projectDisplayNameFault,
} from "./projectCreation.ts";
import type { SetupAsked } from "./setupArguments.ts";
import type { SetupPorts } from "./setupPorts.ts";
import type { SetupProjectEnded, SetupReport } from "./setupReport.ts";
import { setupRunnerAtNamed, setupWritePorts } from "./setupRunner.ts";
import type { SetupRunnerEntered } from "./setupRunner.ts";

export type SetupProjectAsked = Extract<
  SetupAsked,
  { readonly asked: "Project" }
>;

/** The one write `project` makes. */
export const setupProjectWrites: readonly string[] = [
  `POST ${nativeHttpRoutes.projects}`,
];

/** Why the form would not send this name and address, or nothing where it would. */
export function setupProjectFault(
  name: string,
  address: string,
): Copy | undefined {
  const named = projectDisplayNameFault(name);
  if (named !== undefined) return named;
  if (address === "") return { id: "project-creation-address-none" };
  return projectCreationNameFault(address);
}

/** Whether the same request could be answered otherwise if sent again: where the site did not answer it, and not where it answered and this copy could not read what. */
function setupProjectAgain(failure: ApiFailure): boolean {
  switch (failure.outcome) {
    case "Absent":
    case "Retryable":
    case "Fault":
    case "Unreachable":
      return true;
    case "Conflict":
    case "Rejected":
    case "Unauthenticated":
    case "Unreadable":
      return false;
  }
}

async function setupProjectSent(
  ports: SetupPorts,
  asked: SetupProjectAsked,
  session: Extract<SetupRunnerEntered, { readonly entered: "In" }>["session"],
  address: string,
): Promise<SetupProjectEnded> {
  const result = await apiCreateProject(
    setupWritePorts(session.api, session.bearer, setupProjectWrites),
    { tenant: asked.workspace, project: address, name: asked.name },
    base64urlFromBytes(ports.drawBytes(operationIdBytesCount)),
  );
  if (result.outcome === "Ok")
    return {
      ended: "Made",
      project: result.value.project,
      name: result.value.name,
    };
  return {
    ended: "Refused",
    refusal: projectCreationRefusalLabel(result),
    again: setupProjectAgain(result),
  };
}

/** Makes the project where the sign-in was entered, and otherwise answers the report that says why it was not. */
export async function setupProject(
  ports: SetupPorts,
  asked: SetupProjectAsked,
  entered: SetupRunnerEntered,
): Promise<SetupReport> {
  if (entered.entered === "Out") return entered.report;
  const { workspace, name } = asked;
  const given = asked.answers.project;
  const address = projectCreationAddress({ name, address: given });
  const fault = setupProjectFault(name, address);
  const ended: SetupProjectEnded =
    fault === undefined
      ? await setupProjectSent(ports, asked, entered.session, address)
      : { ended: "Refused", refusal: fault, again: false };
  return {
    report: "Project",
    site: entered.session.site,
    ...setupRunnerAtNamed({ workspace, project: given }, entered.session),
    name,
    ended,
  };
}
