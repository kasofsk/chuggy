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
 * not administer it, and settings are not found by whoever is not shown
 * them. The list of projects is answered a
 * page at a time, each page but the last naming the next, since the server
 * answers a page of what it scanned and not of what the caller is shown. A
 * case moves one read to another fate by naming it in `fates`.
 *
 * It also answers what `runner` asks: whether the caller administers a
 * project, the pools registered for it, and the mint of a registration token,
 * which only an administrator is answered and only while the project holds
 * fewer unredeemed tokens than its bound. A token is redeemed once, by whoever
 * holds it, for a pool's credentials; every token and every credential handed
 * out is kept, so a suite can search what a run printed for any of them. The
 * caller's chat host in a workspace is answered likewise: whether the
 * workspace lets them register one, the mint of a token for one, which only a
 * caller it lets is answered, and its redemption, which makes a new host
 * theirs in place of any they held. Where their chats in a project run on
 * runners, the session placement says their chat host as it stands. Their
 * personal runners in a workspace are held apart from it, with the projects
 * they serve, and are not found where they hold none.
 *
 * It binds a repository as the server does, only where a portal installation
 * of the workspace's lists it, writing the bootstrap a binding of a repository
 * declaring nothing holds; it answers the deployment's apps, each with its
 * install page, and the client a person authorizes unless a case takes it
 * away; and each installation's settings page.
 *
 * It files a ticket as the server does: a draft created under a revision the
 * project offers, at its fence, released into a ticket that waits to start,
 * and dispatched where the dispatch view lists it; every brief it was sent is
 * kept, so a suite can say what was filed. Each operation is decided as it is
 * submitted.
 *
 * It imports a repository's configuration as the server does: from what was
 * pushed to the repository's default branch, judged by the contract's own
 * judgment of a configuration directory, kept as the binding's last import,
 * and refused with the files it refused.
 */

import type { AccessCallerTenant } from "../../../src/contract/accessPlane.ts";
import { projectRepositoriesAnsweredMax } from "../../../src/contract/http.ts";
import { repositoryConfigurationRoot } from "../../../src/contract/configurationDocument.ts";
import { projectDisplayNameSchema } from "../../../src/contract/requests.ts";
import {
  repositoryConfigurationFilesReadiness,
  repositoryConfigurationImportReferences,
} from "../../../src/contract/repositoryConfigurationReadiness.ts";
import type { RepositoryConfigurationReferenced } from "../../../src/contract/repositoryConfigurationReference.ts";
import type {
  DraftResponse,
  ExecutionPlacementResponse,
  ForgeInstallationResponse,
  ForgeRepositoryResponse,
  ProjectRepositoryConfigurationsHeldResponse,
  ProjectRepositoryListedResponse,
  RepositoryConfigurationImportAttemptResponse,
  SelectorProjectSettingsResponse,
  SessionPlacementResponse,
  TicketLandingResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import { bootstrapConfigurationRevisionPrefix } from "../../../src/contract/responses.ts";
import type {
  ForgeAppName,
  OwnerFallback,
  PlacementRoute,
  SessionRunnerStanding,
} from "../../../src/contract/rosters.ts";

export interface SetupSiteRepository {
  readonly repository: string;
  /** Whether the project holds a configuration for it: the repository's own, or the bootstrap where `bootstrapped` says so. */
  readonly configured: boolean;
  readonly retired?: boolean;
  readonly bootstrapped?: boolean;
  /** The import of it that finished last, where one did. */
  readonly lastImport?: RepositoryConfigurationImportAttemptResponse;
  /** How its work is finalized: pushed unless a case has it merged through a pull request, or left in one for the person to merge. */
  readonly mode?: "Push" | "PullRequestMerge" | "PullRequest";
}

/** A draft as it was created: the revision it is drawn under, and its brief. */
export interface SetupSiteFiled {
  readonly configurationRevision: string;
  readonly brief: {
    readonly title?: string;
    readonly intent: string;
    readonly branch?: string;
  };
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
  /** Whether the caller is shown the project's settings. */
  settled: boolean;
  repositories: SetupSiteRepository[];
  /** Where the project's work runs, and where the caller's chats in it run. */
  work: PlacementRoute;
  threads: PlacementRoute;
  runner: SessionRunnerStanding;
  /** The owner fallback the project names, where it names one. */
  fallback: OwnerFallback | undefined;
  /** Most lately moved first. */
  tickets: SetupSiteTicket[];
  drafts: number[];
  landings: Map<number, readonly TicketLandingResponse[]>;
  /** Whether the caller administers the project, which its abilities read says and the mint goes by. */
  administer: boolean;
  /** The pools registered for the project, by name, and the registration tokens minted for it that nobody has redeemed. */
  pools: string[];
  tokens: string[];
  /** The names a repository holding its own configuration declares, each ready at the one commit imported. */
  declared: string[];
  /** Every draft created, by its ticket, with the body it was created from. */
  readonly filed: Map<number, SetupSiteFiled>;
  /** Every operation submitted, by its identity, with what it was submitted to do. */
  readonly operations: Map<string, unknown>;
  /** What the project is called, where it is other than its address, and whether the caller made it. */
  name?: string;
  made?: true;
}

/** The reads of the bare command a case can move to another fate, by what each is of. */
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
  | "fallback"
  | "personal"
  | "landed"
  | "moving"
  | "drafts"
  | "landings";

/** The caller's principal, which their chat host is registered under: their issuer's length and their issuer, then their subject, as the site derives one. */
export const setupSiteMember =
  "20:https://auth.example0b9c6f1e-4c55-4f3a-9a40-6a1b2c3d4e5f";

/** What only `runner`, `bind` or `ticket` asks, which a case moves likewise; `mint`, `chatMint`, `bind` and `file` are writes, `file` the draft's creation. */
export type SetupSiteRunnerAsk =
  | "abilities"
  | "pools"
  | "mint"
  | "permit"
  | "chat"
  | "chatMint"
  | "bind"
  | "configurations"
  | "file";

/** The caller's chat host in a workspace: the id it is held by, and whether it has polled lately, which is what the site sees as live. */
export interface SetupSiteChatHost {
  readonly id: string;
  live: boolean;
}

/** The caller's personal runners in a workspace: whether each has polled lately, and the projects every one serves. */
export interface SetupSitePersonalRunners {
  live: boolean[];
  projects: string[];
}

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
  fates: Map<SetupSiteRead | SetupSiteRunnerAsk, SetupSiteFate>;
  /** Whether the deployment answers a client to authorize, without which it offers no install the workspace can claim. */
  authorizing: boolean;
  /** Every registration token and every runner credential the site handed out, in order. */
  readonly secrets: string[];
  /** The caller's subject, which their chat host is registered under. */
  readonly member: string;
  /** Whether each workspace lets the caller register a chat host, where a case says one does not. */
  readonly withheld: Set<string>;
  /** The caller's chat host, by workspace, the tokens minted for one that nobody has redeemed, each with its workspace, and how many were ever registered. */
  readonly chat: Map<string, SetupSiteChatHost>;
  readonly chatTokens: Map<string, string>;
  chatMade: number;
  /** The caller's personal runners, by workspace, where they hold any. */
  readonly personal: Map<string, SetupSitePersonalRunners>;
  /** What each mint that was answered asked for. */
  readonly mints: SetupSiteMint[];
  /** What each repository's default branch holds at its head, by repository and then path, where something was pushed to it. */
  readonly pushed: Map<string, ReadonlyMap<string, string>>;
  /** The letters the site draws a token from, which a case changes to draw one nothing knows by its shape, or one no command line carries whole. */
  letters: string;
}

