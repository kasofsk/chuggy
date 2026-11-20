import assert from "node:assert/strict";
import { test } from "node:test";

import { workerHeldCredentialBundleSchema } from "../../src/contract/workerPlane.ts";
import {
  awsCredentialBundle,
  awsTokenTarget,
  type AwsConnector,
} from "../../src/interpreter/awsConnectorAdaptor.ts";
import {
  jobIdentityClaims,
  type JobIdentitySubject,
} from "../../src/interpreter/jobIdentityToken.ts";

const roleArn = "arn:aws:iam::123456789012:role/deploy";

function awsConnector(sessionTags?: boolean): AwsConnector {
  return {
    name: "deploy",
    kind: "Aws",
    settings:
      sessionTags === undefined ? { roleArn } : { roleArn, sessionTags },
  };
}

const work: JobIdentitySubject = {
  tenant: "acme",
  project: "widgets",
  workload: "build",
  task: { taskKind: "Work" },
  ticket: 42,
};

const evaluation: JobIdentitySubject = {
  ...work,
  task: { taskKind: "Evaluation", evaluator: 7 },
  repository: "acme/widgets",
};

function claimsOf(
  connector: AwsConnector,
  subject: JobIdentitySubject,
): Readonly<Record<string, unknown>> {
  const target = awsTokenTarget(connector, subject);
  assert.equal(target.result, "Target");
  return target.target.claims;
}

const tag = (key: string) =>
  `https://aws.amazon.com/tags/principal_tags/${key}`;

test("a work task's session tags are its tenant, project, workload, task kind and ticket", () => {
  assert.deepEqual(claimsOf(awsConnector(true), work), {
    [tag("tenant")]: "acme",
    [tag("project")]: "widgets",
    [tag("workload")]: "build",
    [tag("task_kind")]: "work",
    [tag("ticket")]: "42",
  });
});

test("an evaluation's session tags add its evaluator and repository", () => {
  assert.deepEqual(claimsOf(awsConnector(true), evaluation), {
    [tag("tenant")]: "acme",
    [tag("project")]: "widgets",
    [tag("workload")]: "build",
    [tag("task_kind")]: "evaluation",
    [tag("evaluator")]: "7",
    [tag("ticket")]: "42",
    [tag("repository")]: "acme/widgets",
  });
});

test("each session tag holds the core's claim of its key, as a string", () => {
  for (const subject of [work, evaluation]) {
    const target = awsTokenTarget(awsConnector(true), subject);
    assert.equal(target.result, "Target");
    const built = jobIdentityClaims(
      subject,
      "https://issuer.example",
      target.target,
      1_800_000_000_000,
    );
    assert.equal(built.result, "Claims");
    for (const [claim, value] of Object.entries(target.target.claims)) {
      const key = claim.slice(tag("").length);
      const coreClaim: unknown = built.claims[key];
      assert.ok(typeof coreClaim === "string" || typeof coreClaim === "number");
      assert.equal(value, String(coreClaim));
      assert.equal(built.claims[claim], value);
    }
  }
});

test("with session tags off or absent the shape has no further claims", () => {
  assert.deepEqual(claimsOf(awsConnector(false), evaluation), {});
  assert.deepEqual(claimsOf(awsConnector(), evaluation), {});
});

test("a tag value IAM would not take refuses the shape rather than being dropped or altered", () => {
  const refusalOf = (repository: string) =>
    awsTokenTarget(awsConnector(true), { ...evaluation, repository });
  assert.deepEqual(refusalOf("a".repeat(257)), {
    result: "Refused",
    refusal: { reason: "SessionTagTooLong", key: "repository" },
  });
  assert.deepEqual(refusalOf("acme/widgets#main"), {
    result: "Refused",
    refusal: { reason: "SessionTagCharacterRefused", key: "repository" },
  });
  assert.deepEqual(refusalOf("aws:widgets"), {
    result: "Refused",
    refusal: { reason: "SessionTagPrefixReserved", key: "repository" },
  });
  assert.equal(refusalOf("a".repeat(256)).result, "Target");
  assert.equal(refusalOf("Ünïcode 9 _.:/=+-@").result, "Target");
  assert.equal(
    awsTokenTarget(awsConnector(false), {
      ...evaluation,
      repository: "acme/widgets#main",
    }).result,
    "Target",
  );
});

test("an AWS bundle points the SDK at the token file and the role", () => {
  const bundle = awsCredentialBundle(awsConnector(true), "t.o.k", 1_000);
  assert.deepEqual(bundle, {
    credential: "chuggy.connector.deploy",
    files: [{ file: "token", content: { kind: "Secret", secret: "t.o.k" } }],
    variables: [
      { kind: "Path", variable: "AWS_WEB_IDENTITY_TOKEN_FILE", file: "token" },
      { kind: "Value", variable: "AWS_ROLE_ARN", value: roleArn },
    ],
    expiresAtMs: 1_000,
  });
  assert.ok(workerHeldCredentialBundleSchema.safeParse(bundle).success);
});
