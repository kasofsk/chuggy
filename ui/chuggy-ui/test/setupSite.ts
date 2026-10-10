/**
 * One chuggy site as the setup program reads it, described once and answered
 * as the wire answers.
 *
 * Both doubles of the site answer from this: the one the core suites call in
 * process and the one the process suites reach over HTTP, so a state of setup
 * is written once and means the same in each. It answers the reads the bare
 * command makes and refuses, as the server does, what it would not show:
 * a project the caller is not listed in is not found, a workspace's accounts
 * and what each installation on them grants are not found by anyone who does
 * not administer it, and lead settings are not found by whoever is not shown
 * them. The list of projects is answered a
 * page at a time, each page but the last naming the next, since the server
 * answers a page of what it scanned and not of what the caller is shown. A
 * case moves one read to another fate by naming it in `fates`.
 */

import type { AccessCallerTenant } from "../../../src/contract/accessPlane.ts";
import { projectRepositoriesAnsweredMax } from "../../../src/contract/http.ts";
import type {
  DraftResponse,
  ExecutionPlacementResponse,
  ForgeInstallationResponse,
  ForgeRepositoryResponse,
  ProjectRepositoryListedResponse,
  SelectorProjectSettingsResponse,
  SessionPlacementResponse,
  TicketLandingResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import type {
  ForgeAppName,
  PlacementRoute,
  SessionRunnerStanding,
} from "../../../src/contract/rosters.ts";

export interface SetupSiteRepository {
  readonly repository: string;
  readonly configured: boolean;
  readonly retired?: boolean;
}

export interface SetupSiteTicket {
  readonly ticket: number;
  readonly phase: TicketResponse["phase"];
}

export interface SetupSiteProject {
  readonly tenant: string;
  readonly project: string;
  /** The page of the list of projects this one is answered on, the first being zero. */
  page: number;
  northStar: string | undefined;
  /** A North Star the installation gives every project that has none of its own. */
  inherited: string | undefined;
  /** Whether the caller is shown the project's lead settings. */
  settled: boolean;
  repositories: SetupSiteRepository[];
  /** Where the project's work runs. */
  work: PlacementRoute;
  runner: SessionRunnerStanding;
  /** Most lately moved first. */
  tickets: SetupSiteTicket[];
  drafts: number[];
  landings: Map<number, readonly TicketLandingResponse[]>;
}

/** The reads a case can move to another fate, by what each is of. */
export type SetupSiteRead =
  | "workspaces"
  | "inventory"
  | "settings"
  | "installations"
  | "portalGrant"
  | "workerGrant"
  | "repositories"
  | "work"
  | "placement"
  | "landed"
  | "moving"
  | "drafts"
  | "landings";

/** How a read is answered where a case says other than what the site holds. */
export type SetupSiteFate =
  "Refused" | "Failed" | "Cut" | "Garbled" | "Unauthenticated";

export interface SetupSite {
  tenants: AccessCallerTenant[];
  projects: SetupSiteProject[];
  /** How many pages the list of projects is answered in, where that is more than the projects' own pages come to. */
  inventoryPages: number;
  /** The claims each workspace holds, by workspace. */
  installations: Map<string, ForgeInstallationResponse[]>;
  /** The repositories an installation grants, by installation, where a case says other than every repository of the workspace's projects on its account. */
  grants: Map<string, string[]>;
  fates: Map<SetupSiteRead, SetupSiteFate>;
}

export interface SetupSiteAnswer {
  readonly status: number;
  readonly body: unknown;
}

export function setupSiteProject(
  tenant: string,
  project: string,
): SetupSiteProject {
  return {
    tenant,
    project,
    page: 0,
    northStar: undefined,
    inherited: undefined,
    settled: true,
    repositories: [],
    work: "Pool",
    runner: "Unregistered",
    tickets: [],
    drafts: [],
    landings: new Map(),
  };
}

/** A site the caller is in no workspace of and sees nothing on. */
export function setupSiteEmpty(): SetupSite {
  return {
    tenants: [],
    projects: [],
    inventoryPages: 1,
    installations: new Map(),
    grants: new Map(),
    fates: new Map(),
  };
}

export function setupSiteClaim(
  account: string,
  app: ForgeAppName,
): ForgeInstallationResponse {
  return {
    forge: "github",
    app,
    account,
    accountKind: "Organization",
    installationId: `${account}-${app}`,
    claimedAt: "2026-09-11T00:00:00Z",
  };
}

/** A landing that opened a pull request at `url` and is still to merge. */
export function setupSiteProposed(url: string): TicketLandingResponse {
  return {
    cycle: 1,
    generation: 1,
    attempts: 1,
    state: "Running",
    proposal: { url, headRef: "chug/ticket", baseRef: "main" },
  };
}

/** A landing pushed straight to its branch: landed, with no pull request to show. */
export const setupSiteLanded: TicketLandingResponse = {
  cycle: 1,
  generation: 1,
  attempts: 1,
  state: "Landed",
  landedCommit: "0123456789abcdef0123456789abcdef01234567",
};

/** A landing held where nothing has been proposed. */
export const setupSiteHeld: TicketLandingResponse = {
  cycle: 1,
  generation: 1,
  attempts: 1,
  state: "Held",
  hold: {
    kind: "TargetUnreadable",
    passes: 1,
    since: "2026-10-07T14:02:11.000000Z",
  },
};

export const setupSiteWorkspace = "acme";
export const setupSiteProjectName = "widgets";
export const setupSiteAccount = "acme-org";
export const setupSiteRepositoryAddress = "https://github.com/acme-org/widgets";

/** How far along a site is, each stage one thing further than the last. */
export const setupSiteStages = [
  "Nothing",
  "Workspace",
  "Project",
  "NorthStar",
  "Portal",
  "Apps",
  "Added",
  "Configured",
  "Offline",
  "Live",
  "Draft",
  "Moving",
  "Landed",
] as const;

export type SetupSiteStage = (typeof setupSiteStages)[number];

/** One workspace and one project, set up as far as `stage` and no further. */
export function setupSiteAt(stage: SetupSiteStage): SetupSite {
  const site = setupSiteEmpty();
  const reached = (at: SetupSiteStage): boolean =>
    setupSiteStages.indexOf(stage) >= setupSiteStages.indexOf(at);
  if (!reached("Workspace")) return site;
  site.tenants.push({
    tenant: setupSiteWorkspace,
    roles: ["Admin"],
    administer: true,
  });
  if (!reached("Project")) return site;
  const project = setupSiteProject(setupSiteWorkspace, setupSiteProjectName);
  site.projects.push(project);
  if (reached("NorthStar")) project.northStar = "Widgets, made well.";
  const claims: ForgeInstallationResponse[] = [];
  if (reached("Portal"))
    claims.push(setupSiteClaim(setupSiteAccount, "portal"));
  if (reached("Apps")) claims.push(setupSiteClaim(setupSiteAccount, "worker"));
  site.installations.set(setupSiteWorkspace, claims);
  if (reached("Added"))
    project.repositories.push({
      repository: setupSiteRepositoryAddress,
      configured: reached("Configured"),
    });
  if (reached("Offline")) project.runner = reached("Live") ? "Live" : "Offline";
  if (stage === "Draft") project.drafts.push(1);
  if (stage === "Moving") project.tickets.push({ ticket: 1, phase: "Work" });
  if (stage === "Landed") project.tickets.push({ ticket: 1, phase: "Done" });
  return site;
}

/** A site with two projects in its one workspace: the first set up to a landed ticket but for its repository, which is added to the second. */
export function setupSiteTwo(): SetupSite {
  const site = setupSiteAt("Landed");
  const second = setupSiteProject(setupSiteWorkspace, "gadgets");
  site.projects.push(second);
  site.projects[0]?.repositories.splice(0);
  second.repositories.push({
    repository: setupSiteRepositoryAddress,
    configured: true,
  });
  return site;
}

function refused(): SetupSiteAnswer {
  return {
    status: 404,
    body: { error: { code: "NotFound", message: "Not found." } },
  };
}

function answered(body: unknown): SetupSiteAnswer {
  return { status: 200, body };
}

/** What a read answers where a case moved it, or nothing where it answers what the site holds. */
function fated(
  site: SetupSite,
  read: SetupSiteRead,
): SetupSiteAnswer | undefined {
  switch (site.fates.get(read)) {
    case undefined:
    case "Cut":
      return undefined;
    case "Refused":
      return refused();
    case "Failed":
      return {
        status: 500,
        body: { error: { code: "Internal", message: "It broke." } },
      };
    case "Garbled":
      return answered({ unexpected: true });
    case "Unauthenticated":
      return { status: 401, body: {} };
  }
}

function cut(site: SetupSite, read: SetupSiteRead): boolean {
  return site.fates.get(read) === "Cut";
}

function settings(project: SetupSiteProject): SelectorProjectSettingsResponse {
  const limits = {
    tokensPerDecision: 1,
    millisecondsPerDecision: 1,
    toolCallsPerDecision: 1,
    dispatchesPerDecision: 1,
    inputBytesPerDecision: 1,
    candidatePagesPerDecision: 1,
    concurrentDecisions: 1,
    selectionsPerMinute: 1,
  };
  const northStar =
    project.northStar === undefined ? {} : { northStar: project.northStar };
  const inherited =
    project.inherited === undefined ? {} : { northStar: project.inherited };
  return {
    partition: { tenant: project.tenant, project: project.project },
    revision: 1,
    overrides: northStar,
    effective: {
      revision: 1,
      projectRevision: 1,
      mode: "Running",
      installationMode: "Running",
      dispatchMode: "Automatic",
      basePrompt: "Lead the project.",
      ...inherited,
      ...northStar,
      threadStandingRules: "Be brief.",
      modelAllowlist: [],
      toolAllowlist: [],
      limits,
      installationLimits: limits,
      operationalContextMaxAgeMs: 1,
    },
  };
}

function binding(
  repository: SetupSiteRepository,
): ProjectRepositoryListedResponse {
  return {
    repository: repository.repository,
    boundAt: "2026-08-26T00:00:00Z",
    landing: { mode: "Push" },
    ...(repository.retired === true
      ? { retiredAt: "2026-08-27T00:00:00Z" }
      : {}),
    configured: repository.configured,
  };
}

/** The project's bindings, padded with retired ones to the most a listing answers where a case cut it. */
function bindings(
  site: SetupSite,
  project: SetupSiteProject,
): readonly ProjectRepositoryListedResponse[] {
  const held = project.repositories.map(binding);
  if (!cut(site, "repositories")) return held;
  const padding = Array.from(
    { length: Math.max(0, projectRepositoriesAnsweredMax - held.length) },
    (_, at) =>
      binding({
        repository: `https://github.com/elsewhere/retired-${String(at)}`,
        configured: false,
        retired: true,
      }),
  );
  return [...held, ...padding];
}

function placement(project: SetupSiteProject): SessionPlacementResponse {
  return {
    thread: { route: "Pool", source: "Default" },
    lead: { route: "Pool", source: "Default" },
    choices: ["Pool"],
    runners: { mine: project.runner, project: project.runner },
  };
}

function work(project: SetupSiteProject): ExecutionPlacementResponse {
  return {
    work: { route: project.work, source: "Default" },
    evaluation: { route: project.work, source: "Default" },
    choices: ["InCluster", "Pool"],
  };
}

function ticket(held: SetupSiteTicket): TicketResponse {
  return {
    ticket: held.ticket,
    revision: 1,
    phase: held.phase,
    sequence: held.ticket,
    changedAt: "2026-08-27T00:00:00Z",
    releasedAt: "2026-08-26T00:00:00Z",
    revokedDependencies: [],
  };
}

function draft(project: SetupSiteProject, number: number): DraftResponse {
  return {
    partition: { tenant: project.tenant, project: project.project },
    ticket: number,
    authoringVersion: 1,
    state: "Draft",
    configurationRevision: "r1",
    authoring: {
      dependencies: [],
      program: [{ key: 1, evaluators: [{ key: 1 }] }],
    },
  };
}

/** One page of the project's tickets in the phases asked for, which is where a done one and those on their way part. */
function tickets(
  site: SetupSite,
  project: SetupSiteProject,
  query: URLSearchParams,
): SetupSiteAnswer {
  const phases = query.getAll("phase");
  const read: SetupSiteRead = phases.includes("Done") ? "landed" : "moving";
  const limit = Number(query.get("limit") ?? "50");
  return (
    fated(site, read) ??
    answered({
      partition: { tenant: project.tenant, project: project.project },
      sequence: 1,
      tickets: project.tickets
        .filter((held) => phases.length === 0 || phases.includes(held.phase))
        .slice(0, limit)
        .map(ticket),
      ...(cut(site, read) ? { nextCursor: "more" } : {}),
    })
  );
}

function landings(
  site: SetupSite,
  project: SetupSiteProject,
  number: string,
): SetupSiteAnswer {
  return (
    fated(site, "landings") ??
    answered({
      landings: project.landings.get(Number(number)) ?? [],
      truncated: cut(site, "landings"),
    })
  );
}

function projectAnswered(
  site: SetupSite,
  project: SetupSiteProject,
  rest: string,
  query: URLSearchParams,
): SetupSiteAnswer | undefined {
  const landed = /^\/tickets\/(\d+)\/landings$/u.exec(rest);
  if (landed !== null) return landings(site, project, landed[1] ?? "");
  switch (rest) {
    case "":
      return tickets(site, project, query);
    case "/selector-settings":
      return (
        fated(site, "settings") ??
        (project.settled ? answered(settings(project)) : refused())
      );
    case "/repositories":
      return (
        fated(site, "repositories") ??
        answered({ repositories: bindings(site, project) })
      );
    case "/execution-placement":
      return fated(site, "work") ?? answered(work(project));
    case "/session-placement":
      return fated(site, "placement") ?? answered(placement(project));
    case "/drafts":
      return (
        fated(site, "drafts") ??
        answered({
          drafts: project.drafts
            .slice(0, Number(query.get("limit") ?? "50"))
            .map((number) => draft(project, number)),
          more: false,
        })
      );
    default:
      return undefined;
  }
}

/** A repository as an installation's listing names it, by the address a binding holds. */
function granted(address: string): ForgeRepositoryResponse {
  const [owner = "", name = ""] = address.split("/").slice(-2);
  return {
    name,
    fullName: `${owner}/${name}`,
    url: address,
    defaultBranch: "main",
    private: false,
  };
}

/** What one installation of the workspace grants, which nobody is shown of an installation the workspace does not hold. */
function grant(
  site: SetupSite,
  tenant: string,
  installation: string,
): SetupSiteAnswer {
  const claim = site.installations
    .get(tenant)
    ?.find((held) => held.installationId === installation);
  if (claim === undefined) return refused();
  const read = claim.app === "portal" ? "portalGrant" : "workerGrant";
  const held =
    site.grants.get(installation) ??
    site.projects
      .filter((project) => project.tenant === tenant)
      .flatMap((project) => project.repositories)
      .map((repository) => repository.repository)
      .filter((address) => address.split("/").at(-2) === claim.account);
  return (
    fated(site, read) ??
    answered({ repositories: held.map(granted), truncated: cut(site, read) })
  );
}

function tenantAnswered(
  site: SetupSite,
  tenant: string,
  rest: string,
  query: URLSearchParams,
): SetupSiteAnswer | undefined {
  const administers = site.tenants.some(
    (held) => held.tenant === tenant && held.administer,
  );
  const listing = /^\/forge-installations\/([^/]+)\/repositories$/u.exec(rest);
  if (listing !== null)
    return administers
      ? grant(site, tenant, decodeURIComponent(listing[1] ?? ""))
      : refused();
  if (rest === "/forge-installations") {
    return (
      fated(site, "installations") ??
      (administers
        ? answered({
            installations: site.installations.get(tenant) ?? [],
            truncated: cut(site, "installations"),
          })
        : refused())
    );
  }
  const within = /^\/projects\/([^/]+)(\/.*)?$/u.exec(rest);
  if (within === null) return undefined;
  const project = site.projects.find(
    (held) =>
      held.tenant === tenant &&
      held.project === decodeURIComponent(within[1] ?? ""),
  );
  return project === undefined
    ? refused()
    : projectAnswered(site, project, within[2] ?? "", query);
}

/** One page of the projects the caller is shown: those answered on it, and the next page's cursor on every page but the last, or on every page where a case cut the list. */
function inventory(site: SetupSite, cursor: string | null): SetupSiteAnswer {
  const at = cursor === null ? 0 : Number(cursor);
  const last = Math.max(
    site.inventoryPages - 1,
    ...site.projects.map((held) => held.page),
  );
  return (
    fated(site, "inventory") ??
    answered({
      projects: site.projects
        .filter((held) => held.page === at)
        .map((held) => ({ tenant: held.tenant, project: held.project })),
      ...(at < last || cut(site, "inventory")
        ? { nextCursor: String(at + 1) }
        : {}),
    })
  );
}

/**
 * What the site answers a read of `target`, a path with its query, or
 * nothing where the path is none of the reads the bare command makes.
 */
export function setupSiteAnswered(
  site: SetupSite,
  target: string,
): SetupSiteAnswer | undefined {
  const url = new URL(target, "http://site.invalid");
  if (url.pathname === "/access/v1/workspaces")
    return (
      fated(site, "workspaces") ??
      answered({ tenants: site.tenants, truncated: cut(site, "workspaces") })
    );
  if (url.pathname === "/api/v1/projects")
    return inventory(site, url.searchParams.get("cursor"));
  const tenant = /^\/api\/v1\/tenants\/([^/]+)(\/.*)$/u.exec(url.pathname);
  return tenant === null
    ? undefined
    : tenantAnswered(
        site,
        decodeURIComponent(tenant[1] ?? ""),
        tenant[2] ?? "",
        url.searchParams,
      );
}
