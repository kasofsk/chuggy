/**
 * Claiming an account and binding a repository: which permit each question is
 * asked behind, and what each answer comes to.
 *
 * EVERY REFUSAL IS ASSERTED AS ITS OWN ANSWER. A refused permit, an account the
 * person does not own, a repository no source can reach and a project that is
 * not there are different answers to different questions, and a suite that
 * asserted only "not the happy one" would pass while any of them collapsed into
 * another.
 *
 * THE PERMIT ASKED IS RECORDED RATHER THAN ASSUMED. Each case reads back the
 * kind the service asked for, so an implementation that asked `Read` where it
 * should have asked `Administer` fails here rather than in a rig.
 *
 * THE CREDENTIAL IS THE PROOF AND IS NOT KEPT. A binding asks the credential
 * source whether it can reach the repository at all; the fixture answers a
 * token nothing reads, so a case asserting the outcome is asserting the verdict
 * rather than the value.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { forgeInstallationsAnsweredMax } from "../../src/contract/http.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryCredential,
  asRepositoryId,
  type CredentialResolved,
  type GitRefName,
  type RepositoryBinding,
  type RepositoryCredentialPort,
} from "../../src/interpreter/finalizer.ts";
import type {
  ForgeAccountInstallationRead,
  ForgeAppDescribed,
  ForgeInstallationAccount,
  ForgeRepositoriesRead,
  ForgeRepositorySummary,
} from "../../src/interpreter/forgeDirectory.ts";
import type {
  ForgeAuthorizationGrant,
  ForgeUserAuthorized,
  ForgeUserInstallation,
} from "../../src/interpreter/forgeAuthorization.ts";
import {
  asForgeAccount,
  asForgeAccountId,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
  asForgeRepositoryName,
  type ForgeAccountKind,
  type ForgeApp,
} from "../../src/interpreter/forgeInstallation.ts";
import type {
  ForgeInstallationClaim,
  ForgeInstallationClaimed,
  ForgeInstallationClaims,
  ForgeInstallationRecorded,
} from "../../src/interpreter/forgeInstallationClaim.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
  type ProjectAccessKind,
  type TenantAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import type {
  ProjectRepositoryBound,
  ProjectRepositoryLandingCommand,
  ProjectRepositoryLandingOutcome,
  ProjectRepositoryRetirementCommand,
  ProjectRepositoryRetirementOutcome,
  ProjectRepositoryRetirementStore,
  ProjectRepositoryLandingStore,
  RepositoryBindingCommand,
  RepositoryBindingOutcome,
  RepositoryLanding,
} from "../../src/interpreter/repositoryBinding.ts";
import {
  repositoryOnboarding,
  type RepositoryConfigurationsHeld,
  type RepositoryConfigurationsHeldRead,
  type RepositoryConfigurationsPorts,
  type RepositoryCreationPorts,
  type RepositoryOnboarding,
  type RepositoryOnboardingForgeApp,
  type RepositoryOnboardingPorts,
} from "../../src/interpreter/repositoryOnboarding.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  type CanonicalConfiguration,
  type ConfigurationCreated,
  type ConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import { bootstrapConfiguration } from "../../src/interpreter/bootstrapConfiguration.ts";
import type {
  RepositoryConfigurationsImported,
  RepositoryConfigurationSnapshotRead,
  RepositoryConfigurationSnapshotRequest,
  RepositoryDefaultBranchRead,
} from "../../src/interpreter/repositoryConfiguration.ts";
import type {
  ForgeRepositoryCreated,
  ForgeRepositoryCreationRequest,
  ForgeRepositoryRulesetCreated,
  ForgeRepositoryRulesetRequest,
  ForgeRepositorySeeded,
  ForgeRepositorySeedRequest,
  ForgeTemplateRepository,
} from "../../src/interpreter/forgeRepositoryCreation.ts";

const tenant = asTenantId("vteng");
const partition = { tenant, project: asProjectId("chuggy") };
const principal = asPrincipal("14:https://issuer/member");
const forge = asForgeId("github");
const app = asForgeApp("portal");
const worker = asForgeApp("worker");
const installationId = asForgeInstallationId("4242");
const repository = asRepositoryId("https://github.com/kasofsk/chuggy.git");
const operation = asOperationId("bind-chuggy-1");
const epoch = asRecoveryEpoch("epoch-1");
const madeBranch = asGitRefName("refs/heads/main");
const head = asGitObjectId("c".repeat(40));
const workerImage = `ghcr.io/kasofsk/chuggy-worker@sha256:${"d".repeat(64)}`;

/** One creation as a caller sends it, the account being the one both claims name. */
const creating = {
  account: asForgeAccount("kasofsk"),
  name: asForgeRepositoryName("engine"),
  visibility: "private" as const,
  operation,
};

/** The branch the repository was found at, which is what the import is run against. */
const branchHead: RepositoryDefaultBranchRead = {
  read: "Branch",
  branch: madeBranch,
  commit: head,
};

/** This tenant's claim of one app on the account, which is what `/new` needs two of. */
function fixtureClaimOf(
  held: ForgeApp,
  accountKind: ForgeAccountKind = "Organization",
): ForgeInstallationClaimed {
  return {
    forge,
    app: held,
    account: creating.account,
    accountKind,
    installationId: asForgeInstallationId(held === "portal" ? "8001" : "8002"),
    claimedAt: "2026-09-11T00:00:00Z",
  };
}

const claimed: ForgeInstallationClaimed = {
  forge,
  app,
  account: asForgeAccount("kasofsk"),
  accountKind: "Organization",
  installationId,
  claimedAt: "2026-09-11T00:00:00Z",
};

const summary: ForgeRepositorySummary = {
  name: asForgeRepositoryName("chuggy"),
  fullName: "kasofsk/chuggy",
  url: repository,
  defaultBranch: "main",
  private: true,
};

/** What one case grants: the kinds that answer, and the kinds it records being asked. */
interface FixtureAccess {
  readonly access: ProjectAccess;
  readonly askedProject: ProjectAccessKind[];
  readonly askedTenant: TenantAccessKind[];
}

function fixtureAccess(
  granted: readonly (ProjectAccessKind | TenantAccessKind)[],
): FixtureAccess {
  const askedProject: ProjectAccessKind[] = [];
  const askedTenant: TenantAccessKind[] = [];
  const answer = (kind: string) =>
    Promise.resolve(
      granted.includes(kind as ProjectAccessKind)
        ? memberAuthority(principal)
        : undefined,
    );
  return {
    askedProject,
    askedTenant,
    access: {
      authorize: (_principal, _partition, kind) => {
        askedProject.push(kind);
        return answer(kind);
      },
      authorizeTenant: (_principal, _tenant, kind) => {
        askedTenant.push(kind);
        return answer(kind);
      },
    },
  };
}

/**
 * What the configuration step a bind runs finds, or nothing at all — which is a
 * deployment holding no scratch, and is its own outcome.
 */
interface FixtureConfigurations {
  readonly head?: RepositoryDefaultBranchRead;
  /** Heads answered in turn before `head`, so a case can see a forge recover between two steps. */
  readonly heads?: readonly RepositoryDefaultBranchRead[];
  readonly snapshot?: RepositoryConfigurationSnapshotRead;
  readonly stored?: RepositoryConfigurationsImported;
  readonly authored?: ConfigurationCreated;
  readonly image?: string;
  readonly raising?: boolean;
}

/** What each of the three acts creating a repository answers, and what a personal account copies. */
interface FixtureCreation {
  readonly created?: ForgeRepositoryCreated;
  readonly seeded?: ForgeRepositorySeeded;
  readonly reserved?: ForgeRepositoryRulesetCreated;
  readonly template?: ForgeTemplateRepository;
}

/** Everything the service is composed with, each port answering one fixed thing. */
interface FixturePorts {
  readonly described?: ForgeAppDescribed;
  readonly found?: ForgeAccountInstallationRead;
  readonly authorized?: ForgeUserAuthorized;
  readonly repositories?: ForgeRepositoriesRead;
  readonly recorded?: ForgeInstallationRecorded;
  readonly held?: readonly ForgeInstallationClaimed[];
  readonly resolved?: CredentialResolved;
  readonly outcome?: RepositoryBindingOutcome;
  readonly landing?: RepositoryLanding;
  readonly landingOutcome?: ProjectRepositoryLandingOutcome;
  readonly retirementOutcome?: ProjectRepositoryRetirementOutcome;
  readonly apps?: readonly ForgeApp[];
  /** Apps held under a forge other than the one authorized. */
  readonly elsewhere?: readonly ForgeApp[];
  readonly configurations?: FixtureConfigurations;
  readonly creation?: FixtureCreation;
  /** What the project already holds from the configuration step, nothing where absent. */
  readonly stepHeld?: RepositoryConfigurationsHeld;
  /** The one binding retired, or not there at all. */
  readonly retiredAt?: string;
  readonly unbound?: boolean;
}

