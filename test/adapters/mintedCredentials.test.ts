/**
 * The minted source over one installation store: which repository selects which
 * installation, which tenant may read it, and what a repository no claim of
 * that tenant's covers comes to.
 *
 * A MINT IS THE ASSERTION AND SO IS ITS ABSENCE. A repository on another host,
 * an account nobody claimed and an account another tenant claimed are refused
 * without a mint being attempted, and the recorded requests are what prove it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  mintedRepositoryCredentials,
  mintedRepositoryTokens,
} from "../../src/adapters/forge/mintedCredentials.ts";
import { githubRepositoryHost } from "../../src/adapters/forge/githubAddress.ts";
import {
  asForgeAccount,
  asForgeId,
  asForgeInstallationId,
  asForgeInstallationToken,
  type ForgeInstallationQuery,
  type ForgeInstallationStore,
  type ForgeInstallationTokens,
  type ForgeTokenMinted,
  type ForgeTokenRequest,
} from "../../src/interpreter/forgeInstallation.ts";
import {
  asRepositoryId,
  type RepositoryBinding,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const fixtureForgeId = asForgeId("github");
const fixtureAccount = "kasofsk";
const fixtureTenant = asTenantId("vteng");
const fixtureOtherTenant = asTenantId("otherco");
const fixtureToken = asForgeInstallationToken("ghs-minted-q4w5e6");
const fixtureRepository = asRepositoryId(
  `https://${githubRepositoryHost}/${fixtureAccount}/chuggy`,
);
const fixtureInstallationId = asForgeInstallationId("156333284");

/** One project's binding of the fixture repository, under the tenant it names. */
function fixtureBinding(tenant = fixtureTenant): RepositoryBinding {
  return {
    partition: { tenant, project: asProjectId("chuggy") },
    repository: fixtureRepository,
    recoveryEpoch: "epoch",
  } as unknown as RepositoryBinding;
}

/**
 * The claimed installations this suite composes, recording every query asked.
 * The claim is one tenant's, and a query naming another answers nothing exactly
 * as a row read by tenant and account does.
 */
function fixtureInstallations(
  claimed: readonly string[],
  asked: ForgeInstallationQuery[] = [],
): ForgeInstallationStore {
  return {
    installation: (query) => {
      asked.push(query);
      return Promise.resolve(
        claimed.includes(query.account) && query.tenant === fixtureTenant
          ? {
              forge: query.forge,
              app: query.app,
              account: query.account,
              installationId: fixtureInstallationId,
            }
          : undefined,
      );
    },
  };
}

function fixtureTokens(
  minted: ForgeTokenMinted,
  asked: ForgeTokenRequest[] = [],
): ForgeInstallationTokens {
  return {
    mint: (request) => {
      asked.push(request);
      return Promise.resolve(minted);
    },
  };
}

function fixtureRepositoryTokens(
  options: {
    readonly claimed?: readonly string[];
    readonly minted?: ForgeTokenMinted;
    readonly askedInstallations?: ForgeInstallationQuery[];
    readonly askedMints?: ForgeTokenRequest[];
  } = {},
) {
  return mintedRepositoryTokens({
    forge: fixtureForgeId,
    app: "portal",
    repositoryHost: githubRepositoryHost,
    installations: fixtureInstallations(
      options.claimed ?? [fixtureAccount],
      options.askedInstallations,
    ),
    tokens: fixtureTokens(
      options.minted ?? {
        minted: "Token",
        token: fixtureToken,
        expiresAtMs: 1_000,
      },
      options.askedMints,
    ),
  });
}

test("a repository's owner and the asking tenant select the installation, and the mint names that repository alone", async () => {
  const askedInstallations: ForgeInstallationQuery[] = [];
  const askedMints: ForgeTokenRequest[] = [];
  const minted = await fixtureRepositoryTokens({
    askedInstallations,
    askedMints,
  }).token(fixtureRepository, fixtureTenant, "write");
  assert.deepEqual(askedInstallations, [
    {
      forge: fixtureForgeId,
      app: "portal",
      account: asForgeAccount(fixtureAccount),
      tenant: fixtureTenant,
    },
  ]);
  assert.deepEqual(askedMints, [
    {
      installation: {
        forge: fixtureForgeId,
        app: "portal",
        account: asForgeAccount(fixtureAccount),
        installationId: fixtureInstallationId,
      },
      repositories: ["chuggy"],
      permissions: "write",
    },
  ]);
  assert.deepEqual(minted, {
    minted: "Token",
    token: fixtureToken,
    expiresAtMs: 1_000,
  });
});

