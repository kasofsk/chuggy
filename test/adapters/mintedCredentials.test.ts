/**
 * The two minted sources over one installation store: which repository selects
 * which installation, and what a repository no claim covers comes to.
 *
 * A MINT IS THE ASSERTION AND SO IS ITS ABSENCE. A repository on another host
 * and an account no tenant claimed are refused without a mint being attempted,
 * and the recorded requests are what prove it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  mintedForgeCredentials,
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
import {
  asForgeBindingId,
  asForgeCredentialReference,
} from "../../src/interpreter/changeProposal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const fixtureForgeId = asForgeId("github");
const fixtureAccount = "kasofsk";
const fixtureToken = asForgeInstallationToken("ghs-minted-q4w5e6");
const fixtureRepository = asRepositoryId(
  `https://${githubRepositoryHost}/${fixtureAccount}/chuggy`,
);
const fixtureInstallationId = asForgeInstallationId("156333284");

const fixtureBinding = {
  partition: {
    tenant: asTenantId("vteng"),
    project: asProjectId("chuggy"),
  },
  repository: fixtureRepository,
  recoveryEpoch: "epoch",
} as unknown as RepositoryBinding;

const fixtureForgeBinding = {
  forge: asForgeBindingId("forge-alpha"),
  credential: asForgeCredentialReference("forge-alpha-proposals"),
};

/** The claimed installations this suite composes, recording every account asked about. */
function fixtureInstallations(
  claimed: readonly string[],
  asked: ForgeInstallationQuery[] = [],
): ForgeInstallationStore {
  return {
    installation: (query) => {
      asked.push(query);
      return Promise.resolve(
        claimed.includes(query.account)
          ? {
              forge: query.forge,
              app: query.app,
              account: query.account,
              installationId: fixtureInstallationId,
              tenant: asTenantId("vteng"),
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

test("a repository's owner selects the installation and the mint names that repository alone", async () => {
  const askedInstallations: ForgeInstallationQuery[] = [];
  const askedMints: ForgeTokenRequest[] = [];
  const minted = await fixtureRepositoryTokens({
    askedInstallations,
    askedMints,
  }).token(fixtureRepository, "write");
  assert.deepEqual(askedInstallations, [
    {
      forge: fixtureForgeId,
      app: "portal",
      account: asForgeAccount(fixtureAccount),
    },
  ]);
  assert.deepEqual(askedMints, [
    {
      installation: {
        forge: fixtureForgeId,
        app: "portal",
        account: asForgeAccount(fixtureAccount),
        installationId: fixtureInstallationId,
        tenant: asTenantId("vteng"),
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
      await fixtureRepositoryTokens({ askedMints }).token(repository, "read"),
      { minted: "Denied" },
      repository,
    );
  }
  assert.deepEqual(
    await fixtureRepositoryTokens({ claimed: [], askedMints }).token(
      fixtureRepository,
      "read",
    ),
    { minted: "Denied" },
  );
  assert.deepEqual(askedMints, [], "no refusal reaches the forge");
});

test("both minted sources answer the token, each in its own vocabulary", async () => {
  const tokens = fixtureRepositoryTokens();
  assert.deepEqual(
    await mintedRepositoryCredentials({
      tokens,
      permissions: "read",
    }).credential(fixtureBinding),
    { resolved: "Credential", credential: fixtureToken },
  );
  assert.deepEqual(
    await mintedForgeCredentials({ tokens, permissions: "propose" }).credential(
      fixtureForgeBinding,
      fixtureRepository,
    ),
    { resolved: "Credential", credential: fixtureToken },
  );
});

test("the permission set is the composition's rather than the caller's", async () => {
  const askedMints: ForgeTokenRequest[] = [];
  const tokens = fixtureRepositoryTokens({ askedMints });
  await mintedRepositoryCredentials({ tokens, permissions: "read" }).credential(
    fixtureBinding,
  );
  await mintedForgeCredentials({ tokens, permissions: "propose" }).credential(
    fixtureForgeBinding,
    fixtureRepository,
  );
  assert.deepEqual(
    askedMints.map((request) => request.permissions),
    ["read", "propose"],
  );
});

test("a refusal and an outage reach both sources unchanged", async () => {
  for (const [minted, resolved] of [
    ["Denied", "Denied"],
    ["Unavailable", "Unavailable"],
  ] as const) {
    const tokens = fixtureRepositoryTokens({ minted: { minted } });
    assert.deepEqual(
      await mintedRepositoryCredentials({
        tokens,
        permissions: "read",
      }).credential(fixtureBinding),
      { resolved },
      minted,
    );
    assert.deepEqual(
      await mintedForgeCredentials({
        tokens,
        permissions: "read",
      }).credential(fixtureForgeBinding, fixtureRepository),
      { resolved },
      minted,
    );
  }
});

test("a store or a forge that raised is an outage rather than an answer", async () => {
  const raising = {
    token: () => Promise.reject(new Error("the store went away")),
  };
  assert.deepEqual(
    await mintedRepositoryCredentials({
      tokens: raising,
      permissions: "read",
    }).credential(fixtureBinding),
    { resolved: "Unavailable" },
  );
  assert.deepEqual(
    await mintedForgeCredentials({
      tokens: raising,
      permissions: "read",
    }).credential(fixtureForgeBinding, fixtureRepository),
    { resolved: "Unavailable" },
  );
});