/**
 * What a case reads back: the claim recorded, the command the door was asked,
 * and which app's own half answered each forge question — without which a
 * service reading through the first half while recording the requested app
 * would pass every case that only asserts the label.
 */
interface FixtureWrites {
  readonly claims: ForgeInstallationClaim[];
  readonly commands: RepositoryBindingCommand[];
  readonly asked: ForgeApp[];
  readonly accounts: ForgeInstallationAccount[];
  readonly grants: ForgeAuthorizationGrant[];
  readonly listed: ForgeApp[];
  readonly heads: RepositoryBinding[];
  readonly snapshots: RepositoryConfigurationSnapshotRequest[];
  readonly authored: ConfigurationRevisionId[];
  readonly authoredCanonical: string[];
  readonly creations: ForgeRepositoryCreationRequest[];
  readonly seeds: ForgeRepositorySeedRequest[];
  readonly rulesets: ForgeRepositoryRulesetRequest[];
  readonly landings: ProjectRepositoryLandingCommand[];
  readonly retirements: ProjectRepositoryRetirementCommand[];
  readonly heldQueries: Parameters<
    RepositoryConfigurationsHeldRead["held"]
  >[0][];
}

/**
 * The claims this tenant holds, paged the way the durable side pages them and
 * looked up the way it looks one up. The page and the lookup are bounded
 * differently on purpose, so a service searching the page for an ownership test
 * misses a claim held past the bound.
 */
function fixtureClaims(
  held: readonly ForgeInstallationClaimed[],
): ForgeInstallationClaims {
  return {
    claims: (askedTenant) =>
      Promise.resolve(
        askedTenant === tenant
          ? {
              claims: held.slice(0, forgeInstallationsAnsweredMax),
              truncated: held.length > forgeInstallationsAnsweredMax,
            }
          : { claims: [], truncated: false },
      ),
    claim: (askedTenant, askedInstallation) =>
      Promise.resolve(
        askedTenant === tenant
          ? held.find((row) => row.installationId === askedInstallation)
          : undefined,
      ),
    accountClaim: (query) =>
      Promise.resolve(
        query.tenant === tenant
          ? held.find(
              (row) =>
                row.forge === query.forge &&
                row.app === query.app &&
                row.account === query.account,
            )
          : undefined,
      ),
  };
}

/**
 * The configuration step's own half. The binding read answers the binding the
 * bind just made, so a case is about what the reads of the repository found
 * rather than about whether the row is there.
 */
function fixtureConfigurations(
  given: FixtureConfigurations,
  wrote: FixtureWrites,
): RepositoryConfigurationsPorts {
  return {
    heads: {
      defaultBranch: (asked) => {
        wrote.heads.push(asked);
        const turn = given.heads?.[wrote.heads.length - 1];
        return given.raising === true
          ? Promise.reject(new Error("the scratch could not be written"))
          : Promise.resolve(
              turn ?? given.head ?? { read: "Unavailable" as const },
            );
      },
    },
    imports: {
      bindings: {
        binding: (askedPartition, askedRepository) =>
          Promise.resolve({
            partition: askedPartition,
            repository: askedRepository ?? repository,
            recoveryEpoch: epoch,
          }),
      },
      snapshots: {
        snapshot: (request) => {
          wrote.snapshots.push(request);
          return Promise.resolve(
            given.snapshot ?? {
              read: "Absent" as const,
              absent: "ConfigurationDirectory" as const,
            },
          );
        },
      },
      store: {
        importRepositoryConfigurations: () =>
          Promise.resolve(given.stored ?? { imported: "Imported" as const }),
      },
    },
    authoring: {
      createConfiguration: (input) => {
        wrote.authored.push(input.revision);
        wrote.authoredCanonical.push(input.canonical);
        return Promise.resolve(
          given.authored ?? {
            created: "Created" as const,
            revision: {
              partition: input.partition,
              revision: input.revision,
              canonical: input.canonical,
              digest: "sha256:bootstrap",
            },
          },
        );
      },
    },
    ...(given.image === undefined ? {} : { bootstrapImage: given.image }),
  };
}

/** The creation half, each of the three acts answering what the case gave it. */
function fixtureCreationPorts(
  given: FixtureCreation,
  wrote: FixtureWrites,
): RepositoryCreationPorts {
  return {
    forge,
    repositories: {
      create: (request) => {
        wrote.creations.push(request);
        return Promise.resolve(
          given.created ?? {
            created: "Repository" as const,
            repository: { url: repository, defaultBranch: madeBranch },
          },
        );
      },
      seed: (request) => {
        wrote.seeds.push(request);
        return Promise.resolve(given.seeded ?? { seeded: "Seeded" as const });
      },
      reserveDefaultBranch: (request) => {
        wrote.rulesets.push(request);
        return Promise.resolve(
          given.reserved ?? { created: "Ruleset" as const },
        );
      },
    },
    ...(given.template === undefined ? {} : { template: given.template }),
  };
}

/** One app's half of the ports, every read answering what the case gave it. */
function fixturePortsForgeHalf(
  given: FixturePorts,
  wrote: FixtureWrites,
  held: ForgeApp,
): RepositoryOnboardingForgeApp {
  return {
    forge,
    app: held,
    apps: {
      app: () =>
        Promise.resolve(
          given.described ?? { described: "Unavailable" as const },
        ),
    },
    directory: {
      accountInstallation: (account) => {
        wrote.asked.push(held);
        wrote.accounts.push(account);
        return Promise.resolve(given.found ?? { read: "Missing" as const });
      },
    },
    installationRepositories: {
      repositories: () => {
        wrote.listed.push(held);
        return Promise.resolve(
          given.repositories ?? { read: "Unavailable" as const },
        );
      },
    },
  };
}

/** The case's apps under the forge it authorizes, then any it holds elsewhere. */
function fixturePortsForgeApps(
  given: FixturePorts,
  wrote: FixtureWrites,
): readonly RepositoryOnboardingForgeApp[] {
  return [
    ...(given.apps ?? [app]).map((held) =>
      fixturePortsForgeHalf(given, wrote, held),
    ),
    ...(given.elsewhere ?? []).map((held) => ({
      ...fixturePortsForgeHalf(given, wrote, held),
      forge: asForgeId("gitlab"),
    })),
  ];
}

/** The instant the fixture retires at, so a case can assert the row it reads back. */
const fixtureRetiredAt = "2026-09-14T02:00:00Z";

/** The one binding every case's durable side holds, at whatever landing the case gives it. */
function fixtureBinding(given: FixturePorts): ProjectRepositoryBound {
  return {
    repository,
    boundAt: "2026-09-11T01:00:00Z",
    landing: given.landing ?? { mode: "Push" },
    ...(given.retiredAt === undefined ? {} : { retiredAt: given.retiredAt }),
  };
}

/** The held read, answering what the case gave it and recording what it was asked. */
function fixturePortsHeld(
  given: FixturePorts,
  wrote: FixtureWrites,
): RepositoryConfigurationsHeldRead {
  return {
    held: (query) => {
      wrote.heldQueries.push(query);
      return Promise.resolve(
        given.stepHeld ?? { declared: new Map(), bootstrap: undefined },
      );
    },
  };
}

/** The landing half, answering the one binding and recording what it was asked to write. */
function fixturePortsLanding(
  given: FixturePorts,
  wrote: FixtureWrites,
): ProjectRepositoryLandingStore {
  return {
    landing: () =>
      Promise.resolve(
        given.unbound === true ? undefined : fixtureBinding(given),
      ),
    setLanding: (command) => {
      wrote.landings.push(command);
      return Promise.resolve(
        given.landingOutcome ?? {
          outcome: "Written",
          binding: { ...fixtureBinding(given), landing: command.landing },
        },
      );
    },
  };
}

/** The retirement half, answering the one binding and recording what it was asked to retire. */
function fixturePortsRetirement(
  given: FixturePorts,
  wrote: FixtureWrites,
): ProjectRepositoryRetirementStore {
  return {
    retire: (command) => {
      wrote.retirements.push(command);
      return Promise.resolve(
        given.retirementOutcome ?? {
          outcome: "Retired",
          binding: { ...fixtureBinding(given), retiredAt: fixtureRetiredAt },
        },
      );
    },
  };
}

