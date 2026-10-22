/**
 * What the plane mints for one pod, which is the whole of what a pod may obtain
 * by asking: the permission set its recorded task kind needs on the repository
 * its own row names, a read of any other its project binds live, and a refusal
 * that is kept apart from an outage all the way out — because a refusal for
 * its own repository leaves the pod on its launcher's mount and an outage
 * does not.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  allForgeApps,
  asForgeInstallationToken,
  workerPodForgeApp,
  type ForgePermissionSet,
  type ForgeTokenMinted,
  type ForgeRepositoryTokens,
} from "../../src/interpreter/forgeInstallation.ts";
import type { ExecutionTaskKind } from "../../src/interpreter/executionRequirement.ts";
import {
  asRepositoryId,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  asRepositoryLanding,
  type ProjectRepositoryBound,
  type ProjectRepositoryLandingStore,
} from "../../src/interpreter/repositoryBinding.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
import {
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/schedulerIdentity.ts";
import type { WorkerAttemptAuthority } from "../../src/interpreter/workerPlane.ts";
import {
  forgeCredentialUsername,
  workerPlaneCredentialMinting,
} from "../../src/interpreter/workerPlaneCredentials.ts";

const partition: Partition = {
  tenant: asTenantId("vteng"),
  project: asProjectId("chuggy"),
};

const repository = asRepositoryId("github.com/kasofsk/chuggy");
const mirror = asRepositoryId("git.vteng.io/mirror/chuggy");
const sibling = asRepositoryId("github.com/kasofsk/chuggy-common");

const token = asForgeInstallationToken("ghs_0123456789abcdefghij");
const expiresAtMs = 1_700_000_000_000;

/** What one mint was asked for, so a case can say the pod widened nothing. */
interface Asked {
  readonly repository: RepositoryId;
  readonly tenant: string;
  readonly permissions: ForgePermissionSet;
}

function tokensOf(
  minted: ForgeTokenMinted | Error,
  asked: Asked[],
): ForgeRepositoryTokens {
  return {
    token: (forRepository, tenant, permissions) => {
      asked.push({ repository: forRepository, tenant, permissions });
      return minted instanceof Error
        ? Promise.reject(minted)
        : Promise.resolve(minted);
    },
  };
}

const granted: ForgeTokenMinted = { minted: "Token", token, expiresAtMs };

/**
 * What one binding was read for, the partition included: a session is held to
 * its own project's bindings and not to whatever else its tenant has bound.
 */
interface Read {
  readonly partition: Partition;
  readonly named: RepositoryId | undefined;
}

function bindingsOf(
  bound: ProjectRepositoryBound | Error | undefined,
  asked: Read[] = [],
): Pick<ProjectRepositoryLandingStore, "landing"> {
  return {
    landing: (partitionRead, named) => {
      asked.push({ partition: partitionRead, named });
      return bound instanceof Error
        ? Promise.reject(bound)
        : Promise.resolve(bound);
    },
  };
}

/** One binding as its project's point read answers it, live unless given the instant it retired at. */
function bindingOf(
  bound: RepositoryId,
  retiredAt?: string,
): ProjectRepositoryBound {
  return {
    repository: bound,
    boundAt: "2026-10-01T00:00:00Z",
    landing: asRepositoryLanding("Push"),
    ...(retiredAt === undefined ? {} : { retiredAt }),
  };
}

function authorityOf(
  taskKind: ExecutionTaskKind,
  inputs: readonly { kind: string; reference: string }[] = [
    { kind: "Repository", reference: repository },
  ],
): WorkerAttemptAuthority {
  return {
    live: true,
    partition,
    execution: asExecutionId("execution-1"),
    attempt: asAttemptId("attempt-1"),
    generation: 1,
    taskKind,
    manifest: asResultManifestId("manifest-1"),
    inputBundle: "bundle-1",
    inputBundleDigest: "digest-1",
    inputs: inputs.map((input, ordinal) => ({ ordinal, ...input })),
  };
}

