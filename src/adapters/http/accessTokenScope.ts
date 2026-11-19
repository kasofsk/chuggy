/**
 * Where an access token may act: in its own token's project, under its own
 * token's access, and nowhere else. Its maker may be authorized far more
 * widely, and whoever holds the token holds the maker, so the token is
 * confined to the project its row names and to what its access admits.
 *
 * A TOKEN NEVER DOES WHAT CHUGGY KEEPS FOR A PERSON AT THE KEYBOARD. Whatever
 * its access, it answers no evaluation approval, merges no pull request, sets
 * neither the lead's settings nor placement, because nothing unattended
 * merges, approves or steers on text the work under review may have written.
 * The approval is refused where it is answered, `ApproverNotAPerson`; the rest
 * are `Refused` here. A dispatch is its maker's own, and `Write` admits it.
 *
 * EVERY AUTHENTICATED ROUTE IS CLASSIFIED HERE, by name and method. `Read`
 * admits every read a session may make of its own project except the two
 * streams, so no admitted request outlives a deletion of the token; `Write`
 * admits those and every write a session may make there. `Refused` is
 * everything else: the person's own routes, every route addressed to no
 * project, and the project's own tokens. A `Public` route is one the
 * authentication hook passes over.
 *
 * THE TABLE IS EXHAUSTIVE OVER THE ROUTE TABLE, so a route named there without
 * a class is a compile error, and a method or path served without an entry
 * here is refused at run time. `HEAD` is admitted as `GET` is. The project and
 * access compared are the ones the token authority answered, never ones the
 * request carries.
 */

import type { AccessTokenAccess } from "../../contract/accessToken.ts";
import { nativeHttpRoutes, type NativeHttpRoute } from "../../contract/http.ts";
import type { AccessTokenBearerIdentity } from "../../interpreter/accessToken.ts";
import type { SessionBearerMethod } from "./sessionBearerScope.ts";

/** What one served method admits a token to: a read, a write, or nothing. */
export type AccessTokenMethodClass = AccessTokenAccess | "Refused";

/** One route's class: public, or a class for each method it is served under. */
export type AccessTokenRouteClass =
  | "Public"
  | Readonly<Partial<Record<SessionBearerMethod, AccessTokenMethodClass>>>;

const read = { GET: "Read" } as const;
const readWrite = { GET: "Read", POST: "Write" } as const;
const readRefusedWrite = { GET: "Read", POST: "Refused" } as const;
const readRefusedReplace = { GET: "Read", PUT: "Refused" } as const;
const refusedRead = { GET: "Refused" } as const;
const refusedWrite = { POST: "Refused" } as const;
const refusedReplace = { PUT: "Refused" } as const;
const refusedRemove = { DELETE: "Refused" } as const;
const refusedReadWrite = { GET: "Refused", POST: "Refused" } as const;
const refusedReadRemove = { GET: "Refused", DELETE: "Refused" } as const;
const refusedReplaceRemove = { PUT: "Refused", DELETE: "Refused" } as const;