export interface SetupSiteMint {
  readonly lifetimeSecs: number;
}

/** How a request is sent: its method, and its body where it has one. */
export interface SetupSiteSent {
  readonly method: string;
  readonly body?: string | undefined;
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
    settled: true,
    repositories: [],
    work: "Pool",
    threads: "Pool",
    runner: "Unregistered",
    fallback: undefined,
    tickets: [],
    drafts: [],
    landings: new Map(),
    administer: true,
    pools: [],
    tokens: [],
    declared: ["development"],
    filed: new Map(),
    operations: new Map(),
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
    authorizing: true,
    secrets: [],
    member: setupSiteMember,
    withheld: new Set(),
    chat: new Map(),
    chatTokens: new Map(),
    chatMade: 0,
    personal: new Map(),
    mints: [],
    pushed: new Map(),
    letters: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_",
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
    proposal: {
      url,
      headRef: "chug/ticket",
      headCommit: "b".repeat(40),
      baseRef: "main",
    },
  };
}

/** A landing that ended by opening a pull request at `url`, which is how a ticket landed by pull request is done. */
export function setupSiteOpened(url: string): TicketLandingResponse {
  return { ...setupSiteProposed(url), state: "Proposed" };
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
    displayName: setupSiteWorkspace,
    roles: ["Admin"],
    administer: true,
  });
  if (!reached("Project")) return site;
  const project = setupSiteProject(setupSiteWorkspace, setupSiteProjectName);
  site.projects.push(project);
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
  if (reached("Live")) setupSiteChatAdded(site, setupSiteWorkspace, true);
  if (stage === "Draft") project.drafts.push(1);
  if (stage === "Moving") project.tickets.push({ ticket: 1, phase: "Work" });
  if (stage === "Landed") project.tickets.push({ ticket: 1, phase: "Done" });
  return site;
}

