/**
 * The workflow runs credential: served only for its own name, only for the
 * requester's one repository, only where that repository's binding is live with
 * its workflow runs on, and minted fresh for every ask.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { workerHeldCredentialBundleSchema } from "../../src/contract/workerPlane.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import type { CredentialRequester } from "../../src/interpreter/credentialIssuers.ts";
import {
  asRepositoryId,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asForgeInstallationToken,
  type ForgePermissionSet,
  type ForgeRepositoryTokens,
  type ForgeTokenMinted,
  type ForgeTokenRequest,
} from "../../src/interpreter/forgeInstallation.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import type {
  ProjectRepositoryBound,
  ProjectRepositoryLandingStore,
} from "../../src/interpreter/repositoryBinding.ts";
import {
  workflowRunsCredential,
  workflowRunsCredentialIssuer,
} from "../../src/interpreter/workflowRunsCredential.ts";

const partition: Partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const repository = asRepositoryId("https://github.com/owner/chuggy.git");

const requester: CredentialRequester = {
  partition,
  ticket: asTicketId(1),
  task: asTaskId(1),
  repository,
  taskKind: "Work",
};

/** The project's binding of the requester's repository, live with its workflow runs on unless a case says otherwise. */
function bound(
  standing: Partial<ProjectRepositoryBound> = {},
): ProjectRepositoryBound {
  return {
    repository,
    boundAt: "2026-11-01T00:00:00Z",
    landing: { kind: "PullRequest" },
    pipelinesWritable: false,
    pipelinesRunnable: true,
    ...standing,
  };
}

/** One mint as the issuer asked it. */
interface Asked {
  readonly repository: RepositoryId;
  readonly partition: Partition;
  readonly permissions: ForgePermissionSet;
  readonly mint: Pick<ForgeTokenRequest, "unheld"> | undefined;
}

/** An issuer over `binding` and a forge answering each mint from `minted` in turn, recording every read and mint. */
function issuer(
  binding: () => Promise<ProjectRepositoryBound | undefined>,
  minted: readonly (() => Promise<ForgeTokenMinted>)[] = [
    () =>
      Promise.resolve({
        minted: "Token",
        token: asForgeInstallationToken("ghs_first"),
        expiresAtMs: 1_000,
      }),
  ],
) {
  const read: (readonly [Partition, RepositoryId])[] = [];
  const asked: Asked[] = [];
  const bindings: Pick<ProjectRepositoryLandingStore, "landing"> = {
    landing: (askedPartition, askedRepository) => {
      read.push([askedPartition, askedRepository]);
      return binding();
    },
  };
  const tokens: ForgeRepositoryTokens = {
    token: (askedRepository, askedPartition, permissions, mint) => {
      const next = minted[asked.length] ?? minted[minted.length - 1];
      asked.push({
        repository: askedRepository,
        partition: askedPartition,
        permissions,
        mint,
      });
      assert.ok(next !== undefined);
      return next();
    },
  };
  return {
    issuer: workflowRunsCredentialIssuer({ tokens, bindings }),
    read,
    asked,
  };
}

test("a live binding with workflow runs on is answered a fresh runPipelines token for the requester's own repository, as a bundle the contract carries", async () => {
  const {
    issuer: issued,
    read,
    asked,
  } = issuer(() => Promise.resolve(bound()));
  const answered = await issued.issue(requester, workflowRunsCredential);
  assert.deepEqual(answered, {
    issued: "Bundle",
    bundle: {
      credential: workflowRunsCredential,
      files: [
        { file: "token", content: { kind: "Secret", secret: "ghs_first" } },
      ],
      variables: [{ kind: "Path", variable: "GH_TOKEN_FILE", file: "token" }],
      expiresAtMs: 1_000,
    },
  });
  assert.ok(answered.issued === "Bundle");
  assert.ok(
    workerHeldCredentialBundleSchema.safeParse(answered.bundle).success,
  );
  assert.deepEqual(read, [[partition, repository]]);
  assert.deepEqual(asked, [
    {
      repository,
      partition,
      permissions: "runPipelines",
      mint: { unheld: true },
    },
  ]);
});

