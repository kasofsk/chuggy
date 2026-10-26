/**
 * What each control-plane process mints for.
 *
 * THE PERMISSION IS THE COMPOSITION'S AND NEVER THE CALLER'S, so what a token
 * may do is decided in one place per act and is asserted there. A source
 * composed for one act cannot be asked for another's permission, which is why
 * each of these is its own function and its own case.
 *
 * THE FAKE IS THE ASSERTION. Each case hands the composition a
 * `ForgeRepositoryTokens` that records what it was asked for, so a case pins the
 * composition's own choice rather than a permission it passed into its own
 * fixture.
 *
 * EVERY MINT THAT WRITES IS HELD TO ITS OWN PROJECT'S BINDING. The cases at
 * the end compose each path that asks for `write` or `propose` over the minted
 * source itself, so what reaches the forge is the binding's allowance as the
 * path's own partition reads it, switched on and off.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { githubRepositoryHost } from "../../src/adapters/forge/githubAddress.ts";
import { mintedRepositoryTokens } from "../../src/adapters/forge/mintedCredentials.ts";
import {
  composeApiRepositoryCredentials,
  composeConfigurationImporterCredentials,
  composeFinalizerForgeCredentials,
  composeFinalizerRepositoryCredentials,
  composeTicketServiceCredentials,
  type RepositoryCredentialMinting,
} from "../../src/compose.ts";
import {
  asForgeBindingId,
  asForgeCredentialReference,
  type ChangeProposalCredentialRequest,
} from "../../src/interpreter/changeProposal.ts";
import {
  asRepositoryId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import { forgeCredentialMinting } from "../../src/interpreter/forgeCredentials.ts";
import {
  asForgeId,
  asForgeInstallationId,
  asForgeInstallationToken,
  type ForgePermissionSet,
  type ForgeTokenRequest,
} from "../../src/interpreter/forgeInstallation.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import type { ProjectRepositoryLandingStore } from "../../src/interpreter/repositoryBinding.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
import {
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/schedulerIdentity.ts";
import { workerPlaneCredentialMinting } from "../../src/interpreter/workerPlaneCredentials.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";

const partition = {
  tenant: asTenantId("vteng"),
  project: asProjectId("chuggy"),
};
const repository = asRepositoryId(
  `https://${githubRepositoryHost}/kasofsk/chuggy`,
);

/** A repository on a host no portal key covers, which is what a file is still mounted for. */
const elsewhere = asRepositoryId("https://forge.invalid/kasofsk/other");

/** The binding a promotion or an observation presents a credential for. */
const binding = {
  partition,
  repository,
  recoveryEpoch: "epoch",
} as RepositoryBinding;

/** The proposal's ask against that same repository, which is what selects the minting source. */
const proposal: ChangeProposalCredentialRequest = {
  binding: {
    forge: asForgeBindingId("forge-alpha"),
    credential: asForgeCredentialReference("forge-alpha-proposals"),
  },
  partition,
  repository,
};

/** What one deployment mints with, recording what each composition asked it for. */
function recordingMinting(
  asked: ForgePermissionSet[],
): RepositoryCredentialMinting {
  return {
    tokens: {
      token: (_repository, _partition, permissions) => {
        asked.push(permissions);
        return Promise.resolve({
          minted: "Token" as const,
          token: asForgeInstallationToken("ghs-minted-q4w5e6"),
          expiresAtMs: 1,
        });
      },
    },
  };
}

test("the finalizer promotes under a token that writes contents and nothing more", async () => {
  const asked: ForgePermissionSet[] = [];
  const credentials = composeFinalizerRepositoryCredentials(
    { sources: [] },
    recordingMinting(asked),
  );

  await credentials.credential(binding);

  assert.deepEqual(asked, ["write"]);
});

test("the finalizer opens a proposal under a token that may open one", async () => {
  const asked: ForgePermissionSet[] = [];
  const credentials = composeFinalizerForgeCredentials(
    { bindings: [] },
    recordingMinting(asked),
  );

  await credentials.credential(proposal);

  assert.deepEqual(asked, ["propose"]);
});

test("the ticket service observes a source under a token that only reads", async () => {
  const asked: ForgePermissionSet[] = [];
  const credentials = composeTicketServiceCredentials(
    { sources: [] },
    recordingMinting(asked),
  );

  await credentials.credential(binding);

  assert.deepEqual(asked, ["read"]);
});

test("the importer reads a snapshot under a token that only reads", async () => {
  const asked: ForgePermissionSet[] = [];
  const credentials = composeConfigurationImporterCredentials(
    { sources: [] },
    recordingMinting(asked),
  );

  await credentials.credential(binding);

  assert.deepEqual(asked, ["read"]);
});

test("the api reads a repository under a token that only reads", async () => {
  const asked: ForgePermissionSet[] = [];
  const credentials = composeApiRepositoryCredentials(
    { sources: [] },
    recordingMinting(asked),
  );

  await credentials.credential(binding);

  assert.deepEqual(asked, ["read"]);
});

test("a deployment holding no app key is answered by its files alone", async () => {
  const credentials = composeTicketServiceCredentials(
    { sources: [] },
    undefined,
  );

  assert.deepEqual(await credentials.credential(binding), {
    resolved: "Denied",
  });
});

