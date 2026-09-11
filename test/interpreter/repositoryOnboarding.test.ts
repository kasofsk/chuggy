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

import {
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
  type ForgeApp,
} from "../../src/interpreter/forgeInstallation.ts";
import type {
  ForgeInstallationClaim,
  ForgeInstallationClaimed,
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
  RepositoryBindingCommand,
  RepositoryBindingOutcome,
} from "../../src/interpreter/repositoryBinding.ts";
import {
  repositoryOnboarding,
  type RepositoryOnboarding,
  type RepositoryOnboardingForgeApp,
  type RepositoryOnboardingPorts,
} from "../../src/interpreter/repositoryOnboarding.ts";

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

/** Everything the service is composed with, each port answering one fixed thing. */
interface FixturePorts {
  readonly described?: ForgeAppDescribed;
  readonly read?: ForgeInstallationRead;
  readonly repositories?: ForgeRepositoriesRead;
  readonly recorded?: ForgeInstallationRecorded;
  readonly held?: readonly ForgeInstallationClaimed[];
  readonly resolved?: CredentialResolved;
  readonly outcome?: RepositoryBindingOutcome;
  readonly apps?: readonly ForgeApp[];
}

/** What a case reads back: the claim recorded, and the command the door was asked. */
interface FixtureWrites {
  readonly claims: ForgeInstallationClaim[];
  readonly commands: RepositoryBindingCommand[];
}

function fixturePorts(
  access: ProjectAccess,
  given: FixturePorts,
): {
  readonly ports: RepositoryOnboardingPorts;
  readonly wrote: FixtureWrites;
} {
  const wrote: FixtureWrites = { claims: [], commands: [] };
  const forgeHalf = (held: ForgeApp): RepositoryOnboardingForgeApp => ({
    forge,
    app: held,
    apps: {
      app: () =>
        Promise.resolve(
          given.described ?? { described: "Unavailable" as const },
        ),
    },
    directory: {
      installation: () =>
        Promise.resolve(given.read ?? { read: "Unknown" as const }),
    },
    installationRepositories: {
      repositories: () =>
        Promise.resolve(given.repositories ?? { read: "Unavailable" as const }),
    },
  });
  const credentials: RepositoryCredentialPort = {
    credential: () =>
      Promise.resolve(given.resolved ?? { resolved: "Denied" as const }),
  };
  return {
    wrote,
    ports: {
      access,
      forgeApps: (given.apps ?? [app]).map(forgeHalf),
      credentials,
      recording: {
        record: (claim) => {
          wrote.claims.push(claim);
          return Promise.resolve(given.recorded ?? "Recorded");
        },
      },
      claims: { claims: () => Promise.resolve(given.held ?? []) },
      bindings: {
        bindings: () =>
          Promise.resolve([{ repository, boundAt: "2026-09-11T01:00:00Z" }]),
      },
      binding: {
        currentRecoveryEpoch: () => Promise.resolve(epoch),
        bind: (command) => {
          wrote.commands.push(command);
          return Promise.resolve(given.outcome ?? "Bound");
        },
      },
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
  });
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
    { result: "Bound", repository },
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
      repositories: [{ repository, boundAt: "2026-09-11T01:00:00Z" }],
    },
  );
});
