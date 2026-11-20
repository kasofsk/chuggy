/**
 * A connector's credential: a fresh token for the requester's own project's
 * connector, shaped and delivered by that connector's adaptor alone, and every
 * refusal or outage answered as one.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { createLocalJWKSet, jwtVerify } from "jose";

import { jobIdentitySigner } from "../../src/adapters/crypto/jobIdentitySigner.ts";
import type { Connector } from "../../src/contract/connectors.ts";
import { connectorCredentialOf } from "../../src/contract/workerEnvironment.ts";
import { workerHeldCredentialBundleSchema } from "../../src/contract/workerPlane.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import {
  connectorAdaptor,
  type ConnectorAdaptor,
} from "../../src/interpreter/connectorAdaptor.ts";
import {
  connectorCredentialIssuer,
  type ConnectorCredentialOptions,
} from "../../src/interpreter/connectorCredential.ts";
import type {
  CredentialIssued,
  CredentialRequester,
} from "../../src/interpreter/credentialIssuers.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import {
  jobIdentityClaims,
  type JobIdentitySigner,
  type JobIdentitySubject,
} from "../../src/interpreter/jobIdentityToken.ts";
import type { ProjectConnectorRead } from "../../src/interpreter/projectConnectors.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";

const issuerBaseUrl = "https://identity.example/chuggy";
const issuedAtMs = 1_800_000_000_000;

const partition: Partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("widgets"),
};

const requester: CredentialRequester = {
  partition,
  ticket: asTicketId(42),
  task: asTaskId(1),
  repository: asRepositoryId("https://github.com/acme/widgets.git"),
  taskKind: "Work",
  workload: "build",
};

const subject: JobIdentitySubject = {
  tenant: "acme",
  project: "widgets",
  workload: "build",
  task: { taskKind: "Work" },
  ticket: 42,
  repository: "https://github.com/acme/widgets.git",
};

const connectors: readonly Connector[] = [
  {
    name: "deploy",
    kind: "Aws",
    settings: { roleArn: "arn:aws:iam::123456789012:role/deploy" },
  },
  {
    name: "gcp-prod",
    kind: "Gcp",
    settings: { projectNumber: "123456", pool: "chuggy", provider: "acme" },
  },
  {
    name: "azure",
    kind: "Azure",
    settings: { tenantId: "tenant-1", clientId: "client-1" },
  },
  {
    name: "claude",
    kind: "Anthropic",
    settings: { organizationId: "org-1", federationRuleId: "rule-1" },
  },
];

const signer: JobIdentitySigner = await (async () => {
  const built = await jobIdentitySigner([
    generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString(),
  ]);
  assert.equal(built.result, "Built");
  return built.signer;
})();

/** A read holding `held` in each of `holders` alone, every read recorded. */
function connectorsHeld(
  held: readonly Connector[],
  reads: unknown[] = [],
  holders: readonly Partition[] = [partition],
): ProjectConnectorRead {
  return {
    connector: (asked, name) => {
      reads.push([asked, name]);
      const found = held.find((connector) => connector.name === name);
      const holds = holders.some(
        (holder) =>
          holder.tenant === asked.tenant && holder.project === asked.project,
      );
      return Promise.resolve(
        found === undefined || !holds
          ? undefined
          : { connector: found, revision: 1 },
      );
    },
  };
}

/** An issuer over `held`, its clock answering `times` in turn. */
function issuerOver(
  held: readonly Connector[],
  over: Partial<ConnectorCredentialOptions> = {},
  times: readonly number[] = [issuedAtMs],
) {
  const remaining = [...times];
  return connectorCredentialIssuer({
    connectors: connectorsHeld(held),
    signer,
    issuerBaseUrl,
    nowMs: () => {
      const now = remaining.shift();
      assert.ok(now !== undefined, "the clock was read more than expected");
      return now;
    },
    ...over,
  });
}

function bundleOf(issued: CredentialIssued) {
  assert.equal(issued.issued, "Bundle");
  return issued.bundle;
}

function tokenOf(issued: CredentialIssued): string {
  const file = bundleOf(issued).files.find((held) => held.file === "token");
  assert.ok(file !== undefined && file.content.kind === "Secret");
  return file.content.secret;
}

async function verifiedClaims(token: string, atMs = issuedAtMs) {
  const { payload } = await jwtVerify(
    token,
    createLocalJWKSet({ keys: [...signer.keySet().keys] }),
    { algorithms: ["RS256"], currentDate: new Date(atMs) },
  );
  return payload;
}

