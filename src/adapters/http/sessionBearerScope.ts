/**
 * Where a session bearer may act: in its own session's partition, under its
 * own session's capabilities, and nowhere else. Its principal may be
 * authorized far more widely than the session is — a lead's is the site's one
 * selector identity, a developer on every project with a lead — and whoever
 * holds the bearer holds that principal, so the bearer is confined to the
 * partition its session row names and to what that row's capabilities admit.
 *
 * EVERY AUTHENTICATED ROUTE IS CLASSIFIED HERE, by name and method. A
 * `Partition` method admits a project's session bearer only where its
 * `:tenant` and `:project` are the session's, and answers any other as an
 * unauthorized read is answered, so a session learns nothing of a project it
 * cannot reach. A `Member` method admits a member's own session bearer only
 * where its `:tenant` is the session's and the session's partition is the one
 * reserved for its own principal there: what it reads is its owner's, at their
 * tenant, and never a project's door. Each refuses the other scope's bearer
 * outright, so a member's own session reaches no project route and a project's
 * reaches no member route. A `Refused` method never admits one. A `Public`
 * route is one the authentication hook passes over, so no session bearer is
 * read on it; what such a route is presented, it verifies itself.
 *
 * EVERY ADMITTED METHOD REQUIRES A CAPABILITY, one of `requires`, and a session
 * holding none of them is answered as an unauthorized read is. A read of the
 * session's own project requires `ProjectRead`, and of its owner's own
 * `MemberRead`; a read a chuggy tool makes is admitted under that tool's
 * capability too, and a write is admitted under exactly the capabilities whose
 * tools make it, so a write no session's tool makes is `Refused`. So is
 * everything addressed to no partition, and inside one the registration-token
 * mint, because enrolling a machine is provisioning rather than work, as
 * deleting the project is; every write of a personal runner, its allowlist
 * among them;
 * the answer to a lead's held proposal and a reply to a thread's offer, each a
 * person's word on what a session put to them; and every write of a thread or
 * a member's own chat, which is its owner's. The confinement is by route and
 * method, so a route two capabilities' tools write admits either's whole body:
 * a session holding `DraftAuthor` alone may still post a draft no parent bears.
 *
 * THE TABLE IS EXHAUSTIVE OVER THE ROUTE TABLE, so a route named there without
 * a class, or an admitted method without a requirement, is a compile error,
 * and a method or path served without an entry here is refused at run time.
 * The partition and capabilities compared are the ones the session authority
 * answered, never ones the request carries.
 */

import { nativeHttpRoutes, type NativeHttpRoute } from "../../contract/http.ts";
import type { SessionCapability } from "../../contract/rosters.ts";
import {
  memberScopePartition,
  type SessionBearerIdentity,
} from "../../interpreter/agentSession.ts";

/** What one route admits a session bearer to: its own partition, its owner's tenant, or nothing. */
export type SessionBearerRouteScope = "Partition" | "Member" | "Refused";

/** The methods a route is served under, `HEAD` being served wherever `GET` is. */
export type SessionBearerMethod = "GET" | "POST" | "PUT" | "DELETE";

/** The capabilities a session must hold one of to be admitted, never none. */
export type SessionBearerRequirement = readonly [
  SessionCapability,
  ...SessionCapability[],
];

/** What one served method admits a session bearer to: nothing, or its scope's routes under the capabilities it requires. */
export type SessionBearerMethodClass =
  | "Refused"
  | {
      readonly scope: "Partition" | "Member";
      readonly requires: SessionBearerRequirement;
    };

/** One route's class: public, or a class for each method it is served under. */
export type SessionBearerRouteClass =
  | "Public"
  | Readonly<Partial<Record<SessionBearerMethod, SessionBearerMethodClass>>>;

/** A method admitted in the session's own partition to a session holding one of `requires`. */
function sessionBearerPartition(
  ...requires: SessionBearerRequirement
): SessionBearerMethodClass {
  return { scope: "Partition", requires };
}

const partitionRead = { GET: sessionBearerPartition("ProjectRead") } as const;
const memberRead = {
  GET: { scope: "Member", requires: ["MemberRead"] },
} as const satisfies SessionBearerRouteClass;
const refusedWrite = { POST: "Refused" } as const;
const refusedReplace = { PUT: "Refused" } as const;
const readRefusedWrite = { GET: partitionRead.GET, POST: "Refused" } as const;
const readRefusedReplace = { GET: partitionRead.GET, PUT: "Refused" } as const;