/** `site` with every repository that holds a configuration holding only the bootstrap, as one that declares none of its own does. */
export function setupSiteBootstrap(site: SetupSite): SetupSite {
  for (const project of site.projects)
    project.repositories = project.repositories.map((held) => ({
      ...held,
      bootstrapped: true,
    }));
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
  read: SetupSiteRead | SetupSiteRunnerAsk,
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

function cut(
  site: SetupSite,
  read: SetupSiteRead | SetupSiteRunnerAsk,
): boolean {
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
    autoCompactWindow: 200_000,
    concurrentDecisions: 1,
    selectionsPerMinute: 1,
  };
  return {
    partition: { tenant: project.tenant, project: project.project },
    revision: 1,
    overrides: {},
    effective: {
      revision: 1,
      projectRevision: 1,
      mode: "Running",
      installationMode: "Running",
      dispatchMode: "Automatic",
      basePrompt: "Lead the project.",
      threadStandingRules: "Be brief.",
      modelAllowlist: [],
      toolAllowlist: [],
      limits,
      installationLimits: limits,
      operationalContextMaxAgeMs: 1,
      leadOffering: "Own",
    },
  };
}

/** A stand-in for the revision the server authors a repository's bootstrap at, which names the repository. */
export function setupSiteBootstrapRevision(repository: string): string {
  return `${bootstrapConfigurationRevisionPrefix}${repository}`;
}

/** What the project holds for a repository it holds a configuration for. */
function configurations(
  repository: SetupSiteRepository,
): ProjectRepositoryConfigurationsHeldResponse {
  return repository.bootstrapped === true
    ? {
        result: "Bootstrapped",
        revision: setupSiteBootstrapRevision(repository.repository),
      }
    : { result: "Imported", count: 1 };
}