/** A file holding one credential, removed when the case that wrote it is done. */
function mountedCredential(t: TestContext, value: string): string {
  const root = mkdtempSync(join(tmpdir(), "chuggy-compose-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const path = join(root, "elsewhere");
  writeFileSync(path, `${value}\n`);
  return path;
}

test("a deployment that mints still reaches another host through its files", async (t) => {
  const asked: ForgePermissionSet[] = [];
  const credentials = composeTicketServiceCredentials(
    {
      sources: [
        {
          repository: elsewhere,
          path: mountedCredential(t, "mounted-a1b2c3"),
        },
      ],
    },
    recordingMinting(asked),
  );

  assert.deepEqual(
    await credentials.credential({ ...binding, repository: elsewhere }),
    { resolved: "Credential", credential: "mounted-a1b2c3" },
  );
  assert.deepEqual(asked, [], "the mint answers for its own host and no other");
});

/** What one path's mints came to: whether each mint carried the allowance, and whose binding was read for it. */
interface Allowance {
  readonly mints: ForgeTokenRequest[];
  readonly reads: Partition[];
}

/**
 * The minted source over a binding switched on or off, the installation and
 * the mint recording what they were asked. The binding answers for the
 * fixture's own project alone, so a path that read another's would mint
 * without the allowance.
 */
function allowanceTokens(pipelinesWritable: boolean, allowance: Allowance) {
  const bindings: Pick<ProjectRepositoryLandingStore, "landing"> = {
    landing: (read, named) => {
      allowance.reads.push(read);
      return Promise.resolve(
        read.tenant === partition.tenant &&
          read.project === partition.project &&
          named === repository
          ? {
              repository,
              boundAt: "2026-10-25T00:00:00Z",
              landing: { mode: "Push" },
              pipelinesWritable,
            }
          : undefined,
      );
    },
  };
  return mintedRepositoryTokens({
    forge: asForgeId("github"),
    app: "portal",
    repositoryHost: githubRepositoryHost,
    installations: {
      installation: (query) =>
        Promise.resolve({
          forge: query.forge,
          app: query.app,
          account: query.account,
          installationId: asForgeInstallationId("156333284"),
        }),
    },
    tokens: {
      mint: (request) => {
        allowance.mints.push(request);
        return Promise.resolve({
          minted: "Token" as const,
          token: asForgeInstallationToken("ghs-minted-q4w5e6"),
          expiresAtMs: 1,
        });
      },
    },
    bindings,
  });
}

/** Runs one path with its binding on and then off, answering what each mint carried and whose binding it read. */
async function allowanceOf(
  path: (tokens: ReturnType<typeof allowanceTokens>) => unknown,
): Promise<readonly [Allowance, Allowance]> {
  const on: Allowance = { mints: [], reads: [] };
  const off: Allowance = { mints: [], reads: [] };
  await path(allowanceTokens(true, on));
  await path(allowanceTokens(false, off));
  return [on, off];
}

/** Asserts a path asked for one write-shaped set, read its own project's binding, and carried the allowance only where it was on. */
function allowanceAsserted(
  [on, off]: readonly [Allowance, Allowance],
  permissions: ForgePermissionSet,
): void {
  for (const [which, allowance, carried] of [
    ["on", on, true],
    ["off", off, undefined],
  ] as const) {
    assert.deepEqual(
      allowance.mints.map((request) => [
        request.permissions,
        request.pipelinesAllowed,
      ]),
      [[permissions, carried]],
      which,
    );
    assert.deepEqual(allowance.reads, [partition], which);
  }
}

test("the finalizer's push carries the pipeline definitions only where its project's binding allows them", async () => {
  allowanceAsserted(
    await allowanceOf((tokens) =>
      composeFinalizerRepositoryCredentials(
        { sources: [] },
        { tokens },
      ).credential(binding),
    ),
    "write",
  );
});

test("the finalizer's proposal carries the pipeline definitions only where its project's binding allows them", async () => {
  allowanceAsserted(
    await allowanceOf((tokens) =>
      composeFinalizerForgeCredentials({ bindings: [] }, { tokens }).credential(
        proposal,
      ),
    ),
    "propose",
  );
});

test("a work attempt's credential carries the pipeline definitions only where its project's binding allows them", async () => {
  allowanceAsserted(
    await allowanceOf((tokens) =>
      workerPlaneCredentialMinting({
        tokens,
        bindings: { landing: () => Promise.resolve(undefined) },
      }).attempt({
        live: true,
        partition,
        execution: asExecutionId("execution-1"),
        attempt: asAttemptId("attempt-1"),
        generation: 1,
        taskKind: "Work",
        manifest: asResultManifestId("manifest-1"),
        inputBundle: "bundle-1",
        inputBundleDigest: "digest-1",
        inputs: [{ ordinal: 0, kind: "Repository", reference: repository }],
      }),
    ),
    "write",
  );
});

test("a member's write or proposal carries the pipeline definitions only where the project's binding allows them", async () => {
  const principal = asPrincipal("14:https://issuer/member");
  for (const permissions of ["write", "propose"] as const)
    allowanceAsserted(
      await allowanceOf((tokens) =>
        forgeCredentialMinting(
          {
            authorize: () => Promise.resolve(memberAuthority(principal)),
            authorizeTenant: () => Promise.resolve(undefined),
            authorizeSite: projectAccessSiteRefused,
          },
          {
            landing: (_read, named) =>
              Promise.resolve({
                repository: named,
                boundAt: "2026-10-25T00:00:00Z",
                landing: { mode: "Push" },
                pipelinesWritable: false,
              }),
          },
          tokens,
        ).mint(principal, partition, { repository, permissions }),
      ),
      permissions,
    );
});
