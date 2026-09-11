/**
 * Where a repository's credential comes from, and who may ask the API to mint
 * one.
 *
 * THE SOURCES ARE DISTINGUISHABLE. Each answers a credential naming itself, so
 * a case asserting which one answered is asserting the routing rather than the
 * answer.
 *
 * THE REFUSALS ARE ASSERTED APART. A caller without the permit and a repository
 * the project does not bind are both not found, and a forge that could not be
 * reached is a wait — a service that collapsed them would tell a caller to
 * replace a credential the forge never objected to.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  forgeCredentialMinting,
  repositoryCredentialsByHost,
} from "../../src/interpreter/forgeCredentials.ts";
import {
  asRepositoryCredential,
  asRepositoryId,
  type RepositoryBinding,
  type RepositoryCredentialPort,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asForgeInstallationToken,
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
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const fixturePartition = {
  tenant: asTenantId("vteng"),
  project: asProjectId("chuggy"),
};
const fixturePrincipal = asPrincipal("14:https://issuer/member");
const fixtureRepository = asRepositoryId("https://github.com/kasofsk/chuggy");
const fixtureElsewhere = asRepositoryId("https://forge.invalid/kasofsk/other");
const fixtureToken = asForgeInstallationToken("ghs-minted-q4w5e6");

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
  };
}

function fixtureBindings(
  bound: RepositoryId | undefined,
): ProjectRepositoryBindingRead {
  return {
    binding: (_partition, repository) =>
      Promise.resolve(
        bound !== undefined && repository === bound
          ? fixtureBinding(bound)
          : undefined,
      ),
  };
}

function fixtureTokens(
  minted: ForgeTokenMinted,
  asked: RepositoryId[] = [],
): ForgeRepositoryTokens {
  return {
    token: (repository) => {
      asked.push(repository);
      return Promise.resolve(minted);
    },
  };
}

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

test("minting asks the execute permit and answers the token for the bound repository", async () => {
  const kinds: ProjectAccessKind[] = [];
  const asked: RepositoryId[] = [];
  const minted = await forgeCredentialMinting(
    fixtureAccess("Authorized", kinds),
    fixtureBindings(fixtureRepository),
    fixtureTokens(
      { minted: "Token", token: fixtureToken, expiresAtMs: 1_000 },
      asked,
    ),
  ).mint(fixturePrincipal, fixturePartition, {
    repository: fixtureRepository,
    permissions: "read",
  });
  assert.deepEqual(kinds, ["Execute"]);
  assert.deepEqual(asked, [fixtureRepository]);
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