/** The authorization port where a case scripts what the forge authorized. */
function fixturePortsAuthorization(
  given: FixturePorts,
  wrote: FixtureWrites,
): Pick<RepositoryOnboardingPorts, "authorization"> {
  const authorized = given.authorized;
  if (authorized === undefined) return {};
  return {
    authorization: {
      forge,
      app,
      user: {
        authorized: (grant) => {
          wrote.grants.push(grant);
          return Promise.resolve(authorized);
        },
      },
    },
  };
}

function fixturePorts(
  access: ProjectAccess,
  given: FixturePorts,
): {
  readonly ports: RepositoryOnboardingPorts;
  readonly wrote: FixtureWrites;
} {
  const wrote: FixtureWrites = {
    claims: [],
    commands: [],
    asked: [],
    accounts: [],
    grants: [],
    listed: [],
    heads: [],
    snapshots: [],
    authored: [],
    authoredCanonical: [],
    creations: [],
    seeds: [],
    rulesets: [],
    landings: [],
    retirements: [],
    heldQueries: [],
  };
  const credentials: RepositoryCredentialPort = {
    credential: () =>
      Promise.resolve(given.resolved ?? { resolved: "Denied" as const }),
  };
  return {
    wrote,
    ports: {
      access,
      forgeApps: fixturePortsForgeApps(given, wrote),
      credentials,
      recording: {
        record: (claim) => {
          wrote.claims.push(claim);
          return Promise.resolve(given.recorded ?? "Recorded");
        },
      },
      claims: fixtureClaims(given.held ?? []),
      bindings: {
        bindings: () => Promise.resolve([fixtureBinding(given)]),
      },
      binding: {
        currentRecoveryEpoch: () => Promise.resolve(epoch),
        bind: (command) => {
          wrote.commands.push(command);
          return Promise.resolve(given.outcome ?? "Bound");
        },
      },
      landing: fixturePortsLanding(given, wrote),
      retirement: fixturePortsRetirement(given, wrote),
      configurationsHeld: fixturePortsHeld(given, wrote),
      ...(given.configurations === undefined
        ? {}
        : {
            configurations: fixtureConfigurations(given.configurations, wrote),
          }),
      ...(given.creation === undefined
        ? {}
        : { creation: fixtureCreationPorts(given.creation, wrote) }),
      ...fixturePortsAuthorization(given, wrote),
    },
  };
}

function fixtureService(
  granted: readonly (ProjectAccessKind | TenantAccessKind)[],
  given: FixturePorts = {},
): {
  readonly service: RepositoryOnboarding;
  readonly asked: FixtureAccess;
  readonly wrote: FixtureWrites;
} {
  const asked = fixtureAccess(granted);
  const { ports, wrote } = fixturePorts(asked.access, given);
  return { service: repositoryOnboarding(ports), asked, wrote };
}

const description = {
  id: "1",
  slug: "chuggy",
  installUrl: "https://forge/new",
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge/login/oauth/authorize",
} as const;

/** A redemption the forge refused, which is what an authorization port answers unless a case says otherwise. */
const fixtureRefused: ForgeUserAuthorized = { authorized: "Refused" };

/** What the console sends: a forge, and what the person's authorization came back with. */
const authorizing = {
  forge,
  code: "code-from-the-forge",
  redirectUri: "https://console.example/forge/github/callback",
  codeVerifier: "v".repeat(43),
};

/** The person the forge authorized, whose number is what proves an account theirs. */
const person = { id: asForgeAccountId("7"), login: asForgeAccount("geoff") };

/** The person's own account, carrying the portal app. */
const ownAccount: ForgeUserInstallation = {
  accountKind: "User",
  installationId: asForgeInstallationId("8001"),
  account: person.login,
  accountId: person.id,
};

/** An organization the person reaches, with their membership of it as the case gives it. */
function organizationOf(
  membership: Extract<
    ForgeUserInstallation,
    { accountKind: "Organization" }
  >["membership"],
): ForgeUserInstallation {
  return {
    accountKind: "Organization",
    installationId: asForgeInstallationId("8101"),
    account: asForgeAccount("kasofsk"),
    accountId: asForgeAccountId("500"),
    membership,
  };
}

/** What the forge answers the person reaches, the given installations and nothing past them. */
function reaching(
  ...installations: readonly ForgeUserInstallation[]
): Extract<ForgeUserAuthorized, { authorized: "User" }> {
  return { authorized: "User", user: person, installations, truncated: false };
}

/** The worker app's installation on the person's own account, as its own key finds it. */
const workerOnOwn: ForgeAccountInstallationRead = {
  read: "Installation",
  installationId: asForgeInstallationId("9001"),
  accountId: person.id,
};

test("every app this deployment holds is described, and holding none says so", async () => {
  const described = fixtureService([], {
    described: { described: "App", app: description },
    apps: [app, worker],
  });
  assert.deepEqual(await described.service.forgeApps(), {
    result: "Apps",
    apps: [
      { app, ...description },
      { app: worker, ...description },
    ],
  });
  const none = fixtureService([], { apps: [] });
  assert.deepEqual(await none.service.forgeApps(), { result: "NotConfigured" });
  const down = fixtureService([], { described: { described: "Unavailable" } });
  assert.deepEqual(await down.service.forgeApps(), { result: "Unavailable" });
});

test("the client a person authorizes is answered only where one can be redeemed", async () => {
  const redeeming = fixtureService([], {
    described: { described: "App", app: description },
    apps: [app, worker],
    authorized: fixtureRefused,
  });
  assert.deepEqual(await redeeming.service.forgeApps(), {
    result: "Apps",
    apps: [
      { app, ...description },
      { app: worker, ...description },
    ],
    authorization: {
      clientId: description.clientId,
      authorizeUrl: description.authorizeUrl,
    },
  });
});

test("an authorization is the tenant administrator's, and the forge is not asked otherwise", async () => {
  const refused = fixtureService([], { authorized: reaching(ownAccount) });
  assert.deepEqual(
    await refused.service.authorizeForge(principal, tenant, authorizing),
    { result: "NotFound" },
  );
  assert.deepEqual(refused.asked.askedTenant, ["AdministerTenant"]);
  assert.deepEqual(refused.wrote.grants, []);
  assert.deepEqual(refused.wrote.claims, []);
});

test("a deployment that cannot redeem an authorization says so", async () => {
  const none = fixtureService(["AdministerTenant"]);
  assert.deepEqual(
    await none.service.authorizeForge(principal, tenant, authorizing),
    { result: "NotConfigured" },
  );
  const elsewhere = fixtureService(["AdministerTenant"], {
    authorized: reaching(ownAccount),
  });
  assert.deepEqual(
    await elsewhere.service.authorizeForge(principal, tenant, {
      ...authorizing,
      forge: asForgeId("gitlab"),
    }),
    { result: "NotConfigured" },
  );
  assert.deepEqual(elsewhere.wrote.grants, []);
  assert.deepEqual(elsewhere.wrote.claims, []);
});

test("a proven account is claimed for the authorized forge's apps and no other forge's", async () => {
  const claiming = fixtureService(["AdministerTenant"], {
    apps: [app],
    elsewhere: [worker],
    authorized: reaching(ownAccount),
    found: workerOnOwn,
  });
  const answered = await claiming.service.authorizeForge(
    principal,
    tenant,
    authorizing,
  );
  assert.equal(answered.result, "Authorized");
  assert.deepEqual(
    answered.result === "Authorized" ? answered.accounts[0]?.apps : undefined,
    [{ app, claim: "Claimed" }],
  );
  assert.deepEqual(
    claiming.wrote.claims.map((claim) => [claim.forge, claim.app]),
    [[forge, app]],
  );
  assert.deepEqual(claiming.wrote.asked, []);
});

test("the person's own account is claimed for both apps, the worker's found under its own key", async () => {
  const claiming = fixtureService(["AdministerTenant"], {
    apps: [app, worker],
    authorized: reaching(ownAccount),
    found: workerOnOwn,
  });
  assert.deepEqual(
    await claiming.service.authorizeForge(principal, tenant, authorizing),
    {
      result: "Authorized",
      accounts: [
        {
          account: person.login,
          accountKind: "User",
          proof: "Proven",
          apps: [
            { app, claim: "Claimed" },
            { app: worker, claim: "Claimed" },
          ],
        },
      ],
      truncated: false,
    },
  );
  assert.deepEqual(claiming.wrote.grants, [
    {
      code: authorizing.code,
      redirectUri: authorizing.redirectUri,
      codeVerifier: authorizing.codeVerifier,
    },
  ]);
  assert.deepEqual(claiming.wrote.asked, [worker]);
  assert.deepEqual(claiming.wrote.accounts, [
    { account: person.login, accountKind: "User" },
  ]);
  assert.deepEqual(
    claiming.wrote.claims.map((claim) => [
      claim.app,
      claim.account,
      claim.accountKind,
      claim.installationId,
      claim.tenant,
      claim.authority.subject,
    ]),
    [
      [
        app,
        person.login,
        "User",
        ownAccount.installationId,
        tenant,
        memberAuthority(principal).subject,
      ],
      [
        worker,
        person.login,
        "User",
        asForgeInstallationId("9001"),
        tenant,
        memberAuthority(principal).subject,
      ],
    ],
  );
});

