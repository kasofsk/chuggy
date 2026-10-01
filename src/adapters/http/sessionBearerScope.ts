/**
 * Where a session bearer may act: in its own session's partition, and nowhere
 * else. Its principal may be authorized far more widely than the session is —
 * a lead's is the site's one selector identity, a developer on every project
 * with a lead — and whoever holds the bearer holds that principal, so the
 * bearer is confined to the partition its session row names.
 *
 * EVERY AUTHENTICATED ROUTE IS CLASSIFIED HERE, by name and method. A
 * `Partition` route admits a session bearer only where its `:tenant` and
 * `:project` are the session's, and answers any other as an unauthorized read
 * is answered, so a session learns nothing of a project it cannot reach. A
 * `Refused` route never admits one: everything not addressed to one partition,
 * and inside one the registration-token mint, because enrolling a machine is
 * provisioning rather than work. A `Public` route reads no bearer at all.
 *
 * THE TABLE IS EXHAUSTIVE OVER THE ROUTE TABLE, so a route named there without
 * a class is a compile error, and a method or path served without an entry
 * here is refused at run time. The partition compared is the one the session
 * authority answered, never one the request carries.
 */

import { nativeHttpRoutes, type NativeHttpRoute } from "../../contract/http.ts";
import type { Partition } from "../../interpreter/projectStore.ts";

/** What one route admits a session bearer to: its own partition, or nothing. */
export type SessionBearerRouteScope = "Partition" | "Refused";

/** The methods a route is served under, `HEAD` being served wherever `GET` is. */
export type SessionBearerMethod = "GET" | "POST" | "PUT" | "DELETE";

/** One route's class: public, or a scope for each method it is served under. */
export type SessionBearerRouteClass =
  | "Public"
  | Readonly<Partial<Record<SessionBearerMethod, SessionBearerRouteScope>>>;

const partitionRead = { GET: "Partition" } as const;
const partitionWrite = { POST: "Partition" } as const;
const partitionReplace = { PUT: "Partition" } as const;

/** Every route in the route table, and what each admits a session bearer to. */
export const sessionBearerRouteClasses = {
  contract: "Public",
  installation: "Public",
  workerPoolRegistrations: "Public",
  projects: { GET: "Refused", POST: "Refused" },
  forgeApps: { GET: "Refused" },
  forgeAuthorizations: { POST: "Refused" },
  forgeInstallations: { GET: "Refused" },
  forgeInstallationRepositories: { GET: "Refused" },
  workerPoolRegistrationTokens: { POST: "Refused" },
  project: partitionRead,
  tickets: partitionRead,
  ticket: partitionRead,
  ticketNativeActions: partitionRead,
  ticketAgenticRefusals: partitionRead,
  nativeActions: partitionRead,
  agenticRefusals: partitionRead,
  operationalStatus: partitionRead,
  selectorContext: partitionRead,
  selectorSettings: { GET: "Partition", PUT: "Partition" },
  selectorSettingsHistory: partitionRead,
  selectorHistory: partitionRead,
  lead: partitionRead,
  leadTranscript: partitionRead,
  leadInquiries: { GET: "Partition", POST: "Partition" },
  leadInquiry: partitionRead,
  executions: partitionRead,
  execution: partitionRead,
  outputContent: partitionRead,
  runTurns: partitionRead,
  runTranscript: partitionRead,
  runConfiguration: partitionRead,
  runError: partitionRead,
  operations: partitionWrite,
  operation: { GET: "Partition", DELETE: "Partition" },
  notifications: partitionRead,
  events: partitionRead,
  configurations: { GET: "Partition", POST: "Partition" },
  configurationImports: partitionWrite,
  configuration: partitionRead,
  forgeCredentials: partitionWrite,
  projectRepositories: { GET: "Partition", POST: "Partition" },
  projectRepositoriesNew: partitionWrite,
  projectRepositoryLanding: partitionReplace,
  projectRepositoryRetirement: partitionReplace,
  projectRepositoryConfigurations: partitionReplace,
  executionPlacement: { GET: "Partition", PUT: "Partition" },
  sessionPlacement: { GET: "Partition", PUT: "Partition" },
  hostedRuns: partitionRead,
  workerPools: partitionRead,
  drafts: { GET: "Partition", POST: "Partition" },
  draftInitialization: partitionRead,
  draft: { GET: "Partition", PUT: "Partition", DELETE: "Partition" },
  dispatchView: partitionRead,
  threads: { GET: "Partition", POST: "Partition" },
  thread: partitionRead,
  threadTranscript: partitionRead,
  threadMessages: partitionWrite,
  threadClose: partitionWrite,
  threadRename: partitionWrite,
  threadHide: partitionWrite,
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

/**
 * Whether a session confined to `partition` may reach the route a request
 * matched. `url` is the matched route's pattern and `params` what the router
 * read out of the path, so nothing here parses the request line.
 */
export function sessionBearerAdmission(
  partition: Partition,
  method: string,
  url: string | undefined,
  params: unknown,
): SessionBearerAdmission {
  if (url === undefined) return "Refused";
  const served = method === "HEAD" ? "GET" : method;
  const scope = sessionBearerRouteScopes.get(`${served} ${url}`);
  if (scope !== "Partition" || typeof params !== "object" || params === null)
    return "Refused";
  const named = params as Readonly<Record<string, unknown>>;
  if (
    typeof named["tenant"] !== "string" ||
    typeof named["project"] !== "string"
  )
    return "Refused";
  return named["tenant"] === partition.tenant &&
    named["project"] === partition.project
    ? "Admitted"
    : "OtherPartition";
}