/** Every route in the route table, and what each admits an access token to. */
export const accessTokenRouteClasses = {
  contract: "Public",
  configurationSchema: "Public",
  installation: "Public",
  runnerReleases: "Public",
  workerPoolRegistrations: "Public",
  personalRunnerRegistrations: "Public",
  actionReports: "Public",
  projects: refusedReadWrite,
  projectDeletion: refusedReadRemove,
  tenantDeletion: refusedReadRemove,
  forgeApps: refusedRead,
  forgeAuthorizations: refusedWrite,
  forgeInstallations: refusedRead,
  forgeInstallationRepositories: refusedRead,
  forgeInstallationPermissions: refusedRead,
  workerPoolRegistrationTokens: refusedWrite,
  personalRunnerRegistrationTokens: refusedWrite,
  personalRunnerPermit: refusedRead,
  personalRunner: refusedReadRemove,
  personalRunnerProject: refusedReplaceRemove,
  personalRunnerRunner: refusedRemove,
  personalRunnerMember: refusedRemove,
  agentAccounts: refusedRead,
  agentAccountSettings: refusedReplace,
  agentAccountPresses: refusedWrite,
  agentAccountCredential: refusedRemove,
  agentAccountCredentialOff: refusedReplaceRemove,
  chatHostRegistrationTokens: refusedWrite,
  chatHost: refusedReadRemove,
  chatAbilities: refusedRead,
  chatProjects: refusedRead,
  chatThreads: refusedReadWrite,
  chatThread: refusedRead,
  chatThreadTranscript: refusedRead,
  chatThreadContext: refusedRead,
  chatThreadMessages: refusedWrite,
  chatThreadClose: refusedWrite,
  chatThreadRename: refusedWrite,
  chatThreadHide: refusedWrite,
  chatThreadLive: refusedRead,
  chatThreadTurnStop: refusedWrite,
  project: read,
  tickets: read,
  ticket: read,
  ticketNativeActions: read,
  ticketNativeActionHistory: read,
  ticketActionReach: read,
  configurationHead: read,
  ticketLandings: read,
  ticketTake: { POST: "Write" },
  ticketReturn: { POST: "Write" },
  ticketProposalMerge: refusedWrite,
  landingQueues: read,
  nativeActions: read,
  inbox: read,
  operationalStatus: read,
  selectorSettings: readRefusedReplace,
  selectorSettingsHistory: read,
  executions: read,
  execution: read,
  outputContent: read,
  projectArtifacts: refusedWrite,
  projectArtifact: read,
  runTurns: read,
  runContext: read,
  runTranscript: read,
  runConfiguration: read,
  runError: read,
  operations: { POST: "Write" },
  operation: { GET: "Read", DELETE: "Refused" },
  notifications: read,
  events: refusedRead,
  configurations: read,
  configurationImports: refusedWrite,
  configuration: read,
  forgeCredentials: refusedWrite,
  projectRepositories: readRefusedWrite,
  projectRepositoryLanding: refusedReplace,
  projectRepositoryRetirement: refusedReplace,
  projectRepositoryConfigurations: refusedReplace,
  executionPlacement: readRefusedReplace,
  sessionPlacement: readRefusedReplace,
  ownerFallback: readRefusedReplace,
  hostedRuns: read,
  abilities: read,
  accessTokens: refusedReadWrite,
  accessToken: refusedRemove,
  workerPools: read,
  drafts: readWrite,
  draftInitialization: read,
  draft: { GET: "Read", PUT: "Write", DELETE: "Write" },
  dispatchView: read,
  epics: readWrite,
  epic: read,
  epicHistory: read,
  epicGraph: read,
  threads: readRefusedWrite,
  threadLimit: readRefusedReplace,
  thread: read,
  threadTranscript: read,
  threadContext: read,
  threadMessages: refusedWrite,
  threadTurnStop: refusedWrite,
  threadOfferReplies: refusedWrite,
  threadClose: refusedWrite,
  threadRename: refusedWrite,
  threadHide: refusedWrite,
  threadLive: refusedRead,
} as const satisfies Readonly<Record<NativeHttpRoute, AccessTokenRouteClass>>;

/** Each served method and path, keyed as `METHOD /path`, and its class, with every public route left out. */
export const accessTokenMethodClasses: ReadonlyMap<
  string,
  AccessTokenMethodClass
> = new Map(
  Object.entries(accessTokenRouteClasses).flatMap(([name, classed]) =>
    classed === "Public"
      ? []
      : Object.entries(
          classed as Readonly<Record<string, AccessTokenMethodClass>>,
        ).map(
          ([method, admitted]) =>
            [
              `${method} ${nativeHttpRoutes[name as NativeHttpRoute]}`,
              admitted,
            ] as const,
        ),
  ),
);

/**
 * What the authentication hook does with one token on one route. `ReadOnly`
 * is a write in the token's own project under a token that may only read.
 */
export type AccessTokenAdmission =
  "Admitted" | "OtherPartition" | "ReadOnly" | "Refused";

/** What a token is confined by: its project, and what it may do there. */
export type AccessTokenConfinement = Pick<
  AccessTokenBearerIdentity,
  "partition" | "access"
>;

/**
 * Whether a token confined as `token` may reach the route a request
 * matched. `url` is the matched route's pattern and `params` what the router
 * read out of the path, so nothing here parses the request line.
 */
export function accessTokenAdmission(
  token: AccessTokenConfinement,
  method: string,
  url: string | undefined,
  params: unknown,
): AccessTokenAdmission {
  if (url === undefined) return "Refused";
  const served = method === "HEAD" ? "GET" : method;
  const admitted = accessTokenMethodClasses.get(`${served} ${url}`);
  if (
    admitted === undefined ||
    admitted === "Refused" ||
    typeof params !== "object" ||
    params === null
  )
    return "Refused";
  const named = params as Readonly<Record<string, unknown>>;
  if (
    typeof named["tenant"] !== "string" ||
    typeof named["project"] !== "string"
  )
    return "Refused";
  if (
    named["tenant"] !== token.partition.tenant ||
    named["project"] !== token.partition.project
  )
    return "OtherPartition";
  return admitted === "Write" && token.access === "Read"
    ? "ReadOnly"
    : "Admitted";
}