test("an account whose number is not the person's is not theirs, whatever its login", async () => {
  const renamed = fixtureService(["AdministerTenant"], {
    apps: [app, worker],
    authorized: reaching({ ...ownAccount, accountId: asForgeAccountId("8") }),
    found: workerOnOwn,
  });
  assert.deepEqual(
    await renamed.service.authorizeForge(principal, tenant, authorizing),
    {
      result: "Authorized",
      accounts: [
        {
          account: person.login,
          accountKind: "User",
          proof: "NotOwner",
          apps: [],
        },
      ],
      truncated: false,
    },
  );
  assert.deepEqual(renamed.wrote.claims, []);
  assert.deepEqual(renamed.wrote.asked, []);
});

test("an organization is claimed only for an active owner of it", async () => {
  const owner = fixtureService(["AdministerTenant"], {
    authorized: reaching(
      organizationOf({
        read: "Membership",
        organizationId: asForgeAccountId("500"),
        active: true,
        owner: true,
      }),
      organizationOf({
        read: "Membership",
        organizationId: asForgeAccountId("500"),
        active: true,
        owner: false,
      }),
    ),
  });
  const answered = await owner.service.authorizeForge(
    principal,
    tenant,
    authorizing,
  );
  assert.equal(answered.result, "Authorized");
  assert.deepEqual(
    answered.result === "Authorized"
      ? answered.accounts.map((account) => [
          account.accountKind,
          account.proof,
          account.apps,
        ])
      : [],
    [
      ["Organization", "Proven", [{ app, claim: "Claimed" }]],
      ["Organization", "NotOwner", []],
    ],
  );
  assert.deepEqual(
    owner.wrote.claims.map((claim) => [claim.account, claim.accountKind]),
    [[asForgeAccount("kasofsk"), "Organization"]],
  );
});

test("an organization whose membership the forge could not answer is not claimed", async () => {
  const waiting = fixtureService(["AdministerTenant"], {
    apps: [app, worker],
    authorized: reaching(organizationOf({ read: "Unavailable" })),
    found: workerOnOwn,
  });
  assert.deepEqual(
    await waiting.service.authorizeForge(principal, tenant, authorizing),
    {
      result: "Authorized",
      accounts: [
        {
          account: asForgeAccount("kasofsk"),
          accountKind: "Organization",
          proof: "Unavailable",
          apps: [],
        },
      ],
      truncated: false,
    },
  );
  assert.deepEqual(waiting.wrote.claims, []);
  assert.deepEqual(waiting.wrote.asked, []);
});

test("a worker installation missing, unreadable or on another account is not claimed", async () => {
  const cases: readonly (readonly [ForgeAccountInstallationRead, string])[] = [
    [{ read: "Missing" }, "Missing"],
    [{ read: "Unavailable" }, "Unavailable"],
    [{ ...workerOnOwn, accountId: asForgeAccountId("8") }, "Missing"],
  ];
  for (const [found, claim] of cases) {
    const claiming = fixtureService(["AdministerTenant"], {
      apps: [app, worker],
      authorized: reaching(ownAccount),
      found,
    });
    const answered = await claiming.service.authorizeForge(
      principal,
      tenant,
      authorizing,
    );
    assert.deepEqual(
      answered.result === "Authorized" ? answered.accounts[0]?.apps : [],
      [
        { app, claim: "Claimed" },
        { app: worker, claim },
      ],
    );
    assert.deepEqual(
      claiming.wrote.claims.map((recorded) => recorded.app),
      [app],
    );
  }
});

test("a replay is already claimed and a reinstall is claimed again", async () => {
  const replay = fixtureService(["AdministerTenant"], {
    authorized: reaching(ownAccount),
    recorded: "AlreadyRecorded",
  });
  const replayed = await replay.service.authorizeForge(
    principal,
    tenant,
    authorizing,
  );
  assert.deepEqual(
    replayed.result === "Authorized" ? replayed.accounts[0]?.apps : [],
    [{ app, claim: "AlreadyClaimed" }],
  );
  const moved = fixtureService(["AdministerTenant"], {
    authorized: reaching(ownAccount),
    recorded: "Reinstalled",
  });
  const reinstalled = await moved.service.authorizeForge(
    principal,
    tenant,
    authorizing,
  );
  assert.deepEqual(
    reinstalled.result === "Authorized" ? reinstalled.accounts[0]?.apps : [],
    [{ app, claim: "Claimed" }],
  );
});

test("a refused, spent or unreachable authorization claims nothing, and a partial one says so", async () => {
  const refused = fixtureService(["AdministerTenant"], {
    authorized: fixtureRefused,
  });
  assert.deepEqual(
    await refused.service.authorizeForge(principal, tenant, authorizing),
    { result: "Refused" },
  );
  assert.deepEqual(refused.wrote.claims, []);
  const down = fixtureService(["AdministerTenant"], {
    authorized: { authorized: "Unavailable" },
  });
  assert.deepEqual(
    await down.service.authorizeForge(principal, tenant, authorizing),
    { result: "Unavailable" },
  );
  assert.deepEqual(down.wrote.claims, []);
  const spent = fixtureService(["AdministerTenant"], {
    authorized: { authorized: "Spent" },
  });
  assert.deepEqual(
    await spent.service.authorizeForge(principal, tenant, authorizing),
    { result: "Spent" },
  );
  assert.deepEqual(spent.wrote.claims, []);
  const partial = fixtureService(["AdministerTenant"], {
    authorized: { ...reaching(), truncated: true },
  });
  assert.deepEqual(
    await partial.service.authorizeForge(principal, tenant, authorizing),
    { result: "Authorized", accounts: [], truncated: true },
  );
});

test("a deployment holding no app lists what it holds and reads none of it", async () => {
  const none = fixtureService(["AdministerTenant"], {
    apps: [],
    held: [claimed],
  });
  assert.deepEqual(await none.service.installations(principal, tenant), {
    result: "Installations",
    installations: [claimed],
    truncated: false,
  });
  assert.deepEqual(
    await none.service.installationRepositories(
      principal,
      tenant,
      installationId,
    ),
    { result: "NotConfigured" },
  );
});

test("what a worker installation grants is read as the worker app", async () => {
  const held = { ...claimed, app: worker };
  const reading = fixtureService(["AdministerTenant"], {
    held: [held],
    apps: [app, worker],
    repositories: {
      read: "Repositories",
      repositories: [summary],
      truncated: false,
    },
  });
  assert.deepEqual(
    await reading.service.installationRepositories(
      principal,
      tenant,
      installationId,
    ),
    { result: "Repositories", repositories: [summary], truncated: false },
  );
  assert.deepEqual(reading.wrote.listed, [worker]);
  const portalOnly = fixtureService(["AdministerTenant"], { held: [held] });
  assert.deepEqual(
    await portalOnly.service.installationRepositories(
      principal,
      tenant,
      installationId,
    ),
    { result: "NotConfigured" },
  );
});

test("the installations a tenant holds are the tenant administrator's to read", async () => {
  const refused = fixtureService([], { held: [claimed] });
  assert.deepEqual(await refused.service.installations(principal, tenant), {
    result: "NotFound",
  });
  const reading = fixtureService(["AdministerTenant"], { held: [claimed] });
  assert.deepEqual(await reading.service.installations(principal, tenant), {
    result: "Installations",
    installations: [claimed],
    truncated: false,
  });
});

/** One tenant's claims, one per installation identity, past the listing's own bound. */
function manyClaims(): readonly ForgeInstallationClaimed[] {
  return Array.from(
    { length: forgeInstallationsAnsweredMax + 1 },
    (_unused, index) => ({
      ...claimed,
      account: asForgeAccount(`account-${String(index)}`),
      installationId: asForgeInstallationId(String(index + 1)),
    }),
  );
}