/** Every route in the route table, and what each admits a session bearer to. */
export const sessionBearerRouteClasses = {
  contract: "Public",
  configurationSchema: "Public",
  installation: "Public",
  runnerReleases: "Public",
  workerPoolRegistrations: "Public",
  personalRunnerRegistrations: "Public",
  actionReports: "Public",
  projects: { GET: "Refused", POST: "Refused" },
  projectDeletion: { GET: "Refused", DELETE: "Refused" },
  tenantDeletion: { GET: "Refused", DELETE: "Refused" },
  forgeApps: { GET: "Refused" },
  forgeAuthorizations: { POST: "Refused" },
  forgeInstallations: { GET: "Refused" },
  forgeInstallationRepositories: { GET: "Refused" },
  forgeInstallationPermissions: { GET: "Refused" },
  workerPoolRegistrationTokens: { POST: "Refused" },
  personalRunnerRegistrationTokens: { POST: "Refused" },
  personalRunnerPermit: { GET: "Refused" },
  personalRunner: { GET: memberRead.GET, DELETE: "Refused" },
  personalRunnerProject: { PUT: "Refused", DELETE: "Refused" },
  personalRunnerRunner: { DELETE: "Refused" },
  personalRunnerMember: { DELETE: "Refused" },
  agentAccounts: { GET: "Refused" },
  agentAccountSettings: { PUT: "Refused" },
  agentAccountPresses: { POST: "Refused" },
  agentAccountCredential: { DELETE: "Refused" },
  chatHostRegistrationTokens: { POST: "Refused" },
  chatHost: { GET: memberRead.GET, DELETE: "Refused" },
  chatAbilities: memberRead,
  chatProjects: memberRead,
  chatThreads: { GET: memberRead.GET, POST: "Refused" },
  chatThread: memberRead,
  chatThreadTranscript: memberRead,
  chatThreadContext: memberRead,
  chatThreadMessages: refusedWrite,
  chatThreadClose: refusedWrite,
  chatThreadRename: refusedWrite,
  chatThreadHide: refusedWrite,
  chatThreadLive: memberRead,
  chatThreadTurnStop: refusedWrite,
  project: partitionRead,
  tickets: partitionRead,
  ticket: partitionRead,
  ticketNativeActions: partitionRead,
  ticketNativeActionHistory: partitionRead,
  ticketAgenticRefusals: partitionRead,
  ticketActionReach: partitionRead,
  configurationHead: partitionRead,
  ticketLandings: partitionRead,
  landingQueues: partitionRead,
  nativeActions: partitionRead,
  agenticRefusals: partitionRead,
  inbox: partitionRead,
  operationalStatus: partitionRead,
  selectorContext: partitionRead,
  selectorSettings: readRefusedReplace,
  selectorSettingsHistory: partitionRead,
  selectorHistory: partitionRead,
  selectorProposals: partitionRead,
  selectorProposalReview: refusedWrite,
  lead: partitionRead,
  leadTranscript: partitionRead,
  leadContext: partitionRead,
  leadInquiries: readRefusedWrite,
  leadInquiry: partitionRead,
  executions: partitionRead,
  execution: partitionRead,
  outputContent: partitionRead,
  projectArtifacts: refusedWrite,
  projectArtifact: partitionRead,
  runTurns: partitionRead,
  runContext: partitionRead,
  runTranscript: partitionRead,
  runConfiguration: partitionRead,
  runError: partitionRead,
  operations: {
    POST: sessionBearerPartition(
      "DraftAuthor",
      "DraftOriginate",
      "TicketDispatch",
    ),
  },
  operation: { GET: partitionRead.GET, DELETE: "Refused" },
  notifications: partitionRead,
  events: partitionRead,
  configurations: partitionRead,
  configurationImports: refusedWrite,
  configuration: partitionRead,
  forgeCredentials: refusedWrite,
  projectRepositories: readRefusedWrite,
  projectRepositoryLanding: refusedReplace,
  projectRepositoryRetirement: refusedReplace,
  projectRepositoryConfigurations: refusedReplace,
  executionPlacement: readRefusedReplace,
  sessionPlacement: readRefusedReplace,
  ownerFallback: readRefusedReplace,
  hostedRuns: partitionRead,
  abilities: partitionRead,
  workerPools: partitionRead,
  drafts: {
    GET: partitionRead.GET,
    POST: sessionBearerPartition("DraftAuthor", "DraftOriginate"),
  },
  draftInitialization: {
    GET: sessionBearerPartition("ProjectRead", "DraftAuthor"),
  },
  draft: {
    GET: partitionRead.GET,
    PUT: sessionBearerPartition("DraftAuthor"),
    DELETE: sessionBearerPartition("DraftAuthor"),
  },
  dispatchView: {
    GET: sessionBearerPartition("ProjectRead", "TicketDispatch"),
  },
  epics: {
    GET: partitionRead.GET,
    POST: sessionBearerPartition("DraftOriginate"),
  },
  epic: { GET: sessionBearerPartition("ProjectRead", "DraftOriginate") },
  epicHistory: partitionRead,
  epicGraph: partitionRead,
  threads: readRefusedWrite,
  threadLimit: readRefusedReplace,
  thread: partitionRead,
  threadTranscript: partitionRead,
  threadContext: partitionRead,
  threadMessages: refusedWrite,
  threadTurnStop: refusedWrite,
  threadOfferReplies: refusedWrite,
  threadClose: refusedWrite,
  threadRename: refusedWrite,
  threadHide: refusedWrite,
  threadLive: partitionRead,
} as const satisfies Readonly<Record<NativeHttpRoute, SessionBearerRouteClass>>;

