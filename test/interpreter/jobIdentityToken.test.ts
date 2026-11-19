import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isJobIdentitySafeName,
  jobIdentityClaims,
  jobIdentityCoreClaims,
  jobIdentityDiscovery,
  jobIdentityIssuer,
  jobIdentityIssuerCharsMax,
  jobIdentityLifetimeSecs,
  type JobIdentitySubject,
  type JobIdentityTarget,
} from "../../src/interpreter/jobIdentityToken.ts";

const base = "https://issuer.example";
const issuedAtEpochMs = 1_800_000_000_500;
const issuedAtEpochSecs = 1_800_000_000;

const work: JobIdentitySubject = {
  tenant: "acme",
  project: "widgets",
  workload: "build",
  task: { taskKind: "Work" },
  ticket: 42,
};

const plain: JobIdentityTarget = {
  audience: "plain-audience",
  subjectBytesMax: 128,
  claims: {},
};

function claimsOf(
  subject: JobIdentitySubject,
  target: JobIdentityTarget = plain,
): Readonly<Record<string, unknown>> {
  const built = jobIdentityClaims(subject, base, target, issuedAtEpochMs);
  assert.equal(built.result, "Claims");
  return built.claims;
}

function refusalOf(
  subject: JobIdentitySubject,
  target: JobIdentityTarget = plain,
  issuerBaseUrl: string = base,
): unknown {
  const built = jobIdentityClaims(
    subject,
    issuerBaseUrl,
    target,
    issuedAtEpochMs,
  );
  assert.equal(built.result, "Refused");
  return built.refusal;
}

test("a work task's claims are exactly the core's, without an evaluator or a repository", () => {
  assert.deepEqual(claimsOf(work), {
    iss: "https://issuer.example/acme",
    sub: "project:widgets:workload:build:task:work",
    aud: "plain-audience",
    iat: issuedAtEpochSecs,
    exp: issuedAtEpochSecs + jobIdentityLifetimeSecs,
    tenant: "acme",
    project: "widgets",
    workload: "build",
    task_kind: "work",
    ticket: 42,
  });
});

test("an evaluation's claims carry its evaluator, and a repository where one is given", () => {
  const claims = claimsOf({
    ...work,
    task: { taskKind: "Evaluation", evaluator: 3 },
    repository: "acme/widgets",
  });
  assert.deepEqual(claims, {
    iss: "https://issuer.example/acme",
    sub: "project:widgets:workload:build:task:evaluation",
    aud: "plain-audience",
    iat: issuedAtEpochSecs,
    exp: issuedAtEpochSecs + jobIdentityLifetimeSecs,
    tenant: "acme",
    project: "widgets",
    workload: "build",
    task_kind: "evaluation",
    evaluator: 3,
    ticket: 42,
    repository: "acme/widgets",
  });
  for (const unset of ["jti", "azp", "nbf"])
    assert.ok(!Object.hasOwn(claims, unset), unset);
});

test("two targets' tokens differ in exactly the audience and the claims each adds", () => {
  const first = claimsOf(work, {
    audience: "first",
    subjectBytesMax: 64,
    claims: { first_only: "a" },
  });
  const second = claimsOf(work, {
    audience: "second",
    subjectBytesMax: 256,
    claims: { second_only: { nested: [1, true, null] } },
  });
  const { aud: firstAudience, first_only: firstAdded, ...firstRest } = first;
  const {
    aud: secondAudience,
    second_only: secondAdded,
    ...secondRest
  } = second;
  assert.deepEqual(firstRest, secondRest);
  assert.equal(firstAudience, "first");
  assert.equal(secondAudience, "second");
  assert.equal(firstAdded, "a");
  assert.deepEqual(secondAdded, { nested: [1, true, null] });
});

test("the subject bound is the target's: one target takes a subject the other refuses", () => {
  const sub = "project:widgets:workload:build:task:work";
  const bytes = new TextEncoder().encode(sub).byteLength;
  claimsOf(work, { ...plain, subjectBytesMax: bytes });
  assert.deepEqual(refusalOf(work, { ...plain, subjectBytesMax: bytes - 1 }), {
    reason: "SubjectTooLong",
  });
});

