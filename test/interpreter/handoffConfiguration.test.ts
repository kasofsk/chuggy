import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalConfigurationOf } from "../../src/interpreter/authoring.ts";
import {
  authoredHandoffConfigurationReadiness,
  asHandoffRequestDigest,
  pinnedHandoffConfigurationReadiness,
  promoteForHandoffConfiguration,
  publishHandoffConfiguration,
} from "../../src/interpreter/handoffConfiguration.ts";

const commit = "a".repeat(40);
const pin = { revision: "revision-17", digest: "b".repeat(64) };

function document(overrides: Record<string, unknown> = {}): unknown {
  return {
    finalizationHandoff: {
      version: 1,
      mode: "DirectCommit",
      repositories: {
        work: {
          repository: "ledger-engine",
          targetRef: "refs/heads/release",
        },
        handoff: {
          repository: "platform-desires",
          targetRef: "refs/heads/team-orange",
        },
      },
      credentials: {
        work: "ledger-release-writer",
        handoff: "platform-request-writer",
      },
      renderer: {
        identity: "ContainerBuildRequest",
        version: 1,
        parameters: {
          targetImageRepository: "registry.example/ledger",
          builderProfile: "rootless-multiarch",
          platforms: ["linux/amd64", "linux/arm64"],
        },
      },
      destinationPath: "builds/ledger/request.json",
      outputBytesMax: 4096,
      ...overrides,
    },
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ready(overrides: Record<string, unknown> = {}) {
  const parsed = pinnedHandoffConfigurationReadiness(
    canonicalConfigurationOf(document(overrides)),
    pin,
  );
  if (parsed.readiness === "Incomplete") throw new Error(parsed.fault);
  return parsed.configuration;
}

test("independent repository roles produce only pinned direct request configurations", () => {
  const pinned = ready();
  const promotion = promoteForHandoffConfiguration(pinned);
  const publication = publishHandoffConfiguration(pinned, commit, digest);

  assert.deepEqual(promotion, {
    kind: "PromoteForHandoff",
    pin,
    repository: {
      repository: "ledger-engine",
      targetRef: "refs/heads/release",
      credential: "ledger-release-writer",
    },
  });
  assert.equal(publication.repository.repository, "platform-desires");
  assert.equal(publication.repository.credential, "platform-request-writer");
  assert.equal(publication.acceptedWorkCommit, commit);
  assert.match(publication.output, new RegExp(commit, "u"));
  assert.doesNotMatch(publication.output, /credential|release-writer/u);
});

test("rendering the same pin and accepted commit is byte and identity stable", () => {
  const pinned = ready();
  const first = publishHandoffConfiguration(pinned, commit, digest);
  const second = publishHandoffConfiguration(pinned, commit, digest);
  assert.equal(first.output, second.output);
  assert.equal(first.destinationPath, second.destinationPath);
  assert.equal(first.requestDigest, second.requestDigest);
});

test("every publication-affecting field changes the request identity", () => {
  const baseline = publishHandoffConfiguration(ready(), commit, digest);
  const variants = [
    ready({ destinationPath: "builds/ledger/other.json" }),
    ready({ outputBytesMax: 8192 }),
    ready({
      repositories: {
        work: { repository: "ledger-engine", targetRef: "refs/heads/release" },
        handoff: {
          repository: "another-platform",
          targetRef: "refs/heads/team-orange",
        },
      },
    }),
    ready({
      repositories: {
        work: { repository: "ledger-engine", targetRef: "refs/heads/release" },
        handoff: {
          repository: "platform-desires",
          targetRef: "refs/heads/team-blue",
        },
      },
    }),
    ready({
      renderer: {
        identity: "ContainerBuildRequest",
        version: 1,
        parameters: {
          targetImageRepository: "registry.example/ledger-next",
          builderProfile: "rootless-multiarch",
          platforms: ["linux/amd64", "linux/arm64"],
        },
      },
    }),
  ];
  for (const variant of variants) {
    assert.notEqual(
      publishHandoffConfiguration(variant, commit, digest).requestDigest,
      baseline.requestDigest,
    );
  }
  assert.notEqual(
    publishHandoffConfiguration(ready(), "c".repeat(40), digest).requestDigest,
    baseline.requestDigest,
  );
});

test("credentials are independently selected and excluded from output and identity", () => {
  const original = ready();
  const changed = ready({
    credentials: { work: "other-work-writer", handoff: "other-handoff-writer" },
  });
  const before = publishHandoffConfiguration(original, commit, digest);
  const after = publishHandoffConfiguration(changed, commit, digest);
  assert.notEqual(original.work.credential, changed.work.credential);
  assert.notEqual(original.handoff.credential, changed.handoff.credential);
  assert.equal(before.output, after.output);
  assert.equal(before.requestDigest, after.requestDigest);
});

test("unsupported identities, modes, refs, paths, roles, and bounds are refused", () => {
  const cases: readonly [unknown, string][] = [
    [document({ mode: "Proposal" }), "HandoffModeUnsupported"],
    [
      document({ renderer: { identity: "Shell", version: 1, parameters: {} } }),
      "RendererUnknown",
    ],
    [
      document({
        repositories: {
          work: { repository: "same", targetRef: "refs/heads/main" },
          handoff: { repository: "same", targetRef: "refs/heads/release" },
        },
      }),
      "RepositoryRoleDuplicated",
    ],
    [
      document({
        repositories: {
          work: { repository: "one", targetRef: "main" },
          handoff: { repository: "two", targetRef: "refs/heads/release" },
        },
      }),
      "RepositoryRoleInvalid",
    ],
    [
      document({ destinationPath: "../request.json" }),
      "DestinationPathInvalid",
    ],
    [document({ destinationPath: "/request.json" }), "DestinationPathInvalid"],
    [document({ outputBytesMax: 999_999 }), "OutputBoundInvalid"],
  ];
  for (const [value, fault] of cases) {
    assert.deepEqual(
      pinnedHandoffConfigurationReadiness(canonicalConfigurationOf(value), pin),
      { readiness: "Incomplete", fault },
    );
  }
});

test("authored validation refuses an unknown renderer before a revision is pinned", () => {
  assert.deepEqual(
    authoredHandoffConfigurationReadiness(
      document({
        renderer: { identity: "DownloadedPlugin", version: 7, parameters: {} },
      }),
    ),
    { readiness: "Incomplete", fault: "RendererUnknown" },
  );
});

test("the pinned output bound is enforced against encoded bytes", () => {
  const pinned = ready({ outputBytesMax: 1 });
  assert.throws(
    () => publishHandoffConfiguration(pinned, commit, digest),
    /output exceeds/u,
  );
});

test("configuration pins require bounded revisions and fixed-width digests", () => {
  for (const malformed of [
    { revision: "", digest: "b".repeat(64) },
    { revision: "r".repeat(257), digest: "b".repeat(64) },
    { revision: "revision", digest: "" },
    { revision: "revision", digest: "B".repeat(64) },
    { revision: "revision", digest: "b".repeat(63) },
  ]) {
    assert.deepEqual(
      pinnedHandoffConfigurationReadiness(
        canonicalConfigurationOf(document()),
        malformed,
      ),
      { readiness: "Incomplete", fault: "ConfigurationPinInvalid" },
    );
  }
});

test("request digests refuse malformed and input-independent hash results", () => {
  for (const malformed of ["", "f".repeat(63), "F".repeat(64), "not-hex"]) {
    assert.throws(() => asHandoffRequestDigest(malformed), RangeError);
    assert.throws(
      () => publishHandoffConfiguration(ready(), commit, () => malformed),
      RangeError,
    );
  }
  assert.throws(
    () => publishHandoffConfiguration(ready(), commit, () => "d".repeat(64)),
    /does not depend on its input/u,
  );
});
