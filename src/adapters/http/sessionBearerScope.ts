/**
 * Where a session bearer may act: in its own session's partition, and nowhere
 * else. Its principal may be authorized far more widely than the session is —
 * a lead's is the site's one selector identity, a developer on every project
 * with a lead — and whoever holds the bearer holds that principal, so the
 * bearer is confined to the partition its session row names.
 *
 * EVERY AUTHENTICATED ROUTE IS CLASSIFIED HERE, by name and method. A
 * `Partition` route admits a project's session bearer only where its `:tenant`
 * and `:project` are the session's, and answers any other as an unauthorized
 * read is answered, so a session learns nothing of a project it cannot reach.
 * A `Member` route admits a member's own session bearer only where its
 * `:tenant` is the session's and the session's partition is the one reserved
 * for its own principal there: what it reads is its owner's, at their tenant,
 * and never a project's door. Each class refuses the other scope's bearer
 * outright, so a member's own session reaches no project route and a project's
 * reaches no member route. A `Refused` route never admits one: everything else
 * not addressed to one partition, and inside one the registration-token mint,
 * because enrolling a machine is provisioning rather than work — which is also
 * why every personal runner write is refused, its allowlist among them, and why
 * a member's thread limit is read but never set, a session widening the cap on
 * sessions — and the answer to a lead's held proposal, because the hold is
 * there for a person to answer and the lead's session holds a bearer. Every
 * write of a member's own chat is refused too, because its session reads and
 * its owner writes. A `Public` route is one the authentication hook passes
 * over, so no session bearer is read on it; what such a route is presented, it
 * verifies itself.
 *
 * THE TABLE IS EXHAUSTIVE OVER THE ROUTE TABLE, so a route named there without
 * a class is a compile error, and a method or path served without an entry
 * here is refused at run time. The partition compared is the one the session
 * authority answered, never one the request carries.
 */

import { nativeHttpRoutes, type NativeHttpRoute } from "../../contract/http.ts";
import {
  memberScopePartition,
  type SessionBearerIdentity,
} from "../../interpreter/agentSession.ts";

/** What one route admits a session bearer to: its own partition, its owner's tenant, or nothing. */
export type SessionBearerRouteScope = "Partition" | "Member" | "Refused";

/** The methods a route is served under, `HEAD` being served wherever `GET` is. */
export type SessionBearerMethod = "GET" | "POST" | "PUT" | "DELETE";

/** One route's class: public, or a scope for each method it is served under. */
export type SessionBearerRouteClass =
  | "Public"
  | Readonly<Partial<Record<SessionBearerMethod, SessionBearerRouteScope>>>;

const partitionRead = { GET: "Partition" } as const;
const partitionWrite = { POST: "Partition" } as const;
const partitionReplace = { PUT: "Partition" } as const;
const memberRead = { GET: "Member" } as const;
const memberWrite = { POST: "Refused" } as const;

