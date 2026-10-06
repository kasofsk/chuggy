/**
 * What a system outside this one reports of a declared action: who a report is
 * taken from, what it says, and the recording of it through ports this module
 * only declares.
 *
 * A REPORTER IS CONFIGURATION. A deployment names each one in a roster: the
 * scheme it proves itself by, the file its secret is in, the project it
 * reports to and the actions it may report.
 *
 * AN ACTION HAS AT MOST ONE REPORTER. What an action did is one line of
 * history, and two reporters would each write their own account into it. It is
 * also what lets the address a report is sent to say which scheme reads it.
 *
 * A SIGNING KEY IS ONE REPORTER'S AND ONE ACTION'S. A signature over the body
 * alone says nothing of where its request was sent, so a reporter proving
 * itself by one is named for a single action, and the file its key is in is
 * named by no other reporter. Another that signs would have its events verify
 * at both addresses. One that presents its secret as a bearer presents it
 * whole on every request, so whoever holds or sees it could sign with it,
 * where a signing key is never presented. A file is told from another by its
 * path as written.
 *
 * A REPORTER IS ANSWERED AS ITS CLAIMS AND NOT AS A YES. Whether it may report
 * the action a request names is decided here from the claims, so a scheme
 * whose claims come from what a request carries is held to the rule a
 * rostered one is.
 *
 * NOTHING IS SAID TO A REQUEST THAT DID NOT VERIFY. An action no reporter is
 * named for and a secret that does not verify are `NotFound`, and so is a
 * report of an action no repository declares. Only a verified reporter is told
 * its request was refused or held no report, and it is told before the
 * declaration is asked for, so neither answer says the action is declared. An
 * action a reporter is named for costs a file read and a digest that one
 * nobody is named for does not, so the two are told apart by how long the
 * answer takes and by nothing in it.
 */

import { z } from "zod";

import { actionDocumentSchema } from "../contract/actionDocument.ts";
import type { ActionReportDocument } from "../contract/actionReport.ts";
import {
  isBoundedText,
  nativeHttpPathSegmentCharsMax,
} from "../contract/http.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { GitObjectId } from "./finalizer.ts";
import { asProjectId, asTenantId, type Partition } from "./projectStore.ts";
import type { RepositoryActionId } from "./repositoryAction.ts";
import { repositoryDeclarationsMax } from "./repositoryDeclaration.ts";

declare const actionReporterNameBrand: unique symbol;

/** The name a reporter's observations are recorded under. */
export type ActionReporterName = string & {
  readonly [actionReporterNameBrand]: true;
};

/** How a reporter proves a request is its own. */
export const allActionReporterSchemes = [
  "BearerSecret",
  "FluxSignature",
] as const;
export type ActionReporterScheme = (typeof allActionReporterSchemes)[number];

/** The most reporters one deployment names. */
export const actionReportersMax = 64;

/** The most actions one reporter is named for, which is as many as one repository declares. */
export const actionReporterActionsMax = repositoryDeclarationsMax;

/** The longest name a reporter is recorded under. */
export const actionReporterNameCharsMax = 128;

/** The longest path a secret file is named by. */
export const actionReporterSecretFileCharsMax = 4_096;

/** What a reporter may say: the project it reports to and the actions it may report there. */
export interface ActionReporterClaims {
  readonly reporter: ActionReporterName;
  readonly partition: Partition;
  readonly actions: readonly RepositoryActionId[];
}

/** One reporter as a deployment names it. */
export interface ActionReporter {
  readonly claims: ActionReporterClaims;
  readonly scheme: ActionReporterScheme;
  readonly secretFile: string;
}

export type ActionReporterRosterRead =
  | { readonly read: "Roster"; readonly reporters: readonly ActionReporter[] }
  | { readonly read: "Refused"; readonly why: string };

function actionReporterRosterText(charsMax: number) {
  return z.string().refine((value) => isBoundedText(value, charsMax));
}

