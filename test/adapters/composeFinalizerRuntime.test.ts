/**
 * The finalizer's outermost composition: the preconditions a deployment is held
 * to, and the ports it promotes through once they are met.
 *
 * THE GIT PORT IS BUILT ON DEMAND AND THAT IS LOAD-BEARING. Opening a scratch
 * refuses an absent git by raising, so composing one before the preconditions
 * are asked would turn `git-available` into a crash and report nothing.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { composeFinalizerRuntime } from "../../src/compose.ts";
import { asForgeBindingId } from "../../src/interpreter/changeProposal.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import {
  finalizerSettingsOf,
  type FinalizerSettings,
} from "../../src/interpreter/finalizerSettings.ts";

/** The repository the fixture forge binding holds, which is what selects that binding. */
const forgeRepository = asRepositoryId("https://forge.invalid/acme/atlas.git");

function settings(
  t: TestContext,
  forges = true,
  bound: Readonly<Record<string, unknown>> = {},
): FinalizerSettings {
  const root = mkdtempSync(join(tmpdir(), "chuggy-compose-finalizer-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const credential = join(root, "credential");
  writeFileSync(credential, "secret-a1b2c3");
  const forgeCredential = join(root, "forge-credential");
  writeFileSync(forgeCredential, "forge-secret");
  return finalizerSettingsOf({
    ...(forges
      ? {
          CHUG_FINALIZER_FORGE_BINDINGS: JSON.stringify([
            {
              forge: "forge-alpha",
              repositoryHost: "forge.invalid",
              apiHost: "api.forge.invalid",
              credentialReference: "forge-alpha-proposals",
              path: forgeCredential,
              ...bound,
            },
          ]),
        }
      : {}),
    CHUG_FINALIZER_DATABASE_URL: "postgres://finalizer@localhost/chuggy",
    CHUG_FINALIZER_OWNER: "finalizer-1",
    CHUG_FINALIZER_RECOVERY_EPOCH: "epoch-1",
    CHUG_FINALIZER_ARTIFACT_ROOT: root,
    CHUG_FINALIZER_GIT_SCRATCH_ROOT: join(root, "scratch"),
    CHUG_FINALIZER_GIT_COMMIT_NAME: "chuggy",
    CHUG_FINALIZER_GIT_COMMIT_EMAIL: "chuggy@example.invalid",
    CHUG_FINALIZER_CREDENTIAL_SOURCES: JSON.stringify([
      { repository: "https://example.invalid/one.git", path: credential },
    ]),
    PATH: process.env["PATH"] ?? "",
  });
}

test("a deployment is held to its git, its scratch, its storage and its credentials", async (t) => {
  const composition = composeFinalizerRuntime(settings(t));
  assert.deepEqual(
    composition.preconditions.map((precondition) => precondition.name),
    [
      "git-available",
      "git-scratch-writable",
      "artifact-root-writable",
      "repository-credentials-available",
      "forge-credentials-available",
    ],
  );
  const signal = new AbortController().signal;
  for (const precondition of composition.preconditions)
    assert.equal(await precondition.check(signal), true, precondition.name);
});

test("a repository's forge is selected by the host its own address names", (t) => {
  const forges = composeFinalizerRuntime(settings(t)).service().forges;
  const binding = forges.bindingOf(forgeRepository);
  assert.deepEqual(binding, {
    forge: "forge-alpha",
    credential: "forge-alpha-proposals",
  });
  assert.equal(
    typeof forges.selector.select(asForgeBindingId("forge-alpha"))?.create,
    "function",
  );
  assert.equal(
    forges.selector.select(asForgeBindingId("forge-beta")),
    undefined,
  );
  assert.equal(
    forges.bindingOf(
      asRepositoryId("https://elsewhere.invalid/acme/atlas.git"),
    ),
    undefined,
    "a repository on a host this deployment binds no forge for opens no proposal",
  );
  assert.equal(forges.bindingOf(asRepositoryId("acme/atlas")), undefined);
});

test("a deployment binding no forge composes one that opens no change proposal", (t) => {
  const composition = composeFinalizerRuntime(settings(t, false));
  assert.ok(
    composition.preconditions.some(
      (precondition) => precondition.name === "forge-credentials-available",
    ),
    "the precondition stands over the nothing it has to check",
  );
  const forges = composition.service().forges;
  assert.equal(forges.bindingOf(forgeRepository), undefined);
  assert.equal(
    forges.selector.select(asForgeBindingId("forge-alpha")),
    undefined,
  );
});

/**
 * A binding is what an adapter is built from here, and the adapter is what
 * holds that forge's credential. A binding naming the repositories and not the
 * API is refused before one is composed, an adapter defaulting the second host
 * being one that sends the credential to a forge nobody named.
 */
test("a forge binding naming no API host composes no adapter at all", (t) => {
  assert.throws(
    () => settings(t, true, { apiHost: undefined }),
    /CHUG_FINALIZER_FORGE_BINDINGS/u,
  );
});

test("the composed service promotes through the port and stores under the named root", (t) => {
  const parsed = settings(t);
  const service = composeFinalizerRuntime(parsed).service();
  assert.equal(service.artifactRoot, parsed.artifactRoot);
  assert.equal(typeof service.git.promoteCandidate, "function");
});

test("composing yields no git port until one is asked for", (t) => {
  const parsed = settings(t);
  const composition = composeFinalizerRuntime({
    ...parsed,
    git: { ...parsed.git, environment: { PATH: parsed.artifactRoot } },
  });
  assert.throws(() => composition.service());
});