test("a claim past the listing's page is still one the tenant holds", async () => {
  const held = manyClaims();
  const last = held[held.length - 1];
  const many = fixtureService(["AdministerTenant"], {
    held,
    repositories: {
      read: "Repositories",
      repositories: [summary],
      truncated: false,
    },
  });
  assert.deepEqual(
    await many.service.installationRepositories(
      principal,
      tenant,
      last?.installationId ?? installationId,
    ),
    { result: "Repositories", repositories: [summary], truncated: false },
  );
  const listed = await many.service.installations(principal, tenant);
  assert.equal(listed.result === "Installations" && listed.truncated, true);
  assert.equal(
    listed.result === "Installations" && listed.installations.length,
    forgeInstallationsAnsweredMax,
  );
});

test("an installation another tenant claimed is not this tenant's to read", async () => {
  const other = fixtureService(["AdministerTenant"], {
    held: [claimed],
    repositories: {
      read: "Repositories",
      repositories: [summary],
      truncated: false,
    },
  });
  assert.deepEqual(
    await other.service.installationRepositories(
      principal,
      asTenantId("stranger"),
      installationId,
    ),
    { result: "NotFound" },
  );
  assert.deepEqual(other.wrote.listed, []);
});

test("a claim this tenant holds is still not a reader's without the permit", async () => {
  const refused = fixtureService([], {
    held: [claimed],
    repositories: {
      read: "Repositories",
      repositories: [summary],
      truncated: false,
    },
  });
  assert.deepEqual(
    await refused.service.installationRepositories(
      principal,
      tenant,
      installationId,
    ),
    { result: "NotFound" },
  );
  assert.deepEqual(refused.wrote.listed, []);
});

test("an installation this tenant has not claimed grants it nothing", async () => {
  const other = fixtureService(["AdministerTenant"], {
    held: [{ ...claimed, installationId: asForgeInstallationId("9999") }],
    repositories: {
      read: "Repositories",
      repositories: [summary],
      truncated: false,
    },
  });
  assert.deepEqual(
    await other.service.installationRepositories(
      principal,
      tenant,
      installationId,
    ),
    { result: "NotFound" },
  );
});

test("what an installation grants is answered with whether it is all of it", async () => {
  const listing = fixtureService(["AdministerTenant"], {
    held: [claimed],
    repositories: {
      read: "Repositories",
      repositories: [summary],
      truncated: true,
    },
  });
  assert.deepEqual(
    await listing.service.installationRepositories(
      principal,
      tenant,
      installationId,
    ),
    { result: "Repositories", repositories: [summary], truncated: true },
  );
  const denied = fixtureService(["AdministerTenant"], {
    held: [claimed],
    repositories: { read: "Denied" },
  });
  assert.deepEqual(
    await denied.service.installationRepositories(
      principal,
      tenant,
      installationId,
    ),
    { result: "NotFound" },
  );
  const down = fixtureService(["AdministerTenant"], {
    held: [claimed],
    repositories: { read: "Unavailable" },
  });
  assert.deepEqual(
    await down.service.installationRepositories(
      principal,
      tenant,
      installationId,
    ),
    { result: "Unavailable" },
  );
});

test("a binding is the project administrator's, under the epoch the service read", async () => {
  const refused = fixtureService(["Read"]);
  assert.deepEqual(
    await refused.service.bindRepository(principal, partition, {
      repository,
      operation,
    }),
    { result: "NotFound" },
  );
  assert.deepEqual(refused.asked.askedProject, ["Administer"]);
  assert.deepEqual(refused.wrote.commands, []);

  const binding = fixtureService(["Administer"], {
    resolved: {
      resolved: "Credential",
      credential: asRepositoryCredential("ghs-proof"),
    },
  });
  assert.deepEqual(
    await binding.service.bindRepository(principal, partition, {
      repository,
      operation,
    }),
    {
      result: "Bound",
      repository,
      landing: { mode: "Push" },
      configurations: { result: "Deferred", reason: "NotConfigured" },
    },
  );
  const [command] = binding.wrote.commands;
  assert.equal(command?.recoveryEpoch, epoch);
  assert.equal(command?.operation, operation);
  assert.equal(command?.authority.subject, memberAuthority(principal).subject);
});

test("a repository no source can reach is the request's fault and an outage is a wait", async () => {
  const denied = fixtureService(["Administer"], {
    resolved: { resolved: "Denied" },
  });
  assert.deepEqual(
    await denied.service.bindRepository(principal, partition, {
      repository,
      operation,
    }),
    { result: "NotInstalled" },
  );
  assert.deepEqual(denied.wrote.commands, []);
  const down = fixtureService(["Administer"], {
    resolved: { resolved: "Unavailable" },
  });
  assert.deepEqual(
    await down.service.bindRepository(principal, partition, {
      repository,
      operation,
    }),
    { result: "Unavailable" },
  );
  assert.deepEqual(down.wrote.commands, []);
});

test("every outcome the bind door answers with is carried out as its own", async () => {
  const proved: CredentialResolved = {
    resolved: "Credential",
    credential: asRepositoryCredential("ghs-proof"),
  };
  const expected: readonly (readonly [RepositoryBindingOutcome, string])[] = [
    ["Bound", "Bound"],
    ["AlreadyBound", "AlreadyBound"],
    ["OperationConflict", "OperationConflict"],
    ["RepositoryBoundElsewhere", "BoundElsewhere"],
    ["RecoveryEpochMismatch", "EpochChanged"],
    ["ProjectAbsent", "NotFound"],
  ];
  for (const [outcome, result] of expected) {
    const bound = fixtureService(["Administer"], { resolved: proved, outcome });
    assert.equal(
      (
        await bound.service.bindRepository(principal, partition, {
          repository,
          operation,
        })
      ).result,
      result,
      outcome,
    );
  }
});

test("what a project binds is its readers' to read and nobody else's", async () => {
  const refused = fixtureService(["Administer"]);
  assert.deepEqual(
    await refused.service.projectRepositories(principal, partition),
    { result: "NotFound" },
  );
  assert.deepEqual(refused.asked.askedProject, ["Read"]);
  const reading = fixtureService(["Read"]);
  assert.deepEqual(
    await reading.service.projectRepositories(principal, partition),
    {
      result: "Repositories",
      repositories: [
        {
          repository,
          boundAt: "2026-09-11T01:00:00Z",
          landing: { mode: "Push" },
          configured: false,
        },
      ],
    },
  );
});

/** A binding the credential source proves, which is what every configuration case starts from. */
const credentialProved: CredentialResolved = {
  resolved: "Credential",
  credential: asRepositoryCredential("ghs-proof"),
};

async function fixtureBound(given: FixturePorts) {
  const composed = fixtureService(["Administer"], {
    resolved: credentialProved,
    ...given,
  });
  const bound = await composed.service.bindRepository(principal, partition, {
    repository,
    operation,
  });
  return { bound, wrote: composed.wrote };
}

test("a bind with no configuration step composed defers and says so", async () => {
  const { bound } = await fixtureBound({});
  assert.deepEqual(bound, {
    result: "Bound",
    repository,
    landing: { mode: "Push" },
    configurations: { result: "Deferred", reason: "NotConfigured" },
  });
});

test("a bound repository is imported at its own head and not at a remembered one", async () => {
  const { bound, wrote } = await fixtureBound({
    configurations: {
      head: branchHead,
      snapshot: { read: "Snapshot", files: [] },
      image: workerImage,
    },
  });
  assert.deepEqual(bound, {
    result: "Bound",
    repository,
    landing: { mode: "Push" },
    configurations: { result: "Imported", count: 0 },
  });
  assert.deepEqual(wrote.heads, [
    { partition, repository, recoveryEpoch: epoch },
  ]);
  assert.equal(wrote.snapshots[0]?.commit, head);
  assert.deepEqual(wrote.authored, []);
});

test("a repository declaring no configurations is authored the bootstrap", async () => {
  const { bound, wrote } = await fixtureBound({
    configurations: {
      head: branchHead,
      snapshot: { read: "Absent", absent: "ConfigurationDirectory" },
      image: workerImage,
    },
  });
  assert.deepEqual(bound, {
    result: "Bound",
    repository,
    landing: { mode: "Push" },
    configurations: { result: "Bootstrapped", revision: "bootstrap" },
  });
  assert.deepEqual(wrote.authored, ["bootstrap"]);
});

/** A branch neither fixture default is, so a constant fed in its place is visible. */
const bootstrapBranch = asGitRefName("refs/heads/trunk");

/** The brief line the generated document carries the default branch in. */
function bootstrapConstraint(branch: GitRefName): string {
  return `The repository's default branch is ${branch}.`;
}

