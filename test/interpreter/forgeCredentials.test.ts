/**
 * Where a repository's credential comes from, and who may ask the API to mint
 * one.
 *
 * THE SOURCES ARE DISTINGUISHABLE. Each answers a credential naming itself, so
 * a case asserting which one answered is asserting the routing rather than the
 * answer.
 *
 * THE TENANT ASKING IS WHAT THE MINT IS ASKED UNDER. The caller's partition
 * carries it, so a binding that reached across tenants cannot widen what the
 * mint is allowed to look at.
 *
 * THE REFUSALS ARE ASSERTED APART. A caller without the permit and a repository
 * the project does not bind are both not found, and a forge that could not be
 * reached is a wait — a service that collapsed them would tell a caller to
 * replace a credential the forge never objected to.
 *
 * A MINTED TOKEN'S OWN BOUND IS HERE TOO. It is the bound of the credential a
 * token becomes rather than of a stored identity, so the case that holds it
 * there belongs beside the sources that hand one out.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  forgeCredentialMinting,
  forgeCredentialsByHost,
  repositoryCredentialsByHost,
} from "../../src/interpreter/forgeCredentials.ts";
import {
  asForgeBindingId,
  asForgeCredential,
  asForgeCredentialReference,
  type ChangeProposalCredentialRequest,
  type ForgeCredentialPort,
} from "../../src/interpreter/changeProposal.ts";
import {
  asRepositoryCredential,
  asRepositoryId,
  repositoryCredentialCharsMax,
  type RepositoryBinding,
  type RepositoryCredentialPort,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asForgeInstallationToken,
  type ForgePermissionSet,
  type ForgeRepositoryTokens,
  type ForgeTokenMinted,
} from "../../src/interpreter/forgeInstallation.ts";
import {
  memberAuthority,
  ProjectAccessUnavailable,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectRepositoryBindingRead } from "../../src/interpreter/repositoryConfiguration.ts";
import {
  asProjectId,
  asTenantId,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";

const fixturePartition = {
  tenant: asTenantId("vteng"),
  project: asProjectId("chuggy"),
};
const fixturePrincipal = asPrincipal("14:https://issuer/member");
const fixtureRepository = asRepositoryId("https://github.com/kasofsk/chuggy");
const fixtureElsewhere = asRepositoryId("https://forge.invalid/kasofsk/other");
const fixtureToken = asForgeInstallationToken("ghs-minted-q4w5e6");

/** One binding of the caller's own, which is what the routing cases are about. */
function fixtureBinding(repository: RepositoryId): RepositoryBinding {
  return {
    partition: fixturePartition,
    repository,
    recoveryEpoch: "epoch",
  } as RepositoryBinding;
}

/** A source that answers its own name, so a case can tell which one was asked. */
function fixtureSource(name: string): RepositoryCredentialPort {
  return {
    credential: () =>
      Promise.resolve({
        resolved: "Credential" as const,
        credential: asRepositoryCredential(name),
      }),
  };
}

/** The access answer this suite composes, one verdict for every question. */
function fixtureAccess(
  answer: "Authorized" | "Refused" | "Unavailable",
  kinds: ProjectAccessKind[] = [],
): ProjectAccess {
  return {
    authorize: (_principal, _partition, kind) => {
      kinds.push(kind);
      if (answer === "Unavailable")
        return Promise.reject(new ProjectAccessUnavailable("the rig is down"));
      return Promise.resolve(
        answer === "Authorized" ? memberAuthority(fixturePrincipal) : undefined,
      );
    },
    authorizeTenant: () => Promise.resolve(undefined),
  };
}

/**
 * The binding read, answering a row recorded under a tenant of its own. The
 * caller's partition is the one that must reach the mint, so a fixture whose
 * row agreed with the caller could not tell the two apart.
 */
function fixtureBindings(
  bound: RepositoryId | undefined,
): ProjectRepositoryBindingRead {
  return {
    binding: (_partition, repository) =>
      Promise.resolve(
        bound !== undefined && repository === bound
          ? ({
              partition: {
                tenant: asTenantId("elsewhere"),
                project: asProjectId("crossed"),
              },
              repository: bound,
              recoveryEpoch: "epoch",
            } as RepositoryBinding)
          : undefined,
      ),
  };
}

