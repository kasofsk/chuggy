/**
 * The minted source over one installation store: which repository selects which
 * installation, which tenant may read it, and what a repository no claim of
 * that tenant's covers comes to.
 *
 * A MINT IS THE ASSERTION AND SO IS ITS ABSENCE. A repository on another host,
 * an account nobody claimed and an account another tenant claimed are refused
 * without a mint being attempted, and the recorded requests are what prove it.
 * The same goes for the pipeline definitions: what a request carries is the
 * binding's allowance, and a set naming none reads no binding.
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
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import type {
  ProjectRepositoryBound,
  ProjectRepositoryLandingStore,
} from "../../src/interpreter/repositoryBinding.ts";

const fixtureForgeId = asForgeId("github");
const fixtureAccount = "kasofsk";
const fixtureTenant = asTenantId("vteng");
const fixtureOtherTenant = asTenantId("otherco");
const fixturePartition: Partition = {
  tenant: fixtureTenant,
  project: asProjectId("chuggy"),
};
const fixtureOtherPartition: Partition = {
  tenant: fixtureOtherTenant,
  project: asProjectId("chuggy"),
};
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

/** One binding of the fixture repository, live and allowing the pipeline definitions unless a case says otherwise. */
function fixtureBound(
  standing: Partial<ProjectRepositoryBound> = {},
): ProjectRepositoryBound {
  return {
    repository: fixtureRepository,
    boundAt: "2026-10-25T00:00:00Z",
    landing: { mode: "Push" },
    pipelinesWritable: true,
    ...standing,
  };
}

/** The binding read a mint makes, recording each partition and repository it was asked about. */
function fixtureBindings(
  bound: ProjectRepositoryBound | undefined,
  asked: (readonly [Partition, RepositoryId])[] = [],
): Pick<ProjectRepositoryLandingStore, "landing"> {
  return {
    landing: (partition, repository) => {
      asked.push([partition, repository]);
      return Promise.resolve(bound);
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
    readonly bindings?: Pick<ProjectRepositoryLandingStore, "landing">;
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
    bindings: options.bindings ?? fixtureBindings(fixtureBound()),
  });
}

test("a repository's owner and the asking tenant select the installation, and the mint names that repository alone", async () => {
  const askedInstallations: ForgeInstallationQuery[] = [];
  const askedMints: ForgeTokenRequest[] = [];
  const minted = await fixtureRepositoryTokens({
    askedInstallations,
    askedMints,
  }).token(fixtureRepository, fixturePartition, "read");
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
      permissions: "read",
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
        fixturePartition,
        "read",
      ),
      { minted: "Denied", evidence: { mint: "Address" } },
      repository,
    );
  }
  assert.deepEqual(
    await fixtureRepositoryTokens({ claimed: [], askedMints }).token(
      fixtureRepository,
      fixturePartition,
      "read",
    ),
    {
      minted: "Denied",
      evidence: { mint: "NoInstallation" },
      unreached: { reach: "Unclaimed", app: "portal" },
    },
  );
  assert.deepEqual(askedMints, [], "no refusal reaches the forge");
});

test("a forge refusing the mint says whether the installation does not select the repository or was refused, and an outage says neither", async () => {
  for (const [unselected, reach] of [
    [true, "Unselected"],
    [false, "Refused"],
  ] as const) {
    const evidence = { mint: "Status", status: 422 } as const;
    assert.deepEqual(
      await fixtureRepositoryTokens({
        minted: {
          minted: "Denied",
          evidence,
          ...(unselected ? { unselected: true } : {}),
        },
      }).token(fixtureRepository, fixturePartition, "read"),
      {
        minted: "Denied",
        evidence,
        unreached: {
          reach,
          app: "portal",
          installationId: fixtureInstallationId,
        },
      },
    );
  }
  const outage = {
    minted: "Unavailable",
    evidence: { mint: "Status", status: 500 },
  } as const;
  assert.deepEqual(
    await fixtureRepositoryTokens({ minted: outage }).token(
      fixtureRepository,
      fixturePartition,
      "read",
    ),
    outage,
  );
});

