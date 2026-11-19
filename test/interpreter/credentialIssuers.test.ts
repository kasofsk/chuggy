/**
 * The resolver over credential issuers: which names it asks them for, what it
 * answers for each name, and an outage of any issuer as an outage of all.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerHeldCredentialBundle } from "../../src/contract/workerPlane.ts";
import {
  connectorCredentialOf,
  connectorCredentialPrefix,
} from "../../src/contract/workerEnvironment.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import {
  credentialResolver,
  type CredentialIssued,
  type CredentialIssuer,
  type CredentialRequester,
} from "../../src/interpreter/credentialIssuers.ts";
import type { ProjectConnectorRead } from "../../src/interpreter/projectConnectors.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";

const requester: CredentialRequester = {
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  ticket: asTicketId(7),
  task: asTaskId(11),
};

function bundle(credential: string): WorkerHeldCredentialBundle {
  return {
    credential,
    files: [{ file: "secret", content: { kind: "Secret", secret: "s" } }],
    variables: [{ kind: "Path", variable: "TOKEN_FILE", file: "secret" }],
  };
}

/** An issuer answering each name from `answers`, every other name not its own, recording what it was asked. */
function issuer(
  answers: Readonly<Record<string, CredentialIssued>>,
  asked: string[] = [],
): CredentialIssuer {
  return {
    issue: (who, credential) => {
      assert.equal(who, requester);
      asked.push(credential);
      return Promise.resolve(answers[credential] ?? { issued: "NotServed" });
    },
  };
}

const everything = {
  requester,
  listed: ["a", "b", "c", "d"],
  granted: ["a", "b", "c", "d"],
};

test("a name the configuration did not list is left out, and no issuer is asked for it", async () => {
  const asked: string[] = [];
  const resolver = credentialResolver([
    issuer({ x: { issued: "Bundle", bundle: bundle("x") } }, asked),
  ]);
  assert.deepEqual(
    await resolver.resolve({ ...everything, granted: ["x"], asked: ["x"] }),
    { resolved: "Credentials", credentials: [], absent: [] },
  );
  assert.deepEqual(asked, []);
});

test("a listed name the grant does not carry is absent as not granted, and no issuer is asked for it", async () => {
  const asked: string[] = [];
  const resolver = credentialResolver([
    issuer({ a: { issued: "Bundle", bundle: bundle("a") } }, asked),
  ]);
  assert.deepEqual(
    await resolver.resolve({ ...everything, granted: [], asked: ["a"] }),
    {
      resolved: "Credentials",
      credentials: [],
      absent: [{ credential: "a", reason: "NotGranted" }],
    },
  );
  assert.deepEqual(asked, []);
});

test("each name is answered once, in the order asked, by the first issuer serving it", async () => {
  const first: string[] = [];
  const second: string[] = [];
  const resolver = credentialResolver([
    issuer({ b: { issued: "Absent", reason: "NotEnabled" } }, first),
    issuer(
      {
        a: { issued: "Bundle", bundle: bundle("a") },
        b: { issued: "Bundle", bundle: bundle("b") },
      },
      second,
    ),
  ]);
  assert.deepEqual(
    await resolver.resolve({ ...everything, asked: ["c", "b", "a", "c", "a"] }),
    {
      resolved: "Credentials",
      credentials: [bundle("a")],
      absent: [
        { credential: "c", reason: "NotHeld" },
        { credential: "b", reason: "NotEnabled" },
      ],
    },
  );
  assert.deepEqual(first, ["c", "b", "a"]);
  assert.deepEqual(
    second,
    ["c", "a"],
    "an issuer was asked past the first answer",
  );
});

test("an outage of any issuer is an outage of the whole answer, never an absence", async () => {
  const outages: readonly CredentialIssuer[] = [
    issuer({ b: { issued: "Unavailable" } }),
    { issue: () => Promise.reject(new Error("unreachable")) },
  ];
  for (const outage of outages) {
    const resolver = credentialResolver([
      issuer({ a: { issued: "Bundle", bundle: bundle("a") } }),
      outage,
    ]);
    assert.deepEqual(
      await resolver.resolve({ ...everything, asked: ["a", "b", "c"] }),
      { resolved: "Unavailable" },
    );
  }
});