function fixtureTokens(
  minted: ForgeTokenMinted,
  asked: RepositoryId[] = [],
  askedTenants: TenantId[] = [],
): ForgeRepositoryTokens {
  return {
    token: (repository, tenant) => {
      asked.push(repository);
      askedTenants.push(tenant);
      return Promise.resolve(minted);
    },
  };
}

/** One proposal's ask against a named repository, which is what selects a source. */
function fixtureProposal(
  repository: RepositoryId,
): ChangeProposalCredentialRequest {
  return {
    binding: {
      forge: asForgeBindingId("forge-alpha"),
      credential: asForgeCredentialReference("forge-alpha-proposals"),
    },
    partition: fixturePartition,
    repository,
  };
}

/** A forge credential source that answers its own name, so a case can tell which answered. */
const fixtureForgeFiles: ForgeCredentialPort = {
  credential: () =>
    Promise.resolve({
      resolved: "Credential" as const,
      credential: asForgeCredential("files"),
    }),
};

test("a minted token is held to the bound of the credential it becomes", () => {
  const atBound = "g".repeat(repositoryCredentialCharsMax);
  assert.equal(asForgeInstallationToken(atBound), atBound);
  assert.throws(
    () => asForgeInstallationToken(`${atBound}g`),
    /forge installation token: .* is past the/u,
  );
});

test("the host a repository names selects its forge credential source too", async () => {
  const asked: RepositoryId[] = [];
  const askedTenants: TenantId[] = [];
  const askedPermissions: ForgePermissionSet[] = [];
  const source = forgeCredentialsByHost(
    [
      {
        repositoryHost: "github.com",
        tokens: {
          token: (repository, tenant, permissions) => {
            asked.push(repository);
            askedTenants.push(tenant);
            askedPermissions.push(permissions);
            return Promise.resolve({
              minted: "Token" as const,
              token: fixtureToken,
              expiresAtMs: 1,
            });
          },
        },
        permissions: "propose",
      },
    ],
    fixtureForgeFiles,
  );

  assert.deepEqual(
    await source.credential(fixtureProposal(fixtureRepository)),
    {
      resolved: "Credential",
      credential: fixtureToken,
    },
  );
  assert.deepEqual(await source.credential(fixtureProposal(fixtureElsewhere)), {
    resolved: "Credential",
    credential: "files",
  });
  assert.deepEqual(asked, [fixtureRepository]);
  assert.deepEqual(askedTenants, [fixturePartition.tenant]);
  assert.deepEqual(
    askedPermissions,
    ["propose"],
    "a finalizer asks to propose and never to write through this port",
  );
});

test("a forge that refuses is denied and one that is down is an outage", async () => {
  const of = (minted: ForgeTokenMinted | "raise"): ForgeCredentialPort =>
    forgeCredentialsByHost(
      [
        {
          repositoryHost: "github.com",
          tokens: {
            token: () =>
              minted === "raise"
                ? Promise.reject(new Error("the forge is down"))
                : Promise.resolve(minted),
          },
          permissions: "propose",
        },
      ],
      fixtureForgeFiles,
    );
  for (const [minted, resolved] of [
    [{ minted: "Denied" as const }, "Denied"],
    [{ minted: "Unavailable" as const }, "Unavailable"],
    ["raise" as const, "Unavailable"],
  ] as const) {
    const answer = await of(minted).credential(
      fixtureProposal(fixtureRepository),
    );
    assert.deepEqual(answer, { resolved }, String(resolved));
    assert.deepEqual(
      Object.keys(answer),
      ["resolved"],
      "a refusal carries no message that could quote what was minted",
    );
  }
});

test("the host a repository names is what selects its credential source", async () => {
  const source = repositoryCredentialsByHost(
    [{ repositoryHost: "github.com", credentials: fixtureSource("minted") }],
    fixtureSource("files"),
  );
  assert.deepEqual(await source.credential(fixtureBinding(fixtureRepository)), {
    resolved: "Credential",
    credential: "minted",
  });
  assert.deepEqual(await source.credential(fixtureBinding(fixtureElsewhere)), {
    resolved: "Credential",
    credential: "files",
  });
  assert.deepEqual(
    await source.credential(fixtureBinding(asRepositoryId("not a URL"))),
    { resolved: "Credential", credential: "files" },
    "a repository naming no URL is the files' to answer or refuse",
  );
});

