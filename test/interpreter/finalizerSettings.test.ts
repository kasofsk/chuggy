/**
 * The finalizer's configuration parse: what a deployment must name, what it may
 * leave to the layer that owns the default, and what it may not say at all.
 *
 * THE NEGATIVE SPACE IS THE POINT HERE. A bound left unnamed must be absent
 * rather than guessed, a variable outside the git allowlist must not reach a git
 * child — the database URL above all — and a credential source must be a path
 * and never a value.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { finalizerDefaults } from "../../src/interpreter/finalizer.ts";
import {
  finalizerGitEnvironmentNames,
  finalizerRuntimeDefaults,
  finalizerSettingsOf,
  repositoryCredentialFilesMax,
  type FinalizerEnvironment,
} from "../../src/interpreter/finalizerSettings.ts";

const credentialSources = JSON.stringify([
  { repository: "https://example.invalid/one.git", path: "/run/secrets/one" },
]);

const complete: FinalizerEnvironment = {
  CHUG_FINALIZER_DATABASE_URL: "postgres://finalizer@localhost/chuggy",
  CHUG_FINALIZER_OWNER: "finalizer-1",
  CHUG_FINALIZER_RECOVERY_EPOCH: "epoch-3",
  CHUG_FINALIZER_ARTIFACT_ROOT: "/var/lib/chuggy/artifacts",
  CHUG_FINALIZER_GIT_SCRATCH_ROOT: "/var/lib/chuggy/scratch",
  CHUG_FINALIZER_GIT_COMMIT_NAME: "chuggy",
  CHUG_FINALIZER_GIT_COMMIT_EMAIL: "chuggy@example.invalid",
  CHUG_FINALIZER_CREDENTIAL_SOURCES: credentialSources,
  PATH: "/usr/bin",
};

function without(name: string): FinalizerEnvironment {
  const { [name]: dropped, ...rest } = complete;
  assert.ok(dropped !== undefined);
  return rest;
}

test("a complete environment parses into plain data the composition takes", () => {
  const settings = finalizerSettingsOf(complete);
  assert.equal(settings.databaseUrl, complete["CHUG_FINALIZER_DATABASE_URL"]);
  assert.equal(settings.owner, "finalizer-1");
  assert.equal(settings.recoveryEpoch, "epoch-3");
  assert.equal(settings.artifactRoot, "/var/lib/chuggy/artifacts");
  assert.equal(settings.git.scratchDirectory, "/var/lib/chuggy/scratch");
  assert.equal(settings.git.commitName, "chuggy");
  assert.equal(settings.git.commitEmail, "chuggy@example.invalid");
  assert.deepEqual(settings.credentials, [
    { repository: "https://example.invalid/one.git", path: "/run/secrets/one" },
  ]);
  assert.deepEqual(settings.runtime, finalizerRuntimeDefaults);
  assert.deepEqual(settings.finalizer, finalizerDefaults);
});

test("every required variable is named when it is missing", () => {
  for (const name of Object.keys(complete).filter((key) => key !== "PATH")) {
    assert.throws(
      () => finalizerSettingsOf(without(name)),
      new RegExp(`${name} is required`, "u"),
      name,
    );
  }
});

test("a bound the git adapter owns a default for stays absent unless named", () => {
  const parsed = finalizerSettingsOf(complete);
  assert.equal(parsed.git.credentialUsername, undefined);
  assert.equal(parsed.git.localTimeoutSecsMax, undefined);
  assert.equal(parsed.git.remoteTimeoutSecsMax, undefined);
  assert.equal(parsed.git.promotionTimeoutSecsMax, undefined);
  assert.equal(parsed.credentialBytesMax, undefined);
  const named = finalizerSettingsOf({
    ...complete,
    CHUG_FINALIZER_GIT_CREDENTIAL_USERNAME: "x-access-token",
    CHUG_FINALIZER_GIT_LOCAL_TIMEOUT_SECS_MAX: "45",
    CHUG_FINALIZER_GIT_REMOTE_TIMEOUT_SECS_MAX: "120",
    CHUG_FINALIZER_GIT_PROMOTION_TIMEOUT_SECS_MAX: "90",
    CHUG_FINALIZER_CREDENTIAL_BYTES_MAX: "512",
  });
  assert.equal(named.git.credentialUsername, "x-access-token");
  assert.equal(named.git.localTimeoutSecsMax, 45);
  assert.equal(named.git.remoteTimeoutSecsMax, 120);
  assert.equal(named.git.promotionTimeoutSecsMax, 90);
  assert.equal(named.credentialBytesMax, 512);
});

test("every pass and pace bound a deployment names reaches the parsed configuration", () => {
  const settings = finalizerSettingsOf({
    ...complete,
    CHUG_FINALIZER_IDLE_INTERVAL_MS: "250",
    CHUG_FINALIZER_SHUTDOWN_DRAIN_MS: "2000",
    CHUG_FINALIZER_REQUEST_CLAIM_LEASE_SECS: "60",
    CHUG_FINALIZER_REQUESTS_PER_PASS_MAX: "4",
    CHUG_FINALIZER_PREPARATION_RESTARTS_MAX: "2",
    CHUG_FINALIZER_PREPARATIONS_PER_PASS_MAX: "3",
    CHUG_FINALIZER_PROMOTIONS_PER_PASS_MAX: "5",
    CHUG_FINALIZER_RECONCILIATIONS_PER_PASS_MAX: "6",
    CHUG_FINALIZER_HELD_PERMITS_PER_PASS_MAX: "7",
  });
  assert.deepEqual(settings.runtime, {
    idleIntervalMilliseconds: 250,
    shutdownDrainMilliseconds: 2_000,
  });
  assert.deepEqual(settings.finalizer, {
    requestClaimLeaseSecs: 60,
    requestsPerPassMax: 4,
    preparationRestartsMax: 2,
    preparationsPerPassMax: 3,
    promotionsPerPassMax: 5,
    reconciliationsPerPassMax: 6,
    heldPermitsPerPassMax: 7,
  });
});

test("a bound that is not a positive integer is refused rather than rounded", () => {
  for (const value of ["0", "-1", "1.5", "eight", " 4", ""]) {
    assert.throws(
      () =>
        finalizerSettingsOf({
          ...complete,
          CHUG_FINALIZER_REQUESTS_PER_PASS_MAX: value,
        }),
      /must be a positive integer/u,
      value,
    );
  }
});

test("a git child inherits the allowlist and never this process's own environment", () => {
  const settings = finalizerSettingsOf({
    ...complete,
    HOME: "/home/chuggy",
    CHUG_FINALIZER_SECRET_ADJACENT: "not-for-a-child",
  });
  assert.deepEqual(settings.git.environment, {
    HOME: "/home/chuggy",
    PATH: "/usr/bin",
  });
  for (const name of Object.keys(settings.git.environment))
    assert.ok(finalizerGitEnvironmentNames.includes(name), name);
});

test("a credential source is a repository and a path, and nothing else is one", () => {
  for (const sources of [
    "{}",
    "[]",
    '[{"repository":"one"}]',
    '[{"path":"/run/secrets/one"}]',
    '[{"repository":"one","path":""}]',
    '[{"repository":"one","path":"/a"},{"repository":"one","path":"/b"}]',
    JSON.stringify(
      Array.from({ length: repositoryCredentialFilesMax + 1 }, (_, index) => ({
        repository: `repository-${String(index)}`,
        path: `/run/secrets/${String(index)}`,
      })),
    ),
  ]) {
    assert.throws(
      () =>
        finalizerSettingsOf({
          ...complete,
          CHUG_FINALIZER_CREDENTIAL_SOURCES: sources,
        }),
      /CHUG_FINALIZER_CREDENTIAL_SOURCES/u,
      sources.slice(0, 40),
    );
  }
});

test("credential aliases are isolated by repository", () => {
  const settings = finalizerSettingsOf({
    ...complete,
    CHUG_FINALIZER_CREDENTIAL_SOURCES: JSON.stringify([
      { repository: "one", credentialReference: "writer", path: "/one" },
      { repository: "two", credentialReference: "writer", path: "/two" },
    ]),
  });
  assert.equal(settings.credentials.length, 2);
  assert.throws(
    () =>
      finalizerSettingsOf({
        ...complete,
        CHUG_FINALIZER_CREDENTIAL_SOURCES: JSON.stringify([
          { repository: "one", credentialReference: "writer", path: "/one" },
          { repository: "one", credentialReference: "writer", path: "/two" },
        ]),
      }),
    /names a credential twice/u,
  );
});