test("a resolver over no issuers names every listed and granted name not held", async () => {
  assert.deepEqual(
    await credentialResolver([]).resolve({ ...everything, asked: ["d"] }),
    {
      resolved: "Credentials",
      credentials: [],
      absent: [{ credential: "d", reason: "NotHeld" }],
    },
  );
});

const deploy = connectorCredentialOf("deploy");
const other = { ...requester.partition, project: asProjectId("other") };

/** A connector read holding `deploy` in `holder`'s project, recording each name it was asked. */
function connectorRead(
  asked: string[] = [],
  holder: Partition = requester.partition,
): ProjectConnectorRead {
  return {
    connector: (partition, name) => {
      asked.push(name);
      return Promise.resolve(
        partition.tenant === holder.tenant &&
          partition.project === holder.project &&
          name === "deploy"
          ? {
              connector: {
                name,
                kind: "Anthropic",
                settings: { organizationId: "org", federationRuleId: "rule" },
              },
              revision: 1,
            }
          : undefined,
      );
    },
  };
}

test("a listed connector name its project holds reaches the issuers although the grant does not carry it", async () => {
  const lookups: string[] = [];
  const asked: string[] = [];
  const resolver = credentialResolver(
    [issuer({}, asked)],
    connectorRead(lookups),
  );
  assert.deepEqual(
    await resolver.resolve({
      requester,
      listed: [deploy],
      granted: [],
      asked: [deploy, deploy],
    }),
    {
      resolved: "Credentials",
      credentials: [],
      absent: [{ credential: deploy, reason: "NotHeld" }],
    },
  );
  assert.deepEqual(asked, [deploy]);
  assert.deepEqual(lookups, ["deploy"]);
});

test("a listed connector name its project does not hold is not enabled, and no issuer is asked for it", async () => {
  for (const [why, credential, read] of [
    ["held nowhere", connectorCredentialOf("absent"), connectorRead()],
    ["held by another project", deploy, connectorRead([], other)],
    ["no connector read", deploy, undefined],
  ] as const) {
    const asked: string[] = [];
    const resolver = credentialResolver([issuer({}, asked)], read);
    assert.deepEqual(
      await resolver.resolve({
        requester,
        listed: [credential],
        granted: [credential],
        asked: [credential],
      }),
      {
        resolved: "Credentials",
        credentials: [],
        absent: [{ credential, reason: "NotEnabled" }],
      },
      why,
    );
    assert.deepEqual(asked, [], why);
  }
});

test("a name in the connector prefix that is no connector name is not enabled, and nothing is looked up", async () => {
  const malformed = `${connectorCredentialPrefix}not a name`;
  const lookups: string[] = [];
  const asked: string[] = [];
  const resolver = credentialResolver(
    [issuer({}, asked)],
    connectorRead(lookups),
  );
  assert.deepEqual(
    await resolver.resolve({
      requester,
      listed: [malformed],
      granted: [malformed],
      asked: [malformed],
    }),
    {
      resolved: "Credentials",
      credentials: [],
      absent: [{ credential: malformed, reason: "NotEnabled" }],
    },
  );
  assert.deepEqual([lookups, asked], [[], []]);
});

test("an unlisted connector name is left out, and nothing is looked up, where its project holds it", async () => {
  const lookups: string[] = [];
  const resolver = credentialResolver([issuer({})], connectorRead(lookups));
  assert.deepEqual(
    await resolver.resolve({
      requester,
      listed: [],
      granted: [deploy],
      asked: [deploy],
    }),
    { resolved: "Credentials", credentials: [], absent: [] },
  );
  assert.deepEqual(lookups, []);
});

test("a connector read that raises is an outage of the whole answer", async () => {
  const resolver = credentialResolver(
    [issuer({ a: { issued: "Bundle", bundle: bundle("a") } })],
    { connector: () => Promise.reject(new Error("unreachable")) },
  );
  assert.deepEqual(
    await resolver.resolve({
      requester,
      listed: ["a", deploy],
      granted: ["a"],
      asked: ["a", deploy],
    }),
    { resolved: "Unavailable" },
  );
});

test("a connector's name is looked up again on each ask, never kept", async () => {
  const lookups: string[] = [];
  const resolver = credentialResolver([], connectorRead(lookups));
  const ask = { requester, listed: [deploy], granted: [], asked: [deploy] };
  await resolver.resolve(ask);
  await resolver.resolve(ask);
  assert.deepEqual(lookups, ["deploy", "deploy"]);
});