test("a deployment composing no minting source reads every credential from its files", async () => {
  const source = repositoryCredentialsByHost([], fixtureSource("files"));
  assert.deepEqual(await source.credential(fixtureBinding(fixtureRepository)), {
    resolved: "Credential",
    credential: "files",
  });
});

test("two sources for one host are refused at composition", () => {
  assert.throws(
    () =>
      repositoryCredentialsByHost(
        [
          { repositoryHost: "github.com", credentials: fixtureSource("one") },
          { repositoryHost: "github.com", credentials: fixtureSource("two") },
        ],
        fixtureSource("files"),
      ),
    /a host names two sources/u,
  );
});

test("two forge sources for one host are refused at composition too", () => {
  const source = {
    repositoryHost: "github.com",
    tokens: fixtureTokens({ minted: "Denied" }),
    permissions: "propose",
  } as const;
  assert.throws(
    () => forgeCredentialsByHost([source, source], fixtureForgeFiles),
    /a host names two sources/u,
  );
});

test("minting asks the execute permit and answers the token for the bound repository under the caller's own tenant", async () => {
  const kinds: ProjectAccessKind[] = [];
  const asked: RepositoryId[] = [];
  const askedTenants: TenantId[] = [];
  const minted = await forgeCredentialMinting(
    fixtureAccess("Authorized", kinds),
    fixtureBindings(fixtureRepository),
    fixtureTokens(
      { minted: "Token", token: fixtureToken, expiresAtMs: 1_000 },
      asked,
      askedTenants,
    ),
  ).mint(fixturePrincipal, fixturePartition, {
    repository: fixtureRepository,
    permissions: "read",
  });
  assert.deepEqual(kinds, ["Execute"]);
  assert.deepEqual(asked, [fixtureRepository]);
  assert.deepEqual(
    askedTenants,
    [fixturePartition.tenant],
    "the caller's partition is what the mint is asked under, not the binding's",
  );
  assert.deepEqual(minted, {
    result: "Authorized",
    value: { token: fixtureToken, expiresAtMs: 1_000 },
  });
});

test("a caller without the permit and a repository this project does not bind are both not found", async () => {
  const asked: RepositoryId[] = [];
  const tokens = fixtureTokens(
    { minted: "Token", token: fixtureToken, expiresAtMs: 1_000 },
    asked,
  );
  const request = {
    repository: fixtureRepository,
    permissions: "read",
  } as const;
  assert.deepEqual(
    await forgeCredentialMinting(
      fixtureAccess("Refused"),
      fixtureBindings(fixtureRepository),
      tokens,
    ).mint(fixturePrincipal, fixturePartition, request),
    { result: "NotFound" },
  );
  assert.deepEqual(
    await forgeCredentialMinting(
      fixtureAccess("Authorized"),
      fixtureBindings(undefined),
      tokens,
    ).mint(fixturePrincipal, fixturePartition, request),
    { result: "NotFound" },
  );
  assert.deepEqual(asked, [], "neither refusal reaches the forge");
});

test("a forge refusal is not found and a forge outage is a wait", async () => {
  for (const [minted, result] of [
    ["Denied", "NotFound"],
    ["Unavailable", "Unavailable"],
  ] as const) {
    assert.deepEqual(
      await forgeCredentialMinting(
        fixtureAccess("Authorized"),
        fixtureBindings(fixtureRepository),
        fixtureTokens({ minted }),
      ).mint(fixturePrincipal, fixturePartition, {
        repository: fixtureRepository,
        permissions: "read",
      }),
      { result },
      minted,
    );
  }
});

test("an authority that could not answer is raised rather than read as a refusal", async () => {
  await assert.rejects(
    () =>
      forgeCredentialMinting(
        fixtureAccess("Unavailable"),
        fixtureBindings(fixtureRepository),
        fixtureTokens({ minted: "Denied" }),
      ).mint(fixturePrincipal, fixturePartition, {
        repository: fixtureRepository,
        permissions: "read",
      }),
    ProjectAccessUnavailable,
  );
});