test("the subject bound counts UTF-8 bytes, not characters", () => {
  const sub = "project:widgets:workload:build:task:work";
  assert.deepEqual(
    refusalOf(work, { ...plain, subjectBytesMax: [...sub].length - 1 }),
    { reason: "SubjectTooLong" },
  );
});

test("an unsafe tenant, project or workload is refused, each as its own reason", () => {
  assert.deepEqual(refusalOf({ ...work, tenant: "ac/me" }), {
    reason: "TenantUnsafe",
  });
  assert.deepEqual(refusalOf({ ...work, project: "wid:gets" }), {
    reason: "ProjectUnsafe",
  });
  assert.deepEqual(refusalOf({ ...work, workload: "" }), {
    reason: "WorkloadUnsafe",
  });
});

test("an issuer past its bound is refused", () => {
  const tenant = "t";
  const longBase = `https://${"a".repeat(jobIdentityIssuerCharsMax - "https:///t".length + 1)}`;
  assert.deepEqual(refusalOf({ ...work, tenant }, plain, longBase), {
    reason: "IssuerTooLong",
  });
  const fitting = longBase.slice(0, -1);
  const built = jobIdentityIssuer(fitting, tenant);
  assert.equal(built.result, "Issuer");
  assert.equal([...built.issuer].length, jobIdentityIssuerCharsMax);
});

test("a target naming a claim the core sets is refused, naming the claim", () => {
  assert.deepEqual(refusalOf(work, { ...plain, claims: { sub: "other" } }), {
    reason: "ClaimReserved",
    claim: "sub",
  });
  assert.deepEqual(refusalOf(work, { ...plain, claims: { ticket: 1 } }), {
    reason: "ClaimReserved",
    claim: "ticket",
  });
  for (const claim of jobIdentityCoreClaims)
    assert.deepEqual(refusalOf(work, { ...plain, claims: { [claim]: 0 } }), {
      reason: "ClaimReserved",
      claim,
    });
});

test("a target's `__proto__` claim is a claim and not a prototype", () => {
  const claims = claimsOf(work, {
    ...plain,
    claims: JSON.parse(
      '{"__proto__": {"polluted": true}}',
    ) as JobIdentityTarget["claims"],
  });
  assert.equal(Object.getPrototypeOf(claims), Object.prototype);
  assert.ok(Object.hasOwn(claims, "__proto__"));
});

test("a safe name is non-empty and holds only letters, digits, dots, underscores and dashes", () => {
  for (const name of ["a", "A-z_0.9", "..."])
    assert.ok(isJobIdentitySafeName(name), name);
  for (const name of ["", "a b", "a:b", "a/b", "é", "a\n"])
    assert.ok(!isJobIdentitySafeName(name), JSON.stringify(name));
});

test("the issuer is the base, a slash and the tenant", () => {
  assert.deepEqual(jobIdentityIssuer(base, "acme"), {
    result: "Issuer",
    issuer: "https://issuer.example/acme",
  });
});

test("the discovery document's issuer is byte-equal to a token's `iss` for the same tenant and base", () => {
  const built = jobIdentityIssuer(base, work.tenant);
  assert.equal(built.result, "Issuer");
  const discovery = jobIdentityDiscovery(built.issuer);
  assert.equal(discovery.issuer, claimsOf(work)["iss"]);
  assert.deepEqual(discovery, {
    issuer: "https://issuer.example/acme",
    jwks_uri: "https://issuer.example/acme/jwks",
    response_types_supported: ["id_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    claims_supported: [...jobIdentityCoreClaims],
  });
});

test("claims_supported names every claim the core sets", () => {
  const built = jobIdentityIssuer(base, work.tenant);
  assert.equal(built.result, "Issuer");
  const fullest = claimsOf({
    ...work,
    task: { taskKind: "Evaluation", evaluator: 0 },
    repository: "acme/widgets",
  });
  assert.deepEqual(
    [...jobIdentityDiscovery(built.issuer).claims_supported].sort(),
    Object.keys(fullest).sort(),
  );
});