/** Every route in the route table, and what each admits a session bearer to. */
export const sessionBearerRouteClasses = {
  contract: "Public",
  configurationSchema: "Public",
  installation: "Public",
  workerPoolRegistrations: "Public",
  personalRunnerRegistrations: "Public",
  actionReports: "Public",
  projects: { GET: "Refused", POST: "Refused" },
  forgeApps: { GET: "Refused" },
  forgeAuthorizations: { POST: "Refused" },
  forgeInstallations: { GET: "Refused" },
  forgeInstallationRepositories: { GET: "Refused" },
  forgeInstallationPermissions: { GET: "Refused" },
  workerPoolRegistrationTokens: { POST: "Refused" },
  personalRunnerRegistrationTokens: { POST: "Refused" },
  personalRunnerPermit: { GET: "Refused" },
  personalRunner: { GET: "Member", DELETE: "Refused" },
  personalRunnerProject: { PUT: "Refused", DELETE: "Refused" },
  personalRunnerRunner: { DELETE: "Refused" },
  personalRunnerMember: { DELETE: "Refused" },
  chatHostRegistrationTokens: { POST: "Refused" },
  chatHost: { GET: "Member", DELETE: "Refused" },
  chatAbilities: memberRead,
  chatProjects: memberRead,
  chatThreads: { GET: "Member", POST: "Refused" },
  chatThread: memberRead,
  chatThreadTranscript: memberRead,
  chatThreadMessages: memberWrite,
  chatThreadClose: memberWrite,
  chatThreadRename: memberWrite,
  chatThreadHide: memberWrite,
  chatThreadLive: memberRead,
  chatThreadTurnStop: memberWrite,
  project: partitionRead,
  tickets: partitionRead,
  ticket: partitionRead,
  ticketNativeActions: partitionRead,
  ticketAgenticRefusals: partitionRead,
  ticketActionReach: partitionRead,
  configurationHead: partitionRead,
  ticketLandings: partitionRead,
  nativeActions: partitionRead,
  agenticRefusals: partitionRead,
  operationalStatus: partitionRead,
  selectorContext: partitionRead,
  selectorSettings: { GET: "Partition", PUT: "Partition" },
  selectorSettingsHistory: partitionRead,
  selectorHistory: partitionRead,
  selectorProposals: partitionRead,
  selectorProposalReview: { POST: "Refused" },
  lead: partitionRead,
  leadTranscript: partitionRead,
  leadInquiries: { GET: "Partition", POST: "Partition" },
  leadInquiry: partitionRead,
  executions: partitionRead,
  execution: partitionRead,
  outputContent: partitionRead,
  projectArtifacts: partitionWrite,
  projectArtifact: partitionRead,
  runTurns: partitionRead,
  runTranscript: partitionRead,
  runConfiguration: partitionRead,
  runError: partitionRead,
  operations: partitionWrite,
  operation: { GET: "Partition", DELETE: "Partition" },
  notifications: partitionRead,
  events: partitionRead,
  configurations: partitionRead,
  configurationImports: partitionWrite,
  configuration: partitionRead,
  forgeCredentials: partitionWrite,
  projectRepositories: { GET: "Partition", POST: "Partition" },
  projectRepositoryLanding: partitionReplace,
  projectRepositoryRetirement: partitionReplace,
  projectRepositoryConfigurations: partitionReplace,
  executionPlacement: { GET: "Partition", PUT: "Partition" },
  sessionPlacement: { GET: "Partition", PUT: "Partition" },
  ownerFallback: { GET: "Partition", PUT: "Partition" },
  hostedRuns: partitionRead,
  abilities: partitionRead,
  workerPools: partitionRead,
  drafts: { GET: "Partition", POST: "Partition" },
  draftInitialization: partitionRead,
  draft: { GET: "Partition", PUT: "Partition", DELETE: "Partition" },
  dispatchView: partitionRead,
  threads: { GET: "Partition", POST: "Partition" },
  threadLimit: { GET: "Partition", PUT: "Refused" },
  thread: partitionRead,
  threadTranscript: partitionRead,
  threadMessages: partitionWrite,
  threadTurnStop: partitionWrite,
  threadClose: partitionWrite,
  threadRename: partitionWrite,
  threadHide: partitionWrite,
  threadLive: partitionRead,
} as const satisfies Readonly<Record<NativeHttpRoute, SessionBearerRouteClass>>;

/** The scope of each served method and path, keyed as `METHOD /path` with every public route left out. */
export const sessionBearerRouteScopes: ReadonlyMap<
  string,
  SessionBearerRouteScope
> = new Map(
  Object.entries(sessionBearerRouteClasses).flatMap(([name, classed]) =>
    classed === "Public"
      ? []
      : Object.entries(classed).map(
          ([method, scope]) =>
            [
              `${method} ${nativeHttpRoutes[name as NativeHttpRoute]}`,
              scope,
            ] as const,
        ),
  ),
);

/** What the authentication hook does with one session bearer on one route. */
export type SessionBearerAdmission = "Admitted" | "OtherPartition" | "Refused";

/** What a session bearer is confined by: its session's partition, whose that partition is, and to whom. */
export type SessionBearerConfinement = Pick<
  SessionBearerIdentity,
  "partition" | "scope" | "principal"
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
  const scope = sessionBearerRouteScopes.get(`${served} ${url}`);
  if (
    scope === undefined ||
    scope === "Refused" ||
    scope !== sessionBearerAdmissionScope[session.scope] ||
    typeof params !== "object" ||
    params === null
  )
    return "Refused";
  const named = params as Readonly<Record<string, unknown>>;
  if (typeof named["tenant"] !== "string") return "Refused";
  if (scope === "Member")
    return named["tenant"] === session.partition.tenant &&
      sessionBearerAdmissionOwn(session)
      ? "Admitted"
      : "OtherPartition";
  if (typeof named["project"] !== "string") return "Refused";
  return named["tenant"] === session.partition.tenant &&
    named["project"] === session.partition.project
    ? "Admitted"
    : "OtherPartition";
}

/** The one route class each session scope may reach. */
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