test("each kind's connector is served its adaptor's bundle around a token that verifies, carrying the core's claims under the adaptor's shape", async () => {
  for (const connector of connectors) {
    const issued = await issuerOver(connectors).issue(
      requester,
      connectorCredentialOf(connector.name),
    );
    const token = tokenOf(issued);
    const adaptor = connectorAdaptor(connector);
    const target = adaptor.tokenTarget(subject);
    assert.equal(target.result, "Target");
    const expected = jobIdentityClaims(
      subject,
      issuerBaseUrl,
      target.target,
      issuedAtMs,
    );
    assert.equal(expected.result, "Claims");
    const claims = await verifiedClaims(token);
    assert.deepEqual({ ...claims }, expected.claims, connector.kind);
    assert.equal(claims.iss, `${issuerBaseUrl}/acme`);
    assert.equal(claims.sub, "project:widgets:workload:build:task:work");
    assert.equal(claims.aud, target.target.audience);
    const bundle = bundleOf(issued);
    assert.equal(bundle.expiresAtMs, (claims.exp ?? 0) * 1000);
    assert.deepEqual(
      bundle,
      adaptor.credentialBundle(token, bundle.expiresAtMs ?? 0),
    );
    assert.ok(workerHeldCredentialBundleSchema.safeParse(bundle).success);
  }
});

test("an AWS connector's token carries session tags only where the connector turns them on", async () => {
  const tagKey = "https://aws.amazon.com/tags/principal_tags/project";
  for (const sessionTags of [true, false]) {
    const connector: Connector = {
      name: "deploy",
      kind: "Aws",
      settings: {
        roleArn: "arn:aws:iam::123456789012:role/deploy",
        sessionTags,
      },
    };
    const claims = await verifiedClaims(
      tokenOf(
        await issuerOver([connector]).issue(
          requester,
          connectorCredentialOf("deploy"),
        ),
      ),
    );
    assert.equal(claims[tagKey], sessionTags ? "widgets" : undefined);
    assert.equal(
      Object.keys(claims).some((claim) => claim.startsWith("https://")),
      sessionTags,
    );
  }
});

test("any shape and any bundle an adaptor answers is passed through as it is", async () => {
  const subjects: JobIdentitySubject[] = [];
  const handed: unknown[] = [];
  const madeUp: ConnectorAdaptor = {
    tokenTarget: (asked) => {
      subjects.push(asked);
      return {
        result: "Target",
        target: {
          audience: "made-up",
          subjectBytesMax: 1024,
          claims: { flavour: "strange" },
        },
      };
    },
    credentialBundle: (token, expiresAtMs) => {
      handed.push([token, expiresAtMs]);
      return {
        credential: "anything",
        files: [{ file: "jwt", content: { kind: "Secret", secret: token } }],
        variables: [{ kind: "Value", variable: "MADE_UP", value: "yes" }],
        expiresAtMs,
      };
    },
  };
  const adapted: Connector[] = [];
  const issued = await issuerOver(connectors, {
    adaptor: (connector) => {
      adapted.push(connector);
      return madeUp;
    },
  }).issue(requester, connectorCredentialOf("azure"));
  const bundle = bundleOf(issued);
  const token = bundle.files[0]?.content;
  assert.ok(token?.kind === "Secret");
  const claims = await verifiedClaims(token.secret);
  assert.equal(claims.aud, "made-up");
  assert.equal(claims["flavour"], "strange");
  assert.deepEqual(adapted, [connectors[2]]);
  assert.deepEqual(subjects, [subject]);
  assert.deepEqual(handed, [[token.secret, (claims.exp ?? 0) * 1000]]);
  assert.deepEqual(bundle.variables, [
    { kind: "Value", variable: "MADE_UP", value: "yes" },
  ]);
});

test("a work task and an evaluation of one ticket get different subjects, and two tenants different issuers", async () => {
  const issuer = issuerOver(connectors, {}, [issuedAtMs, issuedAtMs]);
  const evaluation: CredentialRequester = {
    ...requester,
    taskKind: "Evaluation",
    evaluator: 3,
  };
  const work = await verifiedClaims(
    tokenOf(await issuer.issue(requester, connectorCredentialOf("claude"))),
  );
  const evaluated = await verifiedClaims(
    tokenOf(await issuer.issue(evaluation, connectorCredentialOf("claude"))),
  );
  assert.equal(work.sub, "project:widgets:workload:build:task:work");
  assert.equal(evaluated.sub, "project:widgets:workload:build:task:evaluation");
  assert.equal(evaluated["evaluator"], 3);

  const other: Partition = {
    tenant: asTenantId("globex"),
    project: partition.project,
  };
  const elsewhere = issuerOver(connectors, {
    connectors: connectorsHeld(connectors, [], [other]),
  });
  const foreign = await verifiedClaims(
    tokenOf(
      await elsewhere.issue(
        { ...requester, partition: other },
        connectorCredentialOf("claude"),
      ),
    ),
  );
  assert.equal(work.iss, `${issuerBaseUrl}/acme`);
  assert.equal(foreign.iss, `${issuerBaseUrl}/globex`);
});