const actionReporterRosterSchema = z
  .array(
    z.strictObject({
      reporter: actionReporterRosterText(actionReporterNameCharsMax),
      scheme: z.enum(allActionReporterSchemes),
      secretFile: actionReporterRosterText(actionReporterSecretFileCharsMax),
      tenant: actionReporterRosterText(nativeHttpPathSegmentCharsMax),
      project: actionReporterRosterText(nativeHttpPathSegmentCharsMax),
      actions: z
        .array(actionDocumentSchema.shape.action)
        .max(actionReporterActionsMax),
    }),
  )
  .max(actionReportersMax);

function actionReporterRosterRefused(why: string): ActionReporterRosterRead {
  return { read: "Refused", why };
}

type ActionReporterRosterEntry = z.infer<
  typeof actionReporterRosterSchema
>[number];

/** Why a roster is refused where the reporter `other` names the file the key of the signing reporter `signing` is in, said without the path. */
function actionReporterKeyShared(signing: string, other: string): string {
  return `names the secret file of the FluxSignature reporter ${signing} for the reporter ${other} as well`;
}

/** Why a roster every entry of which is well formed is refused, or nothing. */
function actionReporterRosterBroken(
  entries: readonly ActionReporterRosterEntry[],
): string | undefined {
  const reported = new Set<string>();
  const keyed = new Map<string, ActionReporterRosterEntry>();
  for (const entry of entries) {
    if (entry.scheme === "FluxSignature" && entry.actions.length !== 1)
      return `names the FluxSignature reporter ${entry.reporter} for other than one action`;
    for (const action of entry.actions) {
      const identity = JSON.stringify([entry.tenant, entry.project, action]);
      if (reported.has(identity))
        return `names the action ${action} of ${entry.tenant}/${entry.project} twice`;
      reported.add(identity);
    }
    const sharing = keyed.get(entry.secretFile);
    if (sharing === undefined) keyed.set(entry.secretFile, entry);
    else if (sharing.scheme === "FluxSignature")
      return actionReporterKeyShared(sharing.reporter, entry.reporter);
    else if (entry.scheme === "FluxSignature")
      return actionReporterKeyShared(entry.reporter, sharing.reporter);
  }
  return undefined;
}

/** Reads a deployment's roster without reading its files. */
export function actionReporterRoster(
  encoded: string,
): ActionReporterRosterRead {
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch {
    return actionReporterRosterRefused("is not JSON");
  }
  const parsed = actionReporterRosterSchema.safeParse(decoded);
  if (!parsed.success)
    return actionReporterRosterRefused(
      `is not a roster of reporters at ${JSON.stringify(parsed.error.issues[0]?.path ?? [])}`,
    );
  const broken = actionReporterRosterBroken(parsed.data);
  if (broken !== undefined) return actionReporterRosterRefused(broken);
  return {
    read: "Roster",
    reporters: parsed.data.map((entry) => ({
      claims: {
        reporter: entry.reporter as ActionReporterName,
        partition: {
          tenant: asTenantId(entry.tenant),
          project: asProjectId(entry.project),
        },
        actions: entry.actions.map((action) => action as RepositoryActionId),
      },
      scheme: entry.scheme,
      secretFile: entry.secretFile,
    })),
  };
}

/** What one request presented: the address it was sent to, as written, and what it carried. */
export interface ActionReportRequest {
  readonly tenant: string;
  readonly project: string;
  readonly action: string;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly body: Uint8Array;
}

export type ActionReportOutcome = ActionReportDocument["outcome"];

/** What an action did at one commit, as its reporter said it and by its reporter's clock. */
export interface ActionReport {
  readonly commit: GitObjectId;
  readonly outcome: ActionReportOutcome;
  readonly observedAtMs?: number;
  readonly detail?: string;
  readonly link?: string;
}

/**
 * What a verified request says: a report, a body its scheme reads as saying
 * nothing an action's history holds, or a body no report can be read from.
 */
export type ActionReportSaid =
  | { readonly said: "Report"; readonly report: ActionReport }
  | { readonly said: "Ignored" }
  | { readonly said: "Refused" };

/** The reporter one request verified as, and what it said. */
export interface ActionReporterVerified {
  readonly claims: ActionReporterClaims;
  readonly said: ActionReportSaid;
}

