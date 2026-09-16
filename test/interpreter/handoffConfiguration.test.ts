import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalConfigurationOf } from "../../src/interpreter/authoring.ts";
import {
  authoredHandoffConfigurationReadiness,
  asHandoffRequestDigest,
  handoffWitnessProvenWithinSecsMax,
  pinnedHandoffConfigurationReadiness,
  promoteForHandoffConfiguration,
  publishHandoffConfiguration,
} from "../../src/interpreter/handoffConfiguration.ts";
import { handoffFixture } from "./handoffFixture.ts";

const commit = "a".repeat(40);

function document(overrides: Record<string, unknown> = {}): unknown {
  return { finalizationHandoff: handoffFixture(overrides) };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ready(overrides: Record<string, unknown> = {}) {
  const canonical = canonicalConfigurationOf(document(overrides));
  const pin = { revision: "revision-17", digest: digest(canonical) };
  const parsed = pinnedHandoffConfigurationReadiness(canonical, pin, digest);
  if (parsed.readiness === "Incomplete") throw new Error(parsed.fault);
  return parsed.configuration;
}

/**
 * The fixture's renderer with one parameter varied, so a case never drops the
 * rest. A parameter varied to `undefined` is left out, which is what a
 * configuration omitting it looks like.
 */
function parametersWith(
  varied: Record<string, unknown>,
): Record<string, unknown> {
  const renderer = handoffFixture()["renderer"] as Record<string, unknown>;
  const parameters = {
    ...(renderer["parameters"] as Record<string, unknown>),
    ...varied,
  };
  return {
    renderer: {
      ...renderer,
      parameters: Object.fromEntries(
        Object.entries(parameters).filter(([, value]) => value !== undefined),
      ),
    },
  };
}

test("independent repository roles produce only pinned direct request configurations", () => {
  const pinned = ready();
  const pin = pinned.pin;
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
    ready(parametersWith({ targetImageRepository: "registry.example/next" })),
    ready(parametersWith({ sourceRepositoryId: "ledger-next" })),
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
    [
      document(parametersWith({ sourceRepositoryId: undefined })),
      "RendererParametersInvalid",
    ],
  ];
  for (const [value, fault] of cases) {
    assert.deepEqual(
      pinnedHandoffConfigurationReadiness(
        canonicalConfigurationOf(value),
        {
          revision: "revision-17",
          digest: digest(canonicalConfigurationOf(value)),
        },
        digest,
      ),
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
        digest,
      ),
      { readiness: "Incomplete", fault: "ConfigurationPinInvalid" },
    );
  }
});

test("configuration pins identify the canonical bytes they accompany", () => {
  const canonical = canonicalConfigurationOf(document());
  assert.deepEqual(
    pinnedHandoffConfigurationReadiness(
      canonical,
      { revision: "revision-17", digest: digest(`${canonical} `) },
      digest,
    ),
    { readiness: "Incomplete", fault: "ConfigurationPinInvalid" },
  );
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

/** The templated paths the publication renders, which is what the effort's two sides agreed on. */
const templated = {
  destinationPath:
    "requests/{sourceRepositoryId}/{sourceCommit}/{requestDigest}.json",
  publicationWitness: {
    pathTemplate:
      "results/{sourceRepositoryId}/{sourceCommit}/request-{requestDigest}.json",
    provenWithinSecs: 21_600,
  },
};

test("a path template renders every variable it names, and the witness renders over the same values", () => {
  const publication = publishHandoffConfiguration(
    ready(templated),
    commit,
    digest,
  );
  const rendered = publication.requestDigest;
  assert.equal(
    publication.destinationPath,
    `requests/ledger/${commit}/${rendered}.json`,
  );
  assert.deepEqual(publication.publicationWitness, {
    path: `results/ledger/${commit}/request-${rendered}.json`,
    provenWithinSecs: 21_600,
  });
});

test("a template with no variable renders itself, and a configuration declaring no witness carries none", () => {
  const publication = publishHandoffConfiguration(ready(), commit, digest);
  assert.equal(publication.destinationPath, "builds/ledger/request.json");
  assert.equal(publication.publicationWitness, undefined);
});

test("the witness is no part of the request identity, so a deadline moves no published bytes", () => {
  const baseline = publishHandoffConfiguration(
    ready(templated),
    commit,
    digest,
  );
  const longer = publishHandoffConfiguration(
    ready({
      ...templated,
      publicationWitness: {
        ...templated.publicationWitness,
        provenWithinSecs: 43_200,
      },
    }),
    commit,
    digest,
  );
  assert.equal(longer.requestDigest, baseline.requestDigest);
  assert.equal(longer.destinationPath, baseline.destinationPath);
  assert.equal(longer.publicationWitness?.provenWithinSecs, 43_200);
});

test("a variable nothing renders, an unclosed one, and one escaping the repository are refused", () => {
  const cases: readonly [Record<string, unknown>, string][] = [
    [
      { destinationPath: "requests/{sourceBranch}.json" },
      "DestinationPathInvalid",
    ],
    [
      { destinationPath: "requests/{sourceCommit.json" },
      "DestinationPathInvalid",
    ],
    [
      { destinationPath: "requests/}sourceCommit{.json" },
      "DestinationPathInvalid",
    ],
    [
      {
        ...parametersWith({ sourceRepositoryId: "../.." }),
        destinationPath: "requests/{sourceRepositoryId}/one.json",
      },
      "DestinationPathInvalid",
    ],
    [
      { destinationPath: `${"x".repeat(500)}/{requestDigest}.json` },
      "DestinationPathInvalid",
    ],
    [
      {
        ...templated,
        publicationWitness: {
          pathTemplate: "r/{nothing}.json",
          provenWithinSecs: 60,
        },
      },
      "PublicationWitnessInvalid",
    ],
    [
      {
        ...templated,
        publicationWitness: { pathTemplate: "r.json", provenWithinSecs: 0 },
      },
      "PublicationWitnessInvalid",
    ],
    [
      {
        ...templated,
        publicationWitness: {
          pathTemplate: "r.json",
          provenWithinSecs: handoffWitnessProvenWithinSecsMax + 1,
        },
      },
      "PublicationWitnessInvalid",
    ],
    [
      { ...templated, publicationWitness: "results/r.json" },
      "PublicationWitnessInvalid",
    ],
  ];
  for (const [overrides, fault] of cases) {
    const canonical = canonicalConfigurationOf(document(overrides));
    assert.deepEqual(
      pinnedHandoffConfigurationReadiness(
        canonical,
        { revision: "revision-17", digest: digest(canonical) },
        digest,
      ),
      { readiness: "Incomplete", fault },
      JSON.stringify(overrides),
    );
  }
});