test("every ask is a fresh mint at the clock's own time", async () => {
  const later = issuedAtMs + 60_000;
  const issuer = issuerOver(connectors, {}, [issuedAtMs, later]);
  const first = await issuer.issue(requester, connectorCredentialOf("claude"));
  const second = await issuer.issue(requester, connectorCredentialOf("claude"));
  assert.notEqual(tokenOf(first), tokenOf(second));
  const [firstClaims, secondClaims] = [
    await verifiedClaims(tokenOf(first)),
    await verifiedClaims(tokenOf(second), later),
  ];
  assert.equal(firstClaims.iat, issuedAtMs / 1000);
  assert.equal(secondClaims.iat, later / 1000);
  assert.ok(
    (bundleOf(second).expiresAtMs ?? 0) > (bundleOf(first).expiresAtMs ?? 0),
  );
});

test("a name that is no connector credential is not served, and nothing is read", async () => {
  const reads: unknown[] = [];
  const issuer = issuerOver(connectors, {
    connectors: connectorsHeld(connectors, reads),
  });
  for (const credential of ["track-record", "chuggy.github-workflow-runs"])
    assert.deepEqual(await issuer.issue(requester, credential), {
      issued: "NotServed",
    });
  assert.deepEqual(reads, []);
});

/** `connector`'s own adaptor but for the token shape, which is `tokenTarget`'s. */
function adaptorShaping(
  tokenTarget: ConnectorAdaptor["tokenTarget"],
): (connector: Connector) => ConnectorAdaptor {
  return (connector) => ({ ...connectorAdaptor(connector), tokenTarget });
}

const unnamed: CredentialRequester = {
  partition,
  ticket: requester.ticket,
  task: requester.task,
  taskKind: "Work",
};

test("each refusal and outage is answered as one, and no token is signed", async () => {
  const signed: unknown[] = [];
  const counting: JobIdentitySigner = {
    sign: (claims) => {
      signed.push(claims);
      return signer.sign(claims);
    },
    keySet: () => signer.keySet(),
  };
  const refused = { issued: "Absent", reason: "IssuerRefused" } as const;
  for (const [why, over, asked, credential, answer] of [
    [
      "connector absent",
      {},
      requester,
      "absent",
      { issued: "Absent", reason: "NotEnabled" },
    ],
    ["no workload", {}, unnamed, "claude", refused],
    [
      "shape refused",
      {
        adaptor: adaptorShaping(() => ({
          result: "Refused",
          refusal: { reason: "SessionTagTooLong", key: "workload" },
        })),
      },
      requester,
      "claude",
      refused,
    ],
    [
      "claims refused",
      {
        adaptor: adaptorShaping(() => ({
          result: "Target",
          target: { audience: "a", subjectBytesMax: 255, claims: { sub: "x" } },
        })),
      },
      requester,
      "claude",
      refused,
    ],
    [
      "read raised",
      { connectors: { connector: () => Promise.reject(new Error("down")) } },
      requester,
      "claude",
      { issued: "Unavailable" },
    ],
  ] as const) {
    assert.deepEqual(
      await issuerOver(connectors, { signer: counting, ...over }).issue(
        asked,
        connectorCredentialOf(credential),
      ),
      answer,
      why,
    );
  }
  assert.deepEqual(signed, []);
});

test("a signer that raises is an outage", async () => {
  assert.deepEqual(
    await issuerOver(connectors, {
      signer: {
        sign: () => Promise.reject(new Error("no key")),
        keySet: () => signer.keySet(),
      },
    }).issue(requester, connectorCredentialOf("claude")),
    { issued: "Unavailable" },
  );
});

test("the connector is read in the requester's own project and nowhere else", async () => {
  const reads: unknown[] = [];
  const issuer = issuerOver(
    connectors,
    {
      connectors: connectorsHeld(connectors, reads),
    },
    [issuedAtMs, issuedAtMs],
  );
  await issuer.issue(requester, connectorCredentialOf("deploy"));
  const other: Partition = {
    tenant: partition.tenant,
    project: asProjectId("gadgets"),
  };
  assert.deepEqual(
    await issuer.issue(
      { ...requester, partition: other },
      connectorCredentialOf("deploy"),
    ),
    { issued: "Absent", reason: "NotEnabled" },
  );
  assert.deepEqual(reads, [
    [partition, "deploy"],
    [other, "deploy"],
  ]);
});