/**
 * A work attempt is minted `write`, and the branch ruleset admits the portal
 * App to update a protected branch. Minting a pod's credential under that app
 * would therefore hand an agent-executed pod a push to main, so the app a pod
 * is minted under is the one the ruleset refuses and is not a deployment's to
 * choose.
 */
test("a pod is minted under the app the branch ruleset refuses, never the portal's", () => {
  assert.equal(workerPodForgeApp, "worker");
  assert.notEqual(workerPodForgeApp, "portal");
  assert.ok(allForgeApps.includes(workerPodForgeApp));
});

test("a work attempt is minted write on the repository its own bundle pinned", async () => {
  const asked: Asked[] = [];
  const minting = workerPlaneCredentialMinting({
    tokens: tokensOf(granted, asked),
    bindings: bindingsOf(undefined),
  });

  assert.deepEqual(await minting.attempt(authorityOf("Work")), {
    minted: "Credential",
    value: { username: forgeCredentialUsername, password: token, expiresAtMs },
  });
  assert.deepEqual(asked, [
    { repository, tenant: partition.tenant, permissions: "write" },
  ]);
});

test("an evaluation attempt is minted read, because an evaluation pushes nothing", async () => {
  const asked: Asked[] = [];
  const minting = workerPlaneCredentialMinting({
    tokens: tokensOf(granted, asked),
    bindings: bindingsOf(undefined),
  });

  await minting.attempt(authorityOf("Evaluation"));

  assert.equal(asked[0]?.permissions, "read");
});

test("a bundle pinning no single repository is minted nothing at all", async () => {
  const asked: Asked[] = [];
  const minting = workerPlaneCredentialMinting({
    tokens: tokensOf(granted, asked),
    bindings: bindingsOf(undefined),
  });

  for (const inputs of [
    [],
    [{ kind: "TargetCommit", reference: "abc123" }],
    [
      { kind: "Repository", reference: repository },
      { kind: "Repository", reference: mirror },
    ],
  ])
    assert.deepEqual(await minting.attempt(authorityOf("Work", inputs)), {
      minted: "NotFound",
    });
  assert.deepEqual(asked, [], "a bundle that pinned no one repository minted");
});

test("a forge that refused this app is a refusal the pod falls back from", async () => {
  const minting = workerPlaneCredentialMinting({
    tokens: tokensOf({ minted: "Denied" }, []),
    bindings: bindingsOf(undefined),
  });

  assert.deepEqual(await minting.attempt(authorityOf("Work")), {
    minted: "NotFound",
  });
});

test("a forge that could not be reached is an outage and never a fallback", async () => {
  for (const minted of [
    { minted: "Unavailable" } as const,
    new Error("the forge did not answer"),
  ]) {
    const minting = workerPlaneCredentialMinting({
      tokens: tokensOf(minted, []),
      bindings: bindingsOf(undefined),
    });

    assert.deepEqual(await minting.attempt(authorityOf("Work")), {
      minted: "Unavailable",
    });
  }
});

test("a session is minted read on what its own project binds, never on what it named", async () => {
  const asked: Asked[] = [];
  const named: Read[] = [];
  const minting = workerPlaneCredentialMinting({
    tokens: tokensOf(granted, asked),
    bindings: bindingsOf(bindingOf(repository), named),
  });

  assert.deepEqual(await minting.session(partition, mirror), {
    minted: "Credential",
    value: { username: forgeCredentialUsername, password: token, expiresAtMs },
  });
  assert.deepEqual(named, [{ partition, named: mirror }]);
  assert.deepEqual(asked, [
    { repository, tenant: partition.tenant, permissions: "read" },
  ]);
});

test("a session naming what its project does not bind is minted nothing", async () => {
  const asked: Asked[] = [];
  const minting = workerPlaneCredentialMinting({
    tokens: tokensOf(granted, asked),
    bindings: bindingsOf(undefined),
  });

  assert.deepEqual(await minting.session(partition, mirror), {
    minted: "NotFound",
  });
  assert.deepEqual(asked, [], "an unbound repository was minted for");
});