test("the bootstrap a bind authors names the branch the repository is at", async () => {
  const { wrote } = await fixtureBound({
    configurations: {
      head: { read: "Branch", branch: bootstrapBranch, commit: head },
      snapshot: { read: "Absent", absent: "ConfigurationDirectory" },
      image: workerImage,
    },
  });
  assert.ok(
    wrote.authoredCanonical[0]?.includes(bootstrapConstraint(bootstrapBranch)),
    "the first ticket is briefed against the branch the repository was read at",
  );
});

test("a deployment naming no bootstrap image authors none and says which", async () => {
  const { bound, wrote } = await fixtureBound({
    configurations: {
      head: branchHead,
      snapshot: { read: "Absent", absent: "ConfigurationDirectory" },
    },
  });
  assert.deepEqual(bound, {
    result: "Bound",
    repository,
    landing: { mode: "Push" },
    configurations: { result: "Deferred", reason: "NoBootstrapImage" },
  });
  assert.deepEqual(wrote.authored, []);
});

test("a port that raises inside the step is a deferral and not a failed bind", async () => {
  const { bound, wrote } = await fixtureBound({
    configurations: { raising: true, image: workerImage },
  });
  assert.deepEqual(bound, {
    result: "Bound",
    repository,
    landing: { mode: "Push" },
    configurations: { result: "Deferred", reason: "StepFailed" },
  });
  assert.equal(wrote.commands.length, 1);
  assert.deepEqual(wrote.authored, []);
});

test("a project already holding a different bootstrap is told so and stays bound", async () => {
  const { bound } = await fixtureBound({
    configurations: {
      head: branchHead,
      snapshot: { read: "Absent", absent: "ConfigurationDirectory" },
      image: workerImage,
      authored: { created: "IdentityConflict" },
    },
  });
  assert.deepEqual(bound, {
    result: "Bound",
    repository,
    landing: { mode: "Push" },
    configurations: { result: "Deferred", reason: "IdentityConflict" },
  });
});

test("the same bootstrap authored twice is the revision it already is", async () => {
  const { bound } = await fixtureBound({
    configurations: {
      head: branchHead,
      snapshot: { read: "Absent", absent: "ConfigurationDirectory" },
      image: workerImage,
      authored: {
        created: "AlreadyExists",
        revision: {
          partition,
          revision: asConfigurationRevisionId("bootstrap"),
          canonical: asCanonicalConfiguration("{}"),
          digest: "sha256:bootstrap",
        },
      },
    },
  });
  assert.deepEqual(bound, {
    result: "Bound",
    repository,
    landing: { mode: "Push" },
    configurations: { result: "Bootstrapped", revision: "bootstrap" },
  });
});

test("every way the step can stop is its own deferral and never a refused bind", async () => {
  const cases: readonly (readonly [FixtureConfigurations, string])[] = [
    [{ head: { read: "Absent" } }, "DefaultBranchAbsent"],
    [{ head: { read: "Unavailable" } }, "DefaultBranchUnavailable"],
    [
      { head: branchHead, snapshot: { read: "Absent", absent: "Commit" } },
      "SnapshotAbsent",
    ],
    [
      {
        head: branchHead,
        snapshot: { read: "Unavailable", unavailable: "Repository" },
      },
      "SnapshotUnavailable",
    ],
    [
      {
        head: branchHead,
        snapshot: { read: "Refused", refused: "Snapshot" },
      },
      "SnapshotRefused",
    ],
    [
      {
        head: branchHead,
        snapshot: {
          read: "Snapshot",
          files: [{ path: "nonsense", kind: "File", content: "{}" }],
        },
      },
      "DeclarationsRefused",
    ],
    [
      {
        head: branchHead,
        snapshot: { read: "Snapshot", files: [] },
        stored: { imported: "StaleBinding" },
      },
      "StaleBinding",
    ],
    [
      {
        head: branchHead,
        snapshot: { read: "Snapshot", files: [] },
        stored: { imported: "IdentityConflict" },
      },
      "IdentityConflict",
    ],
  ];
  for (const [configurations, reason] of cases) {
    const { bound } = await fixtureBound({ configurations });
    assert.deepEqual(
      bound,
      {
        result: "Bound",
        repository,
        landing: { mode: "Push" },
        configurations: { result: "Deferred", reason },
      },
      reason,
    );
  }
});

test("a repository already bound runs no configuration step at all", async () => {
  const { bound, wrote } = await fixtureBound({
    outcome: "AlreadyBound",
    configurations: {
      head: branchHead,
      snapshot: { read: "Absent", absent: "ConfigurationDirectory" },
      image: workerImage,
    },
  });
  assert.deepEqual(bound, { result: "AlreadyBound", repository });
  assert.deepEqual(wrote.heads, []);
  assert.deepEqual(wrote.snapshots, []);
  assert.deepEqual(wrote.authored, []);
});

/** Creating one repository under a project whose administrator asked for it. */
async function fixtureCreated(given: FixturePorts = {}) {
  const composed = fixtureService(["Administer"], {
    resolved: credentialProved,
    held: [fixtureClaimOf(app), fixtureClaimOf(worker)],
    creation: {},
    configurations: {
      head: branchHead,
      snapshot: { read: "Absent", absent: "ConfigurationDirectory" },
      image: workerImage,
    },
    ...given,
  });
  const created = await composed.service.createRepository(
    principal,
    partition,
    creating,
  );
  return { created, wrote: composed.wrote, asked: composed.asked };
}

test("creating a repository is the project's administrator's and nobody else's", async () => {
  const reading = fixtureService(["Read"], { creation: {} });
  assert.deepEqual(
    await reading.service.createRepository(principal, partition, creating),
    { result: "NotFound" },
  );
  assert.deepEqual(reading.asked.askedProject, ["Administer"]);
});

test("a deployment composing no creation half creates nothing", async () => {
  const composed = fixtureService(["Administer"]);
  assert.deepEqual(
    await composed.service.createRepository(principal, partition, creating),
    { result: "NotConfigured" },
  );
});

test("a repository is made, seeded, reserved and bound under one authority", async () => {
  const { created, wrote } = await fixtureCreated();
  assert.deepEqual(created, {
    result: "Created",
    repository,
    landing: { mode: "Push" },
    created: {
      account: creating.account,
      name: creating.name,
      url: repository,
    },
    seeded: true,
    ruleset: { result: "Created" },
    configurations: { result: "Bootstrapped", revision: "bootstrap" },
  });
  assert.equal(wrote.creations[0]?.creation.mode, "Organization");
  assert.equal(wrote.seeds[0]?.branch, madeBranch);
  assert.equal(wrote.rulesets[0]?.name, creating.name);
  assert.deepEqual(wrote.commands[0]?.operation, operation);
});

test("the bootstrap a creation seeds names the branch the forge made", async () => {
  const { wrote } = await fixtureCreated({
    creation: {
      created: {
        created: "Repository",
        repository: { url: repository, defaultBranch: bootstrapBranch },
      },
    },
  });
  assert.ok(
    wrote.seeds[0]?.content.includes(bootstrapConstraint(bootstrapBranch)),
    "the first ticket is briefed against the branch the repository was made at",
  );
});

test("the repository is made under the portal claim of the account named", async () => {
  const { wrote } = await fixtureCreated();
  assert.deepEqual(wrote.creations[0]?.installation, {
    forge,
    app,
    account: creating.account,
    installationId: asForgeInstallationId("8001"),
  });
});

test("either claim missing refuses and names which app is not claimed", async () => {
  const withoutWorker = await fixtureCreated({
    held: [fixtureClaimOf(app)],
  });
  assert.deepEqual(withoutWorker.created, {
    result: "InstallationMissing",
    app: worker,
  });
  assert.deepEqual(withoutWorker.wrote.creations, []);
  const withoutPortal = await fixtureCreated({
    held: [fixtureClaimOf(worker)],
  });
  assert.deepEqual(withoutPortal.created, {
    result: "InstallationMissing",
    app,
  });
  assert.deepEqual(withoutPortal.wrote.creations, []);
});

test("a personal account is copied from a template and never sent to the organization endpoint", async () => {
  const template: ForgeTemplateRepository = {
    account: asForgeAccount("kasofsk"),
    name: asForgeRepositoryName("chuggy-template"),
  };
  const { created, wrote } = await fixtureCreated({
    held: [fixtureClaimOf(app, "User"), fixtureClaimOf(worker, "User")],
    creation: { template },
  });
  assert.equal(created.result, "Created");
  assert.deepEqual(wrote.creations[0]?.creation, {
    mode: "Template",
    template,
  });
});