/** Each served method and path, keyed as `METHOD /path`, and its class, with every public route left out. */
export const sessionBearerMethodClasses: ReadonlyMap<
  string,
  SessionBearerMethodClass
> = new Map(
  Object.entries(sessionBearerRouteClasses).flatMap(([name, classed]) =>
    classed === "Public"
      ? []
      : Object.entries(
          classed as Readonly<Record<string, SessionBearerMethodClass>>,
        ).map(
          ([method, admitted]) =>
            [
              `${method} ${nativeHttpRoutes[name as NativeHttpRoute]}`,
              admitted,
            ] as const,
        ),
  ),
);

/** The scope of each served method and path, keyed as `sessionBearerMethodClasses` is. */
export const sessionBearerRouteScopes: ReadonlyMap<
  string,
  SessionBearerRouteScope
> = new Map(
  [...sessionBearerMethodClasses].map(
    ([route, admitted]) =>
      [route, admitted === "Refused" ? admitted : admitted.scope] as const,
  ),
);

/**
 * What the authentication hook does with one session bearer on one route.
 * `Unheld` is a route in the session's own scope that requires a capability
 * the session does not hold.
 */
export type SessionBearerAdmission =
  "Admitted" | "OtherPartition" | "Unheld" | "Refused";

/** What a session bearer is confined by: its session's partition, whose that partition is, to whom, and what it may do there. */
export type SessionBearerConfinement = Pick<
  SessionBearerIdentity,
  "partition" | "scope" | "principal" | "capabilities"
>;

/**
 * Whether a session confined as `session` is may reach the route a request
 * matched. `url` is the matched route's pattern and `params` what the router
 * read out of the path, so nothing here parses the request line.
 */
export function sessionBearerAdmission(
  session: SessionBearerConfinement,
  method: string,
  url: string | undefined,
  params: unknown,
): SessionBearerAdmission {
  if (url === undefined) return "Refused";
  const served = method === "HEAD" ? "GET" : method;
  const admitted = sessionBearerMethodClasses.get(`${served} ${url}`);
  if (
    admitted === undefined ||
    admitted === "Refused" ||
    admitted.scope !== sessionBearerAdmissionScope[session.scope] ||
    typeof params !== "object" ||
    params === null
  )
    return "Refused";
  const named = params as Readonly<Record<string, unknown>>;
  if (typeof named["tenant"] !== "string") return "Refused";
  if (admitted.scope === "Partition" && typeof named["project"] !== "string")
    return "Refused";
  const own =
    admitted.scope === "Member"
      ? named["tenant"] === session.partition.tenant &&
        sessionBearerAdmissionOwn(session)
      : named["tenant"] === session.partition.tenant &&
        named["project"] === session.partition.project;
  if (!own) return "OtherPartition";
  return admitted.requires.some((capability) =>
    session.capabilities.includes(capability),
  )
    ? "Admitted"
    : "Unheld";
}

/** The one route scope each session scope may reach. */
const sessionBearerAdmissionScope = {
  Project: "Partition",
  Member: "Member",
} as const satisfies Readonly<
  Record<SessionBearerConfinement["scope"], SessionBearerRouteScope>
>;

/** Whether a member's own session is in the partition reserved for its own principal, which the schema holds and this does not take on trust. */
function sessionBearerAdmissionOwn(session: SessionBearerConfinement): boolean {
  return (
    memberScopePartition(session.partition.tenant, session.principal)
      .project === session.partition.project
  );
}
