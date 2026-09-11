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
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { githubRepositoryHost } from "../../src/adapters/forge/githubAddress.ts";
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
import {
  asForgeInstallationToken,
  type ForgeInstallationTokens,
  type ForgePermissionSet,
} from "../../src/interpreter/forgeInstallation.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

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

/** The app's own half, which a per-repository mint never reaches. */
const unusedInstallationTokens = {} as ForgeInstallationTokens;

/** What one deployment mints with, recording what each composition asked it for. */
function recordingMinting(
  asked: ForgePermissionSet[],
): RepositoryCredentialMinting {
  return {
    installationTokens: unusedInstallationTokens,
    tokens: {
      token: (_repository, _tenant, permissions) => {
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