function binding(
  repository: SetupSiteRepository,
): ProjectRepositoryListedResponse {
  return {
    repository: repository.repository,
    boundAt: "2026-08-26T00:00:00Z",
    landing: { mode: repository.mode ?? "Push" },
    finalization:
      repository.mode === "PullRequest"
        ? { kind: "PullRequest" }
        : {
            kind: "GitMerge",
            mode: repository.mode ?? "Push",
            policy: "Direct",
          },
    pipelinesWritable: false,
    pipelinesRunnable: false,
    ...(repository.retired === true
      ? { retiredAt: "2026-08-27T00:00:00Z" }
      : {}),
    configured: repository.configured,
    ...(repository.configured
      ? { configurationsHeld: configurations(repository) }
      : {}),
    ...(repository.lastImport === undefined
      ? {}
      : { lastImport: repository.lastImport }),
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

/** The caller's chat host as a project's session placement says it: registered where they hold one in the workspace, and live where it is. */
function mine(
  site: SetupSite,
  project: SetupSiteProject,
): SessionRunnerStanding {
  const host = site.chat.get(project.tenant);
  if (host === undefined) return "Unregistered";
  return host.live ? "Live" : "Offline";
}

function placement(
  site: SetupSite,
  project: SetupSiteProject,
): SessionPlacementResponse {
  return {
    thread: { route: project.threads, source: "Default" },
    lead: { route: "Pool", source: "Default" },
    leadOffering: "Own",
    leadOfferings: ["Own"],
    choices: ["InCluster", "Pool"],
    runners: { mine: mine(site, project), project: project.runner },
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
    openDependencies: [],
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

/** The most registration tokens a project holds unredeemed, small so a case reaches it. */
export const setupSiteTokensMax = 3;

/** A registration token as the server draws one: a long run of the letters a URL carries unescaped, unless a case has the site draw from others. */
function drawn(site: SetupSite, kind: string): string {
  const secret = `${kind}${String(site.secrets.length + 1)}_`.padEnd(
    43,
    site.letters,
  );
  site.secrets.push(secret);
  return secret;
}

/** The one write: a registration token for the project, to whoever administers it and while it holds fewer than its bound. */
function minted(
  site: SetupSite,
  project: SetupSiteProject,
  body: string | undefined,
): SetupSiteAnswer {
  const fate = fated(site, "mint");
  if (fate !== undefined) return fate;
  if (!project.administer) return refused();
  if (project.tokens.length >= setupSiteTokensMax)
    return {
      status: 409,
      body: { error: { code: "TokenLimitReached", message: "At its bound." } },
    };
  const asked = JSON.parse(body ?? "{}") as SetupSiteMint;
  site.mints.push(asked);
  const token = drawn(site, "registration");
  project.tokens.push(token);
  return { status: 201, body: { token, expiresAtMs: 4_102_444_800_000 } };
}

/**
 * A redemption, which is answered on the token alone: the pool's credentials
 * once, and not found for a token that is unknown or spent. The project then
 * has a runner registered that has not polled.
 */
export function setupSiteRedeemed(
  site: SetupSite,
  token: string,
  pool: string,
): SetupSiteAnswer {
  const project = site.projects.find((held) => held.tokens.includes(token));
  if (project === undefined) return refused();
  project.tokens.splice(project.tokens.indexOf(token), 1);
  if (!project.pools.includes(pool)) project.pools.push(pool);
  if (project.runner === "Unregistered") project.runner = "Offline";
  return {
    status: 201,
    body: {
      tenant: project.tenant,
      project: project.project,
      pool,
      capabilities: ["Platform:Linux:Amd64"],
      tokenUrl: "https://auth.example/oauth2/token",
      audience: "https://chuggy.example/pool",
      planeUrl: "https://pool.chuggy.example/",
      clientId: `pool-${pool}`,
      clientSecret: drawn(site, "credential"),
    },
  };
}

/** The caller's chat host in a workspace made a new one, of an id of its own, polling where `live`, in place of any they held; the id is answered. */
export function setupSiteChatAdded(
  site: SetupSite,
  tenant: string,
  live: boolean,
): string {
  site.chatMade += 1;
  const id = `chuggy-chat-${String(site.chatMade)}`;
  site.chat.set(tenant, { id, live });
  return id;
}

/** A redemption of a token minted for the caller's chat host: a new host of theirs in its workspace, which has not polled, in place of any they held. */
export function setupSiteChatRedeemed(
  site: SetupSite,
  token: string,
): SetupSiteAnswer {
  const tenant = site.chatTokens.get(token);
  if (tenant === undefined) return refused();
  site.chatTokens.delete(token);
  const clientId = setupSiteChatAdded(site, tenant, false);
  return {
    status: 201,
    body: {
      kind: "ChatHost",
      tenant,
      owner: site.member,
      tokenUrl: "https://auth.example/oauth2/token",
      audience: "https://chuggy.example/pool",
      planeUrl: "https://pool.chuggy.example/",
      clientId,
      clientSecret: drawn(site, "credential"),
    },
  };
}

/** A token for the caller's chat host in a workspace, to a caller it lets register one and while it holds fewer than the bound. */
function chatMinted(
  site: SetupSite,
  tenant: string,
  body: string | undefined,
): SetupSiteAnswer {
  const fate = fated(site, "chatMint");
  if (fate !== undefined) return fate;
  if (site.withheld.has(tenant)) return refused();
  const held = [...site.chatTokens.values()].filter((of) => of === tenant);
  if (held.length >= setupSiteTokensMax)
    return {
      status: 409,
      body: { error: { code: "TokenLimitReached", message: "At its bound." } },
    };
  site.mints.push(JSON.parse(body ?? "{}") as SetupSiteMint);
  const token = drawn(site, "chatregistration");
  site.chatTokens.set(token, tenant);
  return { status: 201, body: { token, expiresAtMs: 4_102_444_800_000 } };
}

/** The caller's chat host in a workspace as its read answers it, or not found where they hold none. */
function chatAnswered(site: SetupSite, tenant: string): SetupSiteAnswer {
  const host = site.chat.get(tenant);
  return (
    fated(site, "chat") ??
    (host === undefined
      ? refused()
      : answered({
          id: host.id,
          registeredAt: "2026-10-09T00:00:00Z",
          ...(host.live ? { polledAt: "2026-10-09T00:01:00Z" } : {}),
          live: host.live,
        }))
  );
}

/** The caller's personal runners in a workspace as their read answers them, or not found where they hold none. */
function personalAnswered(site: SetupSite, tenant: string): SetupSiteAnswer {
  const held = site.personal.get(tenant);
  return (
    fated(site, "personal") ??
    (held === undefined || held.live.length === 0
      ? refused()
      : answered({
          runners: held.live.map((live, at) => ({
            id: `chuggy-runner-${String(at + 1)}`,
            capabilities: ["Platform:Linux:Amd64"],
            registeredAt: "2026-10-09T00:00:00Z",
            ...(live ? { polledAt: "2026-10-09T00:01:00Z" } : {}),
            live,
            executionsLive: live,
            held: [],
            heldTruncated: false,
          })),
          projects: held.projects.map((project) => ({
            project,
            priority: "Normal",
            waiting: 0,
            waitingTruncated: false,
          })),
        }))
  );
}

/** The pools as the roster read answers them, padded past what one read holds where a case cut it. */
function pools(site: SetupSite, project: SetupSiteProject): SetupSiteAnswer {
  return (
    fated(site, "pools") ??
    answered({
      pools: project.pools.toSorted().map((pool) => ({
        pool,
        capabilities: ["Platform:Linux:Amd64"],
        registeredAt: "2026-10-09T00:00:00Z",
        live: false,
      })),
      truncated: cut(site, "pools"),
    })
  );
}

function abilities(
  site: SetupSite,
  project: SetupSiteProject,
): SetupSiteAnswer {
  const { administer } = project;
  return (
    fated(site, "abilities") ??
    answered({
      principal: setupSiteMember,
      mutate: true,
      dispatch: true,
      manageSelector: administer,
      overrideTicketConfig: administer,
      skipPlannedEvaluations: administer,
      mergeProposals: administer,
      administer,
      writeEpic: true,
    })
  );
}

const filedAt = "2026-08-28T00:00:00Z";
const filedDigest = "c".repeat(64);
const filedCommit = "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23";

/** The revision a declared name is imported at. */
export function setupSiteDeclaredRevision(name: string): string {
  return `declared-${name}`;
}

/** The project's revisions, newest first: each name each binding holding its own configuration declares, ready at the one commit imported. */
function configurationsListed(
  site: SetupSite,
  project: SetupSiteProject,
): SetupSiteAnswer {
  const declaring = project.repositories.filter(
    (held) =>
      held.configured && held.bootstrapped !== true && held.retired !== true,
  );
  return (
    fated(site, "configurations") ??
    answered({
      configurations: declaring.flatMap((held) =>
        project.declared.map((name) => ({
          revision: setupSiteDeclaredRevision(name),
          digest: filedDigest,
          createdAt: filedAt,
          provenance: {
            source: "Repository",
            repository: held.repository,
            commit: filedCommit,
            path: `configurations/${name}.json`,
            name,
          },
          readiness: "Ready",
          image: "an-image",
          practices: [],
          workInstructionsCount: 1,
          reviewInstructionsCount: 1,
          evaluationStagesCount: 1,
        })),
      ),
    })
  );
}

/** The project's head, which every ticket's sequence is at or below. */
function headOf(project: SetupSiteProject): number {
  return Math.max(1, ...project.tickets.map((held) => held.ticket));
}

/** What a draft drawn under `revision` starts on, fenced at the project's head. */
function initialization(
  project: SetupSiteProject,
  revision: string,
): SetupSiteAnswer {
  return answered({
    configuration: {
      partition: { tenant: project.tenant, project: project.project },
      revision,
      canonical: "{}",
      digest: filedDigest,
    },
    fence: {
      projectSequence: headOf(project),
      configurationDigest: filedDigest,
    },
    defaults: {
      dependencies: [],
      program: [{ key: 1, evaluators: [{ key: 1 }] }],
    },
    choices: { programStagesMax: 2, evaluatorsMax: 3 },
    dependencyCandidates: [],
    dependencyCandidatesTruncated: false,
  });
}

/** A draft created from `body`, under the ticket number after every one the project holds, and kept with its brief. */
function filed(
  site: SetupSite,
  project: SetupSiteProject,
  body: string | undefined,
): SetupSiteAnswer {
  const fate = fated(site, "file");
  if (fate !== undefined) return fate;
  const asked = JSON.parse(body ?? "{}") as SetupSiteFiled & {
    readonly expectedProjectSequence: number;
  };
  if (asked.expectedProjectSequence !== headOf(project))
    return conflict("ProjectSequenceStale");
  const number =
    Math.max(
      0,
      ...project.tickets.map((held) => held.ticket),
      ...project.drafts,
      ...project.filed.keys(),
    ) + 1;
  project.drafts.push(number);
  project.filed.set(number, {
    configurationRevision: asked.configurationRevision,
    brief: asked.brief,
  });
  return {
    status: 201,
    body: {
      ...draft(project, number),
      configurationRevision: asked.configurationRevision,
    },
  };
}

/** A submission, decided as it arrives: a release makes its draft a ticket that waits to start, and a dispatch starts one that waits. */
function submitted(
  project: SetupSiteProject,
  body: string | undefined,
): SetupSiteAnswer {
  const asked = JSON.parse(body ?? "{}") as {
    readonly operation: string;
    readonly mutation: { readonly mutation: string; readonly ticket: number };
  };
  const { mutation } = asked;
  project.operations.set(asked.operation, mutation);
  if (mutation.mutation === "ReleaseDraft") {
    project.drafts = project.drafts.filter((held) => held !== mutation.ticket);
    project.tickets.unshift({ ticket: mutation.ticket, phase: "Pending" });
  }
  if (mutation.mutation === "ManualDispatch")
    project.tickets = project.tickets.map((held) =>
      held.ticket === mutation.ticket ? { ...held, phase: "Work" } : held,
    );
  return {
    status: 202,
    body: { operation: asked.operation, state: "Pending" },
  };
}

/** An operation submitted, as decided; one never submitted is not found. */
function operationAnswered(
  project: SetupSiteProject,
  operation: string,
): SetupSiteAnswer {
  return project.operations.has(operation)
    ? answered({
        operation,
        acceptedAt: filedAt,
        state: "Succeeded",
        decidedSequence: headOf(project),
      })
    : refused();
}

/** The page of the dispatch view a ticket is looked for on: each ticket that waits to start, after the one named. */
function dispatchView(
  project: SetupSiteProject,
  query: URLSearchParams,
): SetupSiteAnswer {
  const after = Number(query.get("after") ?? "0");
  return answered({
    result: "Page",
    token: {
      tenant: project.tenant,
      project: project.project,
      recoveryEpoch: "epoch-1",
      schemaVersion: 1,
      watermark: headOf(project),
      digest: filedDigest,
    },
    candidates: project.tickets
      .filter((held) => held.phase === "Pending" && held.ticket > after)
      .map((held) => ({
        ticket: held.ticket,
        ticketVersion: 1,
        dependencies: [],
        program: [{ key: 1, evaluators: [{ key: 1 }] }],
        configurationRevision:
          project.filed.get(held.ticket)?.configurationRevision ?? "r1",
        configurationDigest: filedDigest,
        configurationCanonical: "{}",
      })),
    notificationCursor: 1,
  });
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

const mintPath = "/worker-pool-registration-tokens";
const redeemPath = "/api/v1/worker-pool-registrations";
const chatMintPath = "/chat-host-registration-tokens";
/** Where a chat host's token is redeemed, which is where a member's runner's is. */
const chatRedeemPath = "/api/v1/personal-runner-registrations";

function projectAnswered(
  site: SetupSite,
  project: SetupSiteProject,
  rest: string,
  query: URLSearchParams,
): SetupSiteAnswer | undefined {
  const landed = /^\/tickets\/(\d+)\/landings$/u.exec(rest);
  if (landed !== null) return landings(site, project, landed[1] ?? "");
  const initialized = /^\/draft-initializations\/([^/]+)$/u.exec(rest);
  if (initialized !== null)
    return initialization(project, decodeURIComponent(initialized[1] ?? ""));
  const operation = /^\/operations\/([^/]+)$/u.exec(rest);
  if (operation !== null)
    return operationAnswered(project, decodeURIComponent(operation[1] ?? ""));
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
      return fated(site, "placement") ?? answered(placement(site, project));
    case "/owner-fallback":
      return (
        fated(site, "fallback") ??
        answered({
          ...(project.fallback === undefined
            ? {}
            : { fallback: project.fallback }),
          administers: project.administer,
        })
      );
    case "/abilities":
      return abilities(site, project);
    case "/configurations":
      return configurationsListed(site, project);
    case "/dispatch-view":
      return dispatchView(project, query);
    case "/worker-pools":
      return pools(site, project);
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
    id: "1296269",
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
  const held = grantedBy(site, tenant, claim);
  return (
    fated(site, read) ??
    answered({
      repositories: held.map(granted),
      truncated: cut(site, read),
      selection: "Selected",
    })
  );
}

/** Every repository an installation grants: those a case names, or every repository of the workspace's projects on its account. */
function grantedBy(
  site: SetupSite,
  tenant: string,
  claim: ForgeInstallationResponse,
): readonly string[] {
  return (
    site.grants.get(claim.installationId) ??
    site.projects
      .filter((project) => project.tenant === tenant)
      .flatMap((project) => project.repositories)
      .map((repository) => repository.repository)
      .filter((address) => address.split("/").at(-2) === claim.account)
  );
}

/** The forge's settings page of one installation of the workspace, which nobody is shown of an installation the workspace does not hold. */
function settingsAnswered(
  site: SetupSite,
  tenant: string,
  installation: string,
): SetupSiteAnswer {
  const claim = site.installations
    .get(tenant)
    ?.find((held) => held.installationId === installation);
  return claim === undefined
    ? refused()
    : answered({
        permissions: "Current",
        settingsUrl: setupSiteSettingsUrl(claim),
      });
}

/** The address the forge gives an installation's settings, as a case expects to be sent to it. */
export function setupSiteSettingsUrl(claim: ForgeInstallationResponse): string {
  return `https://github.com/organizations/${claim.account}/settings/installations/${claim.installationId}`;
}

/** The address each app is installed from, as the deployment answers it. */
export function setupSiteInstallUrl(app: ForgeAppName): string {
  return `https://github.com/apps/chuggy-${app}/installations/new`;
}

/** The deployment's apps, each with the page it is installed from, and the client a person authorizes where a case has not taken it away. */
function appsAnswered(site: SetupSite): SetupSiteAnswer {
  return answered({
    apps: (["portal", "worker"] as const).map((app) => ({
      app,
      id: `${app}-id`,
      slug: `chuggy-${app}`,
      installUrl: setupSiteInstallUrl(app),
    })),
    ...(site.authorizing
      ? {
          authorization: {
            clientId: "portal-client",
            authorizeUrl: "https://github.com/login/oauth/authorize",
          },
        }
      : {}),
  });
}

/**
 * A bind, as the server answers it: refused where no portal installation of
 * the workspace lists the repository, answered as it stood where the project
 * already binds it, and otherwise bound, holding the bootstrap.
 */
function bound(
  site: SetupSite,
  project: SetupSiteProject,
  body: string | undefined,
): SetupSiteAnswer {
  const fate = fated(site, "bind");
  if (fate !== undefined) return fate;
  const asked =
    (JSON.parse(body ?? "{}") as { readonly repository?: string }).repository ??
    "";
  const listed = (site.installations.get(project.tenant) ?? []).some(
    (claim) =>
      claim.app === "portal" &&
      grantedBy(site, project.tenant, claim).includes(asked),
  );
  if (!listed)
    return {
      status: 422,
      body: {
        error: { code: "RepositoryNotInstalled", message: "Not installed." },
      },
    };
  if (
    project.repositories.some(
      (held) => held.repository === asked && held.retired !== true,
    )
  )
    return answered({ repository: asked });
  project.repositories.push({
    repository: asked,
    configured: true,
    bootstrapped: true,
  });
  return {
    status: 201,
    body: {
      repository: asked,
      landing: { mode: "Push" },
      finalization: { kind: "GitMerge", mode: "Push", policy: "Direct" },
      configurations: {
        result: "Bootstrapped",
        revision: setupSiteBootstrapRevision(asked),
      },
    },
  };
}

const importsPath = "/configurations/imports";

/** The import of a repository at the head of what was pushed to it, each file its catalogs name read as the server reads them, then judged by the contract's judgment. */
function importedAt(
  site: SetupSite,
  repository: SetupSiteRepository,
): RepositoryConfigurationImportAttemptResponse["outcome"] {
  const tree =
    site.pushed.get(repository.repository) ?? new Map<string, string>();
  const files = [...tree.keys()]
    .filter(
      (path) =>
        path.startsWith(repositoryConfigurationRoot) && path.endsWith(".json"),
    )
    .map((path) => ({
      path,
      kind: "File" as const,
      content: tree.get(path) ?? "",
    }));
  if (files.length === 0)
    return { result: "SnapshotAbsent", absent: "ConfigurationDirectory" };
  const referenced = new Map<string, RepositoryConfigurationReferenced>();
  const unread = () =>
    repositoryConfigurationImportReferences(files, referenced).filter(
      (path) => !referenced.has(path),
    );
  for (let paths = unread(); paths.length > 0; paths = unread())
    for (const path of paths) {
      const content = tree.get(path);
      referenced.set(
        path,
        content === undefined
          ? { path, found: "Absent" }
          : { path, found: "File", content },
      );
    }
  const readiness = repositoryConfigurationFilesReadiness({
    files,
    referenced,
  });
  return readiness.readiness === "Ready"
    ? { result: "Imported" }
    : {
        result: "DeclarationsRefused",
        refusals: readiness.faults.map((fault) => fault.refusal),
        refusalCount: readiness.faults.length,
      };
}

/** What the site answers an import: the outcome kept on the binding, and the refusal the server answers it with. */
function imported(
  site: SetupSite,
  project: SetupSiteProject,
  body: string | undefined,
): SetupSiteAnswer {
  const asked = (JSON.parse(body ?? "{}") as { readonly repository?: string })
    .repository;
  const at = project.repositories.findIndex(
    (held) => held.repository.toLowerCase() === asked?.toLowerCase(),
  );
  const repository = project.repositories[at];
  if (repository === undefined) return refused();
  const outcome = importedAt(site, repository);
  project.repositories[at] = {
    ...repository,
    configured: repository.configured || outcome.result === "Imported",
    lastImport: { attemptedAt: "2026-11-15T00:00:00Z", outcome },
  };
  if (outcome.result === "Imported") return answered({ imported: true });
  return outcome.result === "DeclarationsRefused"
    ? {
        status: 422,
        body: {
          error: {
            code: "RepositoryConfigurationsRefused",
            message: "The repository configurations were refused.",
          },
          faults: outcome.refusals,
        },
      }
    : {
        status: 422,
        body: {
          error: {
            code: "RepositoryConfigurationsAbsent",
            message: "The commit declares no configurations.",
          },
        },
      };
}

function projectOf(
  site: SetupSite,
  tenant: string,
  named: string | undefined,
): SetupSiteProject | undefined {
  return site.projects.find(
    (held) =>
      held.tenant === tenant &&
      held.project === decodeURIComponent(named ?? ""),
  );
}

/** A write within a workspace: the mint for a project the caller is shown, the mint for their chat host, or nothing the site answers. */
function tenantWritten(
  site: SetupSite,
  tenant: string,
  rest: string,
  sent: SetupSiteSent,
): SetupSiteAnswer | undefined {
  if (sent.method === "POST" && rest === chatMintPath)
    return chatMinted(site, tenant, sent.body);
  const within = /^\/projects\/([^/]+)(\/.*)$/u.exec(rest);
  if (sent.method === "POST" && within?.[2] === "/repositories") {
    const project = projectOf(site, tenant, within[1]);
    return project === undefined ? refused() : bound(site, project, sent.body);
  }
  if (sent.method === "POST" && within?.[2] === "/drafts") {
    const project = projectOf(site, tenant, within[1]);
    return project === undefined ? refused() : filed(site, project, sent.body);
  }
  if (sent.method === "POST" && within?.[2] === "/operations") {
    const project = projectOf(site, tenant, within[1]);
    return project === undefined ? refused() : submitted(project, sent.body);
  }
  if (sent.method === "POST" && within?.[2] === importsPath) {
    const project = projectOf(site, tenant, within[1]);
    return project === undefined
      ? refused()
      : imported(site, project, sent.body);
  }
  if (sent.method !== "POST" || within?.[2] !== mintPath) return undefined;
  const project = projectOf(site, tenant, within[1]);
  return project === undefined ? refused() : minted(site, project, sent.body);
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
  if (rest === "/personal-runner-permit")
    return (
      fated(site, "permit") ?? answered({ granted: !site.withheld.has(tenant) })
    );
  if (rest === "/chat-host") return chatAnswered(site, tenant);
  if (rest === "/personal-runner") return personalAnswered(site, tenant);
  const settings = /^\/forge-installations\/([^/]+)\/permissions$/u.exec(rest);
  if (settings !== null)
    return administers
      ? settingsAnswered(site, tenant, decodeURIComponent(settings[1] ?? ""))
      : refused();
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
  const project = projectOf(site, tenant, within[1]);
  return project === undefined
    ? refused()
    : projectAnswered(site, project, within[2] ?? "", query);
}

/** A redemption as it is sent: the token and the pool's name, in a body the site reads. */
function redeemed(site: SetupSite, body: string | undefined): SetupSiteAnswer {
  const asked = JSON.parse(body ?? "{}") as {
    readonly token?: string;
    readonly pool?: string;
  };
  return setupSiteRedeemed(site, asked.token ?? "", asked.pool ?? "");
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
        .map((held) => ({
          tenant: held.tenant,
          project: held.project,
          name: held.name ?? held.project,
        })),
      ...(at < last || cut(site, "inventory")
        ? { nextCursor: String(at + 1) }
        : {}),
    })
  );
}

function conflict(code: string): SetupSiteAnswer {
  return { status: 409, body: { error: { code, message: "Conflict." } } };
}

/** Whether a name is one the site takes as what a project is called. */
const calledWhole = (name: string): boolean =>
  projectDisplayNameSchema.safeParse(name).success;

/**
 * A creation, as the site answers it: a project made in a workspace the caller
 * administers, the same project answered to the caller who made it asking
 * again under any operation, one another made refused as there, and a
 * workspace the caller does not administer refused as taken.
 */
function projectCreated(
  site: SetupSite,
  body: string | undefined,
): SetupSiteAnswer {
  const asked = JSON.parse(body ?? "{}") as {
    readonly tenant: string;
    readonly project: string;
    readonly name: string;
  };
  const { tenant, project, name } = asked;
  if (!calledWhole(name))
    return {
      status: 400,
      body: { error: { code: "ProjectDisplayNameInvalid", message: "No." } },
    };
  if (!site.tenants.some((held) => held.tenant === tenant && held.administer))
    return conflict("TenantTaken");
  const held = site.projects.find(
    (one) => one.tenant === tenant && one.project === project,
  );
  if (held !== undefined)
    return held.made === true
      ? answered({ tenant, project, name: held.name ?? project })
      : conflict("ProjectExists");
  site.projects.push({
    ...setupSiteProject(tenant, project),
    name: name.trim(),
    made: true,
  });
  return answered({ tenant, project, name: name.trim() });
}

/**
 * What the site answers a request of `target`, a path with its query: a read
 * unless `sent` says otherwise. Nothing is answered where the path is none of
 * the reads the program makes, or the request is a write that is none of the
 * ones it or a runner makes.
 */
export function setupSiteAnswered(
  site: SetupSite,
  target: string,
  sent: SetupSiteSent = { method: "GET" },
): SetupSiteAnswer | undefined {
  const url = new URL(target, "http://site.invalid");
  if (sent.method === "POST" && url.pathname === redeemPath)
    return redeemed(site, sent.body);
  if (sent.method === "POST" && url.pathname === "/api/v1/projects")
    return projectCreated(site, sent.body);
  if (sent.method === "POST" && url.pathname === chatRedeemPath)
    return setupSiteChatRedeemed(
      site,
      (JSON.parse(sent.body ?? "{}") as { readonly token?: string }).token ??
        "",
    );
  const tenant = /^\/api\/v1\/tenants\/([^/]+)(\/.*)$/u.exec(url.pathname);
  const named = decodeURIComponent(tenant?.[1] ?? "");
  const rest = tenant?.[2] ?? "";
  if (sent.method !== "GET")
    return tenant === null ? undefined : tenantWritten(site, named, rest, sent);
  if (tenant !== null)
    return tenantAnswered(site, named, rest, url.searchParams);
  if (url.pathname === "/access/v1/workspaces")
    return (
      fated(site, "workspaces") ??
      answered({ tenants: site.tenants, truncated: cut(site, "workspaces") })
    );
  if (url.pathname === "/api/v1/forge/github") return appsAnswered(site);
  return url.pathname === "/api/v1/projects"
    ? inventory(site, url.searchParams.get("cursor"))
    : undefined;
}