test("a binding store that could not be read is an outage, not an absent binding", async () => {
  const asked: Asked[] = [];
  const minting = workerPlaneCredentialMinting({
    tokens: tokensOf(granted, asked),
    bindings: bindingsOf(new Error("the store did not answer")),
  });

  assert.deepEqual(await minting.session(partition, repository), {
    minted: "Unavailable",
  });
  assert.deepEqual(asked, [], "an unread binding was minted for");
});

test("an attempt naming no repository is minted its own for what its task kind does", async () => {
  for (const [taskKind, permissions] of [
    ["Work", "write"],
    ["Evaluation", "read"],
  ] as const) {
    const asked: Asked[] = [];
    const read: Read[] = [];
    const minting = workerPlaneCredentialMinting({
      tokens: tokensOf(granted, asked),
      bindings: bindingsOf(bindingOf(repository), read),
    });

    assert.deepEqual(await minting.attempt(authorityOf(taskKind)), {
      minted: "Credential",
      value: {
        username: forgeCredentialUsername,
        password: token,
        expiresAtMs,
      },
    });
    assert.deepEqual(asked, [
      { repository, tenant: partition.tenant, permissions },
    ]);
    assert.deepEqual(read, [], "its own repository was held to the bindings");
  }
});

test("an attempt naming its own repository is minted read, whatever its task kind", async () => {
  for (const taskKind of ["Work", "Evaluation"] as const) {
    const asked: Asked[] = [];
    const read: Read[] = [];
    const minting = workerPlaneCredentialMinting({
      tokens: tokensOf(granted, asked),
      bindings: bindingsOf(bindingOf(repository), read),
    });

    assert.deepEqual(await minting.attempt(authorityOf(taskKind), repository), {
      minted: "Credential",
      value: {
        username: forgeCredentialUsername,
        password: token,
        expiresAtMs,
      },
    });
    assert.deepEqual(asked, [
      { repository, tenant: partition.tenant, permissions: "read" },
    ]);
    assert.deepEqual(read, [], "its own repository was held to the bindings");
  }
});

test("an attempt naming another repository its project binds is minted read, whatever its task kind", async () => {
  for (const taskKind of ["Work", "Evaluation"] as const) {
    const asked: Asked[] = [];
    const read: Read[] = [];
    const minting = workerPlaneCredentialMinting({
      tokens: tokensOf(granted, asked),
      bindings: bindingsOf(bindingOf(sibling), read),
    });

    assert.deepEqual(await minting.attempt(authorityOf(taskKind), sibling), {
      minted: "Credential",
      value: {
        username: forgeCredentialUsername,
        password: token,
        expiresAtMs,
      },
    });
    assert.deepEqual(read, [{ partition, named: sibling }]);
    assert.deepEqual(asked, [
      { repository: sibling, tenant: partition.tenant, permissions: "read" },
    ]);
  }
});

test("a repository its project retired or never bound is minted nothing, for an attempt and a session", async () => {
  for (const bound of [bindingOf(sibling, "2026-10-02T00:00:00Z"), undefined]) {
    const asked: Asked[] = [];
    const minting = workerPlaneCredentialMinting({
      tokens: tokensOf(granted, asked),
      bindings: bindingsOf(bound),
    });

    assert.deepEqual(await minting.attempt(authorityOf("Work"), sibling), {
      minted: "NotFound",
    });
    assert.deepEqual(await minting.session(partition, sibling), {
      minted: "NotFound",
    });
    assert.deepEqual(asked, [], "a repository not bound live was minted for");
  }
});

test("an attempt's named repository whose binding could not be read is an outage, not a refusal", async () => {
  const asked: Asked[] = [];
  const minting = workerPlaneCredentialMinting({
    tokens: tokensOf(granted, asked),
    bindings: bindingsOf(new Error("the store did not answer")),
  });

  assert.deepEqual(await minting.attempt(authorityOf("Work"), sibling), {
    minted: "Unavailable",
  });
  assert.deepEqual(asked, [], "an unread binding was minted for");
});