test("a repository this forge does not hold and an account no tenant claimed are both denied", async () => {
  const askedMints: ForgeTokenRequest[] = [];
  const elsewhere: readonly RepositoryId[] = [
    asRepositoryId("https://forge.invalid/kasofsk/chuggy"),
    asRepositoryId(`https://${githubRepositoryHost}/kasofsk/chuggy/extra`),
    asRepositoryId("not a URL"),
  ];
  for (const repository of elsewhere) {
    assert.deepEqual(
      await fixtureRepositoryTokens({ askedMints }).token(
        repository,
        fixtureTenant,
        "read",
      ),
      { minted: "Denied" },
      repository,
    );
  }
  assert.deepEqual(
    await fixtureRepositoryTokens({ claimed: [], askedMints }).token(
      fixtureRepository,
      fixtureTenant,
      "read",
    ),
    { minted: "Denied" },
  );
  assert.deepEqual(askedMints, [], "no refusal reaches the forge");
});

test("an account another tenant claimed is denied to this one, and the tenant is what the store was asked", async () => {
  const askedInstallations: ForgeInstallationQuery[] = [];
  const askedMints: ForgeTokenRequest[] = [];
  const tokens = fixtureRepositoryTokens({ askedInstallations, askedMints });
  assert.deepEqual(
    await tokens.token(fixtureRepository, fixtureOtherTenant, "write"),
    { minted: "Denied" },
  );
  assert.deepEqual(
    askedInstallations.map((query) => query.tenant),
    [fixtureOtherTenant],
    "the asking tenant is a term of the lookup",
  );
  assert.deepEqual(askedMints, [], "no crossing reaches the forge");
});

test("a binding of one tenant mints nothing against another tenant's claim", async () => {
  const askedMints: ForgeTokenRequest[] = [];
  const tokens = fixtureRepositoryTokens({ askedMints });
  assert.deepEqual(
    await mintedRepositoryCredentials({
      tokens,
      permissions: "write",
    }).credential(fixtureBinding(fixtureOtherTenant)),
    { resolved: "Denied" },
  );
  assert.deepEqual(
    await mintedRepositoryCredentials({
      tokens,
      permissions: "write",
    }).credential(fixtureBinding()),
    { resolved: "Credential", credential: fixtureToken },
    "the same repository under the claiming tenant still mints",
  );
  assert.deepEqual(
    askedMints.length,
    1,
    "only the tenant holding the claim reached the forge",
  );
});

test("the minted source answers the token in the credential vocabulary", async () => {
  assert.deepEqual(
    await mintedRepositoryCredentials({
      tokens: fixtureRepositoryTokens(),
      permissions: "read",
    }).credential(fixtureBinding()),
    { resolved: "Credential", credential: fixtureToken },
  );
});

test("the permission set is the composition's rather than the caller's", async () => {
  const askedMints: ForgeTokenRequest[] = [];
  const tokens = fixtureRepositoryTokens({ askedMints });
  await mintedRepositoryCredentials({ tokens, permissions: "read" }).credential(
    fixtureBinding(),
  );
  await mintedRepositoryCredentials({
    tokens,
    permissions: "propose",
  }).credential(fixtureBinding());
  assert.deepEqual(
    askedMints.map((request) => request.permissions),
    ["read", "propose"],
  );
});

test("a refusal and an outage reach the source unchanged", async () => {
  for (const [minted, resolved] of [
    ["Denied", "Denied"],
    ["Unavailable", "Unavailable"],
  ] as const) {
    assert.deepEqual(
      await mintedRepositoryCredentials({
        tokens: fixtureRepositoryTokens({ minted: { minted } }),
        permissions: "read",
      }).credential(fixtureBinding()),
      { resolved },
      minted,
    );
  }
});

test("a store or a forge that raised is an outage rather than an answer", async () => {
  assert.deepEqual(
    await mintedRepositoryCredentials({
      tokens: { token: () => Promise.reject(new Error("the store went away")) },
      permissions: "read",
    }).credential(fixtureBinding()),
    { resolved: "Unavailable" },
  );
});