test("a second ask mints again, unheld, and is answered the new token", async () => {
  const { issuer: issued, asked } = issuer(
    () => Promise.resolve(bound()),
    [
      () =>
        Promise.resolve({
          minted: "Token",
          token: asForgeInstallationToken("ghs_first"),
          expiresAtMs: 1_000,
        }),
      () =>
        Promise.resolve({
          minted: "Token",
          token: asForgeInstallationToken("ghs_second"),
          expiresAtMs: 2_000,
        }),
    ],
  );
  await issued.issue(requester, workflowRunsCredential);
  const second = await issued.issue(requester, workflowRunsCredential);
  assert.ok(second.issued === "Bundle");
  assert.deepEqual(
    [second.bundle.files[0]?.content, second.bundle.expiresAtMs],
    [{ kind: "Secret", secret: "ghs_second" }, 2_000],
  );
  assert.deepEqual(
    asked.map((mint) => mint.mint),
    [{ unheld: true }, { unheld: true }],
  );
});

test("every other name is not served, and reads and mints nothing", async () => {
  const {
    issuer: issued,
    read,
    asked,
  } = issuer(() => Promise.resolve(bound()));
  for (const credential of [
    "track-record",
    "chuggy.github-workflow-run",
    "chuggy.other",
  ])
    assert.deepEqual(await issued.issue(requester, credential), {
      issued: "NotServed",
    });
  assert.deepEqual([read, asked], [[], []]);
});

test("a requester pinning no one repository is refused, and reads and mints nothing", async () => {
  const {
    issuer: issued,
    read,
    asked,
  } = issuer(() => Promise.resolve(bound()));
  const unpinned: CredentialRequester = {
    partition,
    ticket: requester.ticket,
    task: requester.task,
    taskKind: "Work",
  };
  assert.deepEqual(await issued.issue(unpinned, workflowRunsCredential), {
    issued: "Absent",
    reason: "IssuerRefused",
  });
  assert.deepEqual([read, asked], [[], []]);
});

test("no live binding, or one with workflow runs off, is not enabled, and nothing is minted", async () => {
  for (const [why, binding] of [
    ["no binding", undefined],
    ["retired", bound({ retiredAt: "2026-11-02T00:00:00Z" })],
    ["workflow runs off", bound({ pipelinesRunnable: false })],
    [
      "pipelines writable but runs off",
      bound({ pipelinesRunnable: false, pipelinesWritable: true }),
    ],
  ] as const) {
    const { issuer: issued, asked } = issuer(() => Promise.resolve(binding));
    assert.deepEqual(
      await issued.issue(requester, workflowRunsCredential),
      { issued: "Absent", reason: "NotEnabled" },
      why,
    );
    assert.deepEqual(asked, [], why);
  }
});

test("a mint the forge refuses is refused, never answered with a narrower token", async () => {
  const { issuer: issued, asked } = issuer(
    () => Promise.resolve(bound()),
    [
      () =>
        Promise.resolve({
          minted: "Denied",
          unreached: { reach: "Unclaimed", app: "worker" },
        }),
    ],
  );
  assert.deepEqual(await issued.issue(requester, workflowRunsCredential), {
    issued: "Absent",
    reason: "IssuerRefused",
  });
  assert.deepEqual(
    asked.map((mint) => mint.permissions),
    ["runPipelines"],
  );
});

test("a forge or a store that could not be reached, or that raised, is an outage", async () => {
  const raised = () => Promise.reject(new Error("went away"));
  for (const [why, binding, minted] of [
    ["binding read raised", raised, undefined],
    [
      "forge unreached",
      () => Promise.resolve(bound()),
      () => Promise.resolve({ minted: "Unavailable" } as const),
    ],
    ["forge raised", () => Promise.resolve(bound()), raised],
  ] as const) {
    const { issuer: issued } = issuer(
      binding,
      minted === undefined ? undefined : [minted],
    );
    assert.deepEqual(
      await issued.issue(requester, workflowRunsCredential),
      { issued: "Unavailable" },
      why,
    );
  }
});