export interface ActionReporterPort {
  /** Answers one request with the claims of the reporter it verifies as, or with nothing. */
  verified(
    request: ActionReportRequest,
  ): Promise<ActionReporterVerified | undefined>;
}

/** What one scheme makes of a request, under one reporter's secret. */
export interface ActionReporterSchemePort {
  /** What the request says where it verifies under the secret the file holds, and nothing where it does not. */
  said(
    secretFile: string,
    request: ActionReportRequest,
  ): Promise<ActionReportSaid | undefined>;
}

/** The schemes a deployment verifies by. One it holds no adapter for verifies nothing. */
export type ActionReporterSchemes = Readonly<
  Partial<Record<ActionReporterScheme, ActionReporterSchemePort>>
>;

/** The action a request names, where these claims cover the address it was sent to. */
function actionReportClaimed(
  claims: ActionReporterClaims,
  request: ActionReportRequest,
): RepositoryActionId | undefined {
  if (
    claims.partition.tenant !== request.tenant ||
    claims.partition.project !== request.project
  )
    return undefined;
  return claims.actions.find((action) => action === request.action);
}

/** The reporters of a roster: the one named for the action a request addresses is the only one it is verified as. */
export function rosterActionReporters(
  reporters: readonly ActionReporter[],
  schemes: ActionReporterSchemes,
): ActionReporterPort {
  return {
    verified: async (request) => {
      const reporter = reporters.find(
        ({ claims }) => actionReportClaimed(claims, request) !== undefined,
      );
      if (reporter === undefined) return undefined;
      const said = await schemes[reporter.scheme]?.said(
        reporter.secretFile,
        request,
      );
      return said === undefined ? undefined : { claims: reporter.claims, said };
    },
  };
}

/** One report as it is recorded: the action, who reported it, and what they said. */
export interface ActionObservation {
  readonly partition: Partition;
  readonly action: RepositoryActionId;
  readonly reporter: ActionReporterName;
  readonly report: ActionReport;
}

/**
 * What recording one observation came to. `Repeated` is a report whose commit
 * and outcome the action's newest observation already holds, and `Undeclared`
 * an action no repository the project binds declares; neither writes a row.
 */
export type ActionObservationRecorded = "Recorded" | "Repeated" | "Undeclared";

export interface ActionObservationStore {
  record(observation: ActionObservation): Promise<ActionObservationRecorded>;
}

export interface ActionReportPorts {
  readonly reporters: ActionReporterPort;
  readonly observations: ActionObservationStore;
}

/**
 * What one request came to. `Ignored` and `Refused` are each a verified
 * reporter's body, and `Unavailable` is a row that could not be written.
 */
export type ActionReported =
  | { readonly result: "Recorded" }
  | { readonly result: "Repeated" }
  | { readonly result: "Ignored" }
  | { readonly result: "NotFound" }
  | { readonly result: "Refused" }
  | { readonly result: "Unavailable" };

export interface ActionReports {
  report(request: ActionReportRequest): Promise<ActionReported>;
}

async function actionReportsRecorded(
  observations: ActionObservationStore,
  observation: ActionObservation,
): Promise<ActionReported> {
  let recorded: ActionObservationRecorded;
  try {
    recorded = await observations.record(observation);
  } catch {
    return { result: "Unavailable" };
  }
  switch (recorded) {
    case "Recorded":
    case "Repeated":
      return { result: recorded };
    case "Undeclared":
      return { result: "NotFound" };
    default:
      return assertNever(recorded);
  }
}

/** Records what a verified reporter says of an action it may report, and asks the store nothing where it says no report. */
export function actionReports(ports: ActionReportPorts): ActionReports {
  return {
    report: async (request) => {
      const verified = await ports.reporters.verified(request);
      if (verified === undefined) return { result: "NotFound" };
      const action = actionReportClaimed(verified.claims, request);
      if (action === undefined) return { result: "NotFound" };
      const { said } = verified;
      switch (said.said) {
        case "Ignored":
        case "Refused":
          return { result: said.said };
        case "Report":
          return actionReportsRecorded(ports.observations, {
            partition: verified.claims.partition,
            action,
            reporter: verified.claims.reporter,
            report: said.report,
          });
        default:
          return assertNever(said);
      }
    },
  };
}