test("an account another tenant claimed is denied to this one, and the tenant is what the store was asked", async () => {
  const askedInstallations: ForgeInstallationQuery[] = [];
  const askedMints: ForgeTokenRequest[] = [];
  const tokens = fixtureRepositoryTokens({ askedInstallations, askedMints });
  assert.deepEqual(
    await tokens.token(fixtureRepository, fixtureOtherPartition, "write"),
    {
      minted: "Denied",
      evidence: { mint: "NoInstallation" },
      unreached: { reach: "Unclaimed", app: "portal" },
    },
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
    { resolved: "Denied", evidence: { mint: "NoInstallation" } },
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

test("a mint's cause reaches the source beside its refusal or its outage", async () => {
  for (const minted of [
    { minted: "Denied", evidence: { mint: "Status", status: 404 } },
    { minted: "Unavailable", evidence: { mint: "Status", status: 500 } },
  ] as const) {
    assert.deepEqual(
      await mintedRepositoryCredentials({
        tokens: fixtureRepositoryTokens({ minted }),
        permissions: "read",
      }).credential(fixtureBinding()),
      { resolved: minted.minted, evidence: minted.evidence },
    );
  }
});

test("a store and a mint that raised each say which, and still raise to a caller of the tokens", async () => {
  const storeRaised = new Error("the store went away");
  const mintRaised = new Error("the forge went away");
  const store: ForgeInstallationStore = {
    installation: () => Promise.reject(storeRaised),
  };
  const mint: ForgeInstallationTokens = {
    mint: () => Promise.reject(mintRaised),
  };
  for (const [installations, tokens, raised, cause] of [
    [store, fixtureTokens({ minted: "Denied" }), storeRaised, "StoreRaised"],
    [fixtureInstallations([fixtureAccount]), mint, mintRaised, "MintRaised"],
  ] as const) {
    const repositoryTokens = mintedRepositoryTokens({
      forge: fixtureForgeId,
      app: "portal",
      repositoryHost: githubRepositoryHost,
      installations,
      tokens,
      bindings: fixtureBindings(fixtureBound()),
    });
    await assert.rejects(
      repositoryTokens.token(fixtureRepository, fixturePartition, "read"),
      (thrown) => thrown === raised,
    );
    assert.deepEqual(
      await mintedRepositoryCredentials({
        tokens: repositoryTokens,
        permissions: "read",
      }).credential(fixtureBinding()),
      { resolved: "Unavailable", evidence: { mint: cause } },
      cause,
    );
  }
});

/**
 * Each binding a write or a proposal can meet, and whether it allows the
 * pipeline definitions: only a live one that allows them does, and a project
 * binding no such repository allows nothing.
 */
const fixturePipelinesBindings: readonly (readonly [
  string,
  ProjectRepositoryBound | undefined,
  boolean,
])[] = [
  ["a live binding allowing them", fixtureBound(), true],
  [
    "a live binding not allowing them",
    fixtureBound({ pipelinesWritable: false }),
    false,
  ],
  [
    "a retired binding allowing them",
    fixtureBound({ retiredAt: "2026-10-25T01:00:00Z" }),
    false,
  ],
  ["no binding", undefined, false],
];

test("a write or a proposal carries the pipeline definitions only where the act's own project binds the repository live and allows them", async () => {
  for (const permissions of ["write", "propose"] as const) {
    for (const [binding, bound, allowed] of fixturePipelinesBindings) {
      const askedMints: ForgeTokenRequest[] = [];
      const askedBindings: (readonly [Partition, RepositoryId])[] = [];
      assert.equal(
        (
          await fixtureRepositoryTokens({
            askedMints,
            bindings: fixtureBindings(bound, askedBindings),
          }).token(fixtureRepository, fixturePartition, permissions)
        ).minted,
        "Token",
      );
      assert.deepEqual(
        askedBindings,
        [[fixturePartition, fixtureRepository]],
        `${permissions}, ${binding}: the binding read is the act's own project's`,
      );
      assert.deepEqual(
        askedMints.map((request) => request.pipelinesAllowed),
        [allowed ? true : undefined],
        `${permissions}, ${binding}`,
      );
    }
  }
});

test("a set naming no pipeline definitions reads no binding and carries none", async () => {
  const askedMints: ForgeTokenRequest[] = [];
  const askedBindings: (readonly [Partition, RepositoryId])[] = [];
  await fixtureRepositoryTokens({
    askedMints,
    bindings: fixtureBindings(fixtureBound(), askedBindings),
  }).token(fixtureRepository, fixturePartition, "read");
  assert.deepEqual(askedBindings, []);
  assert.deepEqual(
    askedMints.map((request) => request.pipelinesAllowed),
    [undefined],
  );
});

/** A read that failed established nothing, so the mint waits rather than going ahead without the definitions. */
test("a binding read that raised is an outage the source names, and mints nothing", async () => {
  const askedMints: ForgeTokenRequest[] = [];
  const raised = new Error("the binding read went away");
  const tokens = fixtureRepositoryTokens({
    askedMints,
    bindings: { landing: () => Promise.reject(raised) },
  });
  await assert.rejects(
    tokens.token(fixtureRepository, fixturePartition, "write"),
    (thrown) => thrown === raised,
  );
  assert.deepEqual(
    await mintedRepositoryCredentials({
      tokens,
      permissions: "write",
    }).credential(fixtureBinding()),
    { resolved: "Unavailable", evidence: { mint: "StoreRaised" } },
  );
  assert.deepEqual(askedMints, [], "no mint follows a binding nobody read");
});
