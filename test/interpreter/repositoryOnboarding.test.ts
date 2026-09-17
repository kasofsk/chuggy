/**
 * Claiming an installation and binding a repository: which permit each question
 * is asked behind, and what each answer comes to.
 *
 * EVERY REFUSAL IS ASSERTED AS ITS OWN ANSWER. A refused permit, an
 * installation this app does not hold, a repository no source can reach and a
 * project that is not there are four different answers to four different
 * questions, and a suite that asserted only "not the happy one" would pass
 * while any of them collapsed into another.
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
  asGitRefName,
  asRepositoryCredential,
  asRepositoryId,
  type CredentialResolved,
  type RepositoryCredentialPort,
} from "../../src/interpreter/finalizer.ts";
import type {
  ForgeAppDescribed,
  ForgeInstallationRead,
  ForgeRepositoriesRead,
  ForgeRepositorySummary,
} from "../../src/interpreter/forgeDirectory.ts";
import {
  asForgeAccount,
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
  type RepositoryCreationPorts,
  type RepositoryOnboarding,
  type RepositoryOnboardingForgeApp,
  type RepositoryOnboardingPorts,
} from "../../src/interpreter/repositoryOnboarding.ts";
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

/** One creation as a caller sends it, the account being the one both claims name. */
const creating = {
  account: asForgeAccount("kasofsk"),
  name: asForgeRepositoryName("engine"),
  visibility: "private" as const,
  operation,
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
  readonly read?: ForgeInstallationRead;
  readonly repositories?: ForgeRepositoriesRead;
  readonly recorded?: ForgeInstallationRecorded;
  readonly held?: readonly ForgeInstallationClaimed[];
  readonly resolved?: CredentialResolved;
  readonly outcome?: RepositoryBindingOutcome;
  readonly landing?: RepositoryLanding;
  readonly landingOutcome?: ProjectRepositoryLandingOutcome;
  readonly retirementOutcome?: ProjectRepositoryRetirementOutcome;
  readonly apps?: readonly ForgeApp[];
  readonly creation?: FixtureCreation;
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
  readonly listed: ForgeApp[];
  readonly creations: ForgeRepositoryCreationRequest[];
  readonly seeds: ForgeRepositorySeedRequest[];
  readonly rulesets: ForgeRepositoryRulesetRequest[];
  readonly landings: ProjectRepositoryLandingCommand[];
  readonly retirements: ProjectRepositoryRetirementCommand[];
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
      installation: () => {
        wrote.asked.push(held);
        return Promise.resolve(given.read ?? { read: "Unknown" as const });
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

/** The instant the fixture retires at, so a case can assert the row it reads back. */
const fixtureRetiredAt = "2026-09-14T02:00:00Z";

/** The one binding every case's durable side holds, at whatever landing the case gives it. */
function fixtureBinding(given: FixturePorts): ProjectRepositoryBound {
  return {
    repository,
    boundAt: "2026-09-11T01:00:00Z",
    landing: given.landing ?? { mode: "Push" },
  };
}

/** The landing half, answering the one binding and recording what it was asked to write. */
function fixturePortsLanding(
  given: FixturePorts,
  wrote: FixtureWrites,
): ProjectRepositoryLandingStore {
  return {
    landing: () => Promise.resolve(fixtureBinding(given)),
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
    listed: [],
    creations: [],
    seeds: [],
    rulesets: [],
    landings: [],
    retirements: [],
  };
  const credentials: RepositoryCredentialPort = {
    credential: () =>
      Promise.resolve(given.resolved ?? { resolved: "Denied" as const }),
  };
  return {
    wrote,
    ports: {
      access,
      forgeApps: (given.apps ?? [app]).map((held) =>
        fixturePortsForgeHalf(given, wrote, held),
      ),
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
      ...(given.creation === undefined
        ? {}
        : { creation: fixtureCreationPorts(given.creation, wrote) }),
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
} as const;

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

test("a claim is the tenant administrator's and nobody else's", async () => {
  const refused = fixtureService([]);
  assert.deepEqual(
    await refused.service.claimInstallation(principal, tenant, {
      forge,
      app,
      installationId,
    }),
    { result: "NotFound" },
  );
  assert.deepEqual(refused.asked.askedTenant, ["AdministerTenant"]);
  assert.deepEqual(refused.wrote.claims, []);
});

test("a claim is read as the app before it is recorded as the tenant's", async () => {
  const claiming = fixtureService(["AdministerTenant"], {
    apps: [app, worker],
    read: {
      read: "Installation",
      installation: {
        account: claimed.account,
        accountKind: claimed.accountKind,
      },
    },
  });
  assert.deepEqual(
    await claiming.service.claimInstallation(principal, tenant, {
      forge,
      app,
      installationId,
    }),
    {
      result: "Claimed",
      installation: {
        forge,
        app,
        account: claimed.account,
        accountKind: claimed.accountKind,
        installationId,
      },
    },
  );
  assert.deepEqual(claiming.wrote.asked, [app]);
  const [recorded] = claiming.wrote.claims;
  assert.equal(recorded?.tenant, tenant);
  assert.equal(recorded?.authority.subject, memberAuthority(principal).subject);
});

test("an installation this app does not hold is unknown, and so is another forge", async () => {
  const unknown = fixtureService(["AdministerTenant"], {
    read: { read: "Unknown" },
  });
  assert.deepEqual(
    await unknown.service.claimInstallation(principal, tenant, {
      forge,
      app,
      installationId,
    }),
    { result: "InstallationUnknown" },
  );
  assert.deepEqual(unknown.wrote.claims, []);
  const elsewhere = fixtureService(["AdministerTenant"], {
    read: {
      read: "Installation",
      installation: {
        account: claimed.account,
        accountKind: claimed.accountKind,
      },
    },
  });
  assert.deepEqual(
    await elsewhere.service.claimInstallation(principal, tenant, {
      forge: asForgeId("gitlab"),
      app,
      installationId,
    }),
    { result: "InstallationUnknown" },
  );
  assert.deepEqual(elsewhere.wrote.claims, []);
});

test("a replay is already claimed and another tenant's account is a conflict", async () => {
  const read: ForgeInstallationRead = {
    read: "Installation",
    installation: {
      account: claimed.account,
      accountKind: claimed.accountKind,
    },
  };
  const replay = fixtureService(["AdministerTenant"], {
    read,
    recorded: "AlreadyRecorded",
  });
  assert.equal(
    (
      await replay.service.claimInstallation(principal, tenant, {
        forge,
        app,
        installationId,
      })
    ).result,
    "AlreadyClaimed",
  );
  const moved = fixtureService(["AdministerTenant"], {
    read,
    recorded: "Reinstalled",
  });
  assert.equal(
    (
      await moved.service.claimInstallation(principal, tenant, {
        forge,
        app,
        installationId,
      })
    ).result,
    "Claimed",
  );
  const taken = fixtureService(["AdministerTenant"], {
    read,
    recorded: "ClaimedElsewhere",
  });
  assert.deepEqual(
    await taken.service.claimInstallation(principal, tenant, {
      forge,
      app,
      installationId,
    }),
    { result: "ClaimedElsewhere" },
  );
});

test("a forge that could not be reached is a wait rather than a refusal", async () => {
  const down = fixtureService(["AdministerTenant"], {
    read: { read: "Unavailable" },
  });
  assert.deepEqual(
    await down.service.claimInstallation(principal, tenant, {
      forge,
      app,
      installationId,
    }),
    { result: "Unavailable" },
  );
  assert.deepEqual(down.wrote.claims, []);
});

test("a deployment holding no app claims nothing and lists what it holds", async () => {
  const none = fixtureService(["AdministerTenant"], {
    apps: [],
    held: [claimed],
  });
  assert.deepEqual(
    await none.service.claimInstallation(principal, tenant, {
      forge,
      app,
      installationId,
    }),
    { result: "NotConfigured" },
  );
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

test("a worker claim is the worker app's, and holding no worker key says so", async () => {
  const read: ForgeInstallationRead = {
    read: "Installation",
    installation: {
      account: claimed.account,
      accountKind: claimed.accountKind,
    },
  };
  const both = fixtureService(["AdministerTenant"], {
    read,
    apps: [app, worker],
  });
  assert.deepEqual(
    await both.service.claimInstallation(principal, tenant, {
      forge,
      app: worker,
      installationId,
    }),
    {
      result: "Claimed",
      installation: {
        forge,
        app: worker,
        account: claimed.account,
        accountKind: claimed.accountKind,
        installationId,
      },
    },
  );
  assert.deepEqual(both.wrote.asked, [worker]);
  const portalOnly = fixtureService(["AdministerTenant"], { read });
  assert.deepEqual(
    await portalOnly.service.claimInstallation(principal, tenant, {
      forge,
      app: worker,
      installationId,
    }),
    { result: "NotConfigured" },
  );
  assert.deepEqual(portalOnly.wrote.claims, []);
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

/** Creating one repository under a project whose administrator asked for it. */
async function fixtureCreated(given: FixturePorts = {}) {
  const composed = fixtureService(["Administer"], {
    resolved: credentialProved,
    held: [fixtureClaimOf(app), fixtureClaimOf(worker)],
    creation: {},
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

test("a repository is created and bound under one authority", async () => {
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
    seeded: false,
    ruleset: { result: "Skipped" },
  });
  assert.equal(wrote.creations[0]?.creation.mode, "Organization");
  assert.deepEqual(wrote.seeds, []);
  assert.deepEqual(wrote.rulesets, []);
  assert.deepEqual(wrote.commands[0]?.operation, operation);
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
});

test("a forge that did not answer the create is a wait and not a refusal", async () => {
  const { created } = await fixtureCreated({
    creation: { created: { created: "Unavailable" } },
  });
  assert.deepEqual(created, { result: "Unavailable" });
});

test("repository creation leaves catalog authoring to the repository", async () => {
  const { created, wrote } = await fixtureCreated({});
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
  });
  assert.deepEqual(wrote.seeds, []);
  assert.deepEqual(wrote.rulesets, []);
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