test("a personal account with no template is told to create it on the forge", async () => {
  const { created, wrote } = await fixtureCreated({
    held: [fixtureClaimOf(app, "User"), fixtureClaimOf(worker, "User")],
  });
  assert.deepEqual(created, { result: "PersonalAccountCreatesOnGitHub" });
  assert.deepEqual(wrote.creations, []);
});

test("a name already taken points at the bind route and makes nothing", async () => {
  const { created, wrote } = await fixtureCreated({
    creation: { created: { created: "Exists" } },
  });
  assert.deepEqual(created, { result: "RepositoryExists" });
  assert.deepEqual(wrote.seeds, []);
  assert.deepEqual(wrote.commands, []);
});

test("each act the forge refuses names the step it refused", async () => {
  const refusedCreate = await fixtureCreated({
    creation: { created: { created: "Refused", message: "no such org" } },
  });
  assert.deepEqual(refusedCreate.created, {
    result: "ForgeRefused",
    step: "create",
    message: "no such org",
  });
  const refusedSeed = await fixtureCreated({
    creation: { seeded: { seeded: "Refused", message: "protected" } },
  });
  assert.deepEqual(refusedSeed.created, {
    result: "ForgeRefused",
    step: "seed",
    message: "protected",
  });
  assert.deepEqual(refusedSeed.wrote.rulesets, []);
});

test("a forge that did not answer the create is a wait and not a refusal", async () => {
  const { created } = await fixtureCreated({
    creation: { created: { created: "Unavailable" } },
  });
  assert.deepEqual(created, { result: "Unavailable" });
});

test("a seed the forge did not answer is a wait and not a refusal", async () => {
  const { created, wrote } = await fixtureCreated({
    creation: { seeded: { seeded: "Unavailable" } },
  });
  assert.deepEqual(created, { result: "Unavailable" });
  assert.deepEqual(wrote.rulesets, []);
  assert.deepEqual(wrote.commands, []);
});

test("a deployment naming no image creates the repository unseeded and reserves nothing", async () => {
  const { created, wrote } = await fixtureCreated({
    configurations: { head: { read: "Absent" } },
  });
  assert.deepEqual(created, {
    result: "Created",
    repository,
    landing: { mode: "Push" },
    created: {
      account: creating.account,
      name: creating.name,
      url: repository,
    },
    seeded: false,
    ruleset: { result: "Skipped" },
    configurations: { result: "Deferred", reason: "DefaultBranchAbsent" },
  });
  assert.deepEqual(wrote.seeds, []);
  assert.deepEqual(wrote.rulesets, []);
});

test("a refused ruleset leaves the repository standing and says so", async () => {
  const { created } = await fixtureCreated({
    creation: {
      reserved: { created: "Refused", message: "rulesets are not available" },
    },
  });
  assert.equal(created.result, "Created");
  if (created.result !== "Created") return;
  assert.deepEqual(created.ruleset, {
    result: "Refused",
    message: "rulesets are not available",
  });
});

test("a ruleset the forge did not answer is neither created nor refused", async () => {
  const { created } = await fixtureCreated({
    creation: { reserved: { created: "Unavailable" } },
  });
  assert.equal(created.result, "Created");
  if (created.result !== "Created") return;
  assert.deepEqual(created.ruleset, { result: "Unavailable" });
});

test("a binding the door refused is answered as that refusal and not as a creation", async () => {
  const { created } = await fixtureCreated({
    outcome: "RepositoryBoundElsewhere",
  });
  assert.deepEqual(created, {
    result: "BindRefused",
    bind: { result: "BoundElsewhere" },
  });
});

/** A landing neither fixture default is, so a value the service invented is visible. */
const proposing: RepositoryLanding = { mode: "PullRequest" };

async function fixtureLanded(
  granted: readonly (ProjectAccessKind | TenantAccessKind)[],
  given: FixturePorts = {},
) {
  const composed = fixtureService(granted, given);
  const written = await composed.service.setLanding(
    principal,
    partition,
    repository,
    { mode: "Push" },
    proposing,
  );
  return { written, asked: composed.asked, wrote: composed.wrote };
}

test("moving where a repository lands is asked behind the permit that binds one", async () => {
  const { written, asked, wrote } = await fixtureLanded(["Administer"]);
  assert.deepEqual(asked.askedProject, ["Administer"]);
  assert.deepEqual(wrote.landings, [
    {
      partition,
      repository,
      expected: { mode: "Push" },
      landing: proposing,
    },
  ]);
  assert.deepEqual(written, {
    result: "Written",
    repository: { ...fixtureBinding({}), landing: proposing },
  });
});

test("a project this caller may only read is not one whose landing they may move", async () => {
  const { written, wrote } = await fixtureLanded(["Read"]);
  assert.deepEqual(written, { result: "NotFound" });
  assert.deepEqual(wrote.landings, [], "the door was never asked");
});

test("a landing that moved under the writer is answered with the one that stands", async () => {
  const standing = { ...fixtureBinding({}), landing: proposing };
  const { written } = await fixtureLanded(["Administer"], {
    landingOutcome: { outcome: "LandingMoved", binding: standing },
  });
  assert.deepEqual(written, { result: "LandingMoved", repository: standing });
});

test("a repository this project does not bind has no landing to move", async () => {
  const { written } = await fixtureLanded(["Administer"], {
    landingOutcome: { outcome: "NotBound" },
  });
  assert.deepEqual(written, { result: "NotBound" });
});

test("a write that could not be completed is answered as a write to try again", async () => {
  const { written } = await fixtureLanded(["Administer"], {
    landingOutcome: { outcome: "Unavailable" },
  });
  assert.deepEqual(written, { result: "Unavailable" });
});

test("a bound repository answers the landing its binding holds and not an assumed one", async () => {
  const { bound } = await fixtureBound({ landing: proposing });
  assert.deepEqual(bound, {
    result: "Bound",
    repository,
    landing: proposing,
    configurations: { result: "Deferred", reason: "NotConfigured" },
  });
});

async function fixtureRetired(
  granted: readonly (ProjectAccessKind | TenantAccessKind)[],
  given: FixturePorts = {},
) {
  const composed = fixtureService(granted, given);
  const written = await composed.service.retireRepository(
    principal,
    partition,
    repository,
  );
  return { written, asked: composed.asked, wrote: composed.wrote };
}

test("retiring a binding is asked behind the permit that binds one", async () => {
  const { written, asked, wrote } = await fixtureRetired(["Administer"]);
  assert.deepEqual(asked.askedProject, ["Administer"]);
  assert.deepEqual(wrote.retirements, [{ partition, repository }]);
  assert.deepEqual(written, {
    result: "Retired",
    repository: { ...fixtureBinding({}), retiredAt: fixtureRetiredAt },
  });
});

test("a project this caller may only read is not one whose binding they may retire", async () => {
  const { written, wrote } = await fixtureRetired(["Read"]);
  assert.deepEqual(written, { result: "NotFound" });
  assert.deepEqual(wrote.retirements, [], "the door was never asked");
});

test("a repository this project does not bind has no binding to retire", async () => {
  const { written } = await fixtureRetired(["Administer"], {
    retirementOutcome: { outcome: "NotBound" },
  });
  assert.deepEqual(written, { result: "NotBound" });
});

test("a retirement that could not be completed is answered as one to try again", async () => {
  const { written } = await fixtureRetired(["Administer"], {
    retirementOutcome: { outcome: "Unavailable" },
  });
  assert.deepEqual(written, { result: "Unavailable" });
});

/** The bootstrap the step authors for this repository, which releases as it stands. */
const readyBootstrap = bootstrapConfiguration({
  repository,
  defaultBranch: madeBranch,
  image: workerImage,
});

/** A bootstrap the release rule refuses, as one authored before the rule grew is. */
const unreadyBootstrap = asCanonicalConfiguration('{"image":"","version":1}');

/** A repository that declares nothing, read at a head that answers, under an image to author against. */
const undeclared: FixtureConfigurations = {
  head: branchHead,
  snapshot: { read: "Absent", absent: "ConfigurationDirectory" },
  image: workerImage,
};

async function fixtureConfigured(
  granted: readonly (ProjectAccessKind | TenantAccessKind)[],
  given: FixturePorts = {},
) {
  const composed = fixtureService(granted, given);
  const configured = await composed.service.configureRepository(
    principal,
    partition,
    repository,
  );
  return { configured, asked: composed.asked, wrote: composed.wrote };
}

test("configuring a binding again is asked behind the permit that binds one", async () => {
  const { configured, asked, wrote } = await fixtureConfigured(["Read"], {
    configurations: undeclared,
  });
  assert.deepEqual(configured, { result: "NotFound" });
  assert.deepEqual(asked.askedProject, ["Administer"]);
  assert.deepEqual(wrote.heldQueries, [], "nothing was read for the caller");
  assert.deepEqual(wrote.heads, []);
  assert.deepEqual(wrote.authored, []);
});

test("a step that deferred at the bind bootstraps when asked again once the forge answers", async () => {
  const composed = fixtureService(["Administer"], {
    resolved: credentialProved,
    configurations: {
      ...undeclared,
      heads: [{ read: "Unavailable" }],
    },
  });
  const bound = await composed.service.bindRepository(principal, partition, {
    repository,
    operation,
  });
  assert.deepEqual(bound.result === "Bound" && bound.configurations, {
    result: "Deferred",
    reason: "DefaultBranchUnavailable",
  });
  assert.deepEqual(composed.wrote.authored, []);
  assert.deepEqual(
    await composed.service.configureRepository(
      principal,
      partition,
      repository,
    ),
    {
      result: "Configurations",
      repository,
      configurations: { result: "Bootstrapped", revision: "bootstrap" },
    },
  );
  assert.deepEqual(composed.wrote.authored, ["bootstrap"]);
  assert.deepEqual(composed.wrote.heads.at(-1), {
    partition,
    repository,
    recoveryEpoch: epoch,
  });
  assert.deepEqual(composed.wrote.heldQueries, [
    { partition, repositories: [repository], bootstrap: "bootstrap" },
  ]);
});

test("a repository the project already holds configurations for answers them and reads nothing", async () => {
  const cases: readonly (readonly [RepositoryConfigurationsHeld, unknown])[] = [
    [
      { declared: new Map([[repository, 2]]), bootstrap: readyBootstrap },
      { result: "Imported", count: 2 },
    ],
    [
      { declared: new Map(), bootstrap: readyBootstrap },
      { result: "Bootstrapped", revision: "bootstrap" },
    ],
  ];
  for (const [stepHeld, configurations] of cases) {
    const { configured, wrote } = await fixtureConfigured(["Administer"], {
      configurations: undeclared,
      stepHeld,
    });
    assert.deepEqual(configured, {
      result: "Configurations",
      repository,
      configurations,
    });
    assert.deepEqual(wrote.heads, [], "the repository was not read");
    assert.deepEqual(wrote.authored, [], "nothing was authored");
  }
});

test("names another repository declared are not this repository's configurations", async () => {
  const elsewhere = asRepositoryId("https://github.com/kasofsk/other.git");
  const { configured, wrote } = await fixtureConfigured(["Administer"], {
    configurations: undeclared,
    stepHeld: { declared: new Map([[elsewhere, 3]]), bootstrap: undefined },
  });
  assert.deepEqual(configured, {
    result: "Configurations",
    repository,
    configurations: { result: "Bootstrapped", revision: "bootstrap" },
  });
  assert.deepEqual(wrote.authored, ["bootstrap"]);
});

test("a binding that is not there, or is retired, runs no step", async () => {
  const cases: readonly (readonly [FixturePorts, string])[] = [
    [{ unbound: true }, "NotBound"],
    [{ retiredAt: fixtureRetiredAt }, "Retired"],
  ];
  for (const [given, result] of cases) {
    const { configured, wrote } = await fixtureConfigured(["Administer"], {
      configurations: undeclared,
      ...given,
    });
    assert.deepEqual(configured, { result }, result);
    assert.deepEqual(wrote.heldQueries, [], result);
    assert.deepEqual(wrote.heads, [], result);
  }
});

test("a deployment with no configuration step still answers what is held and defers the rest", async () => {
  const { configured } = await fixtureConfigured(["Administer"]);
  assert.deepEqual(configured, {
    result: "Configurations",
    repository,
    configurations: { result: "Deferred", reason: "NotConfigured" },
  });
});

/**
 * The revisions a project holds, keyed by identity as the durable side keys
 * them: the first author of one creates it and every later one meets it.
 */
function fixtureRevisions(
  standing: ReadonlyMap<string, CanonicalConfiguration> = new Map(),
) {
  const revisions = new Map<string, CanonicalConfiguration>(standing);
  const created: string[] = [];
  const authoring: RepositoryConfigurationsPorts["authoring"] = {
    createConfiguration: (input) => {
      const standing = revisions.get(input.revision);
      const revision = {
        partition: input.partition,
        revision: input.revision,
        canonical: input.canonical,
        digest: "sha256:bootstrap",
      };
      if (standing === undefined) {
        revisions.set(input.revision, input.canonical);
        created.push(input.revision);
        return Promise.resolve({ created: "Created" as const, revision });
      }
      return Promise.resolve(
        standing === input.canonical
          ? { created: "AlreadyExists" as const, revision }
          : { created: "IdentityConflict" as const },
      );
    },
  };
  const held: RepositoryConfigurationsHeldRead = {
    held: (query) =>
      Promise.resolve({
        declared: new Map(),
        bootstrap: revisions.get(query.bootstrap),
      }),
  };
  return { created, authoring, held };
}

/** The service over one revision store, its permits granted and its repository declaring nothing. */
function fixtureRevisionsService(
  revisions: ReturnType<typeof fixtureRevisions>,
  granted: readonly (ProjectAccessKind | TenantAccessKind)[] = ["Administer"],
) {
  const { ports, wrote } = fixturePorts(fixtureAccess(granted).access, {
    configurations: undeclared,
  });
  const service = repositoryOnboarding({
    ...ports,
    configurationsHeld: revisions.held,
    ...(ports.configurations === undefined
      ? {}
      : {
          configurations: {
            ...ports.configurations,
            authoring: revisions.authoring,
          },
        }),
  });
  return { service, wrote };
}

test("two requests racing to configure one repository author its bootstrap once", async () => {
  const revisions = fixtureRevisions();
  const { service, wrote } = fixtureRevisionsService(revisions);
  const configure = () =>
    service.configureRepository(principal, partition, repository);
  const raced = await Promise.all([configure(), configure()]);
  assert.equal(wrote.heads.length, 2, "both requests ran the step");
  assert.deepEqual(revisions.created, ["bootstrap"]);
  for (const answered of raced)
    assert.deepEqual(answered, {
      result: "Configurations",
      repository,
      configurations: { result: "Bootstrapped", revision: "bootstrap" },
    });
  await configure();
  assert.equal(wrote.heads.length, 2, "a third request read nothing");
  assert.deepEqual(revisions.created, ["bootstrap"]);
});

test("the listing marks each binding by whether the project holds anything for it", async () => {
  const cases: readonly (readonly [RepositoryConfigurationsHeld, boolean])[] = [
    [{ declared: new Map(), bootstrap: undefined }, false],
    [{ declared: new Map([[repository, 1]]), bootstrap: undefined }, true],
    [{ declared: new Map(), bootstrap: readyBootstrap }, true],
    [{ declared: new Map(), bootstrap: unreadyBootstrap }, false],
  ];
  for (const [stepHeld, configured] of cases) {
    const { service, wrote } = fixtureService(["Read"], { stepHeld });
    const listed = await service.projectRepositories(principal, partition);
    assert.deepEqual(
      listed.result === "Repositories" &&
        listed.repositories.map((row) => row.configured),
      [configured],
    );
    assert.deepEqual(wrote.heldQueries, [
      { partition, repositories: [repository], bootstrap: "bootstrap" },
    ]);
  }
});

/**
 * A revision is never rewritten, so a bootstrap the release rule has outgrown
 * is neither held nor replaced: the step still runs, because a repository that
 * now declares its own is imported, and one declaring none meets the old one.
 */
test("a bootstrap that no longer releases is not held, and the step meets it rather than replacing it", async () => {
  const revisions = fixtureRevisions(
    new Map([["bootstrap", unreadyBootstrap]]),
  );
  const { service, wrote } = fixtureRevisionsService(revisions, [
    "Administer",
    "Read",
  ]);
  const listed = await service.projectRepositories(principal, partition);
  assert.deepEqual(
    listed.result === "Repositories" &&
      listed.repositories.map((row) => row.configured),
    [false],
  );
  assert.deepEqual(
    await service.configureRepository(principal, partition, repository),
    {
      result: "Configurations",
      repository,
      configurations: { result: "Deferred", reason: "IdentityConflict" },
    },
  );
  assert.equal(wrote.heads.length, 1, "the step ran");
  assert.deepEqual(revisions.created, [], "nothing was authored over it");
});
