/**
 * A project's connectors through their routes against a real store: what an
 * administrator writes and the history it leaves, who else may read and who
 * may not, that every refusal changes nothing, and that one project's
 * connectors are never another's.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresProjectConnectors } from "../../src/adapters/postgres/projectConnectors.ts";
import { apiRole } from "../../src/adapters/postgres/schema/shared.ts";
import {
  connectorHistoryResponseSchema,
  connectorsResponseSchema,
} from "../../src/contract/connectorAdministration.ts";
import {
  connectorsProjectMax,
  type Connector,
} from "../../src/contract/connectors.ts";
import { endpointPath } from "../../src/contract/endpoints.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import { projectConnectorAdministration } from "../../src/interpreter/projectConnectors.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { callerApp } from "../adapters/callerAppFixture.ts";
import {
  postgresHarnessOpen,
  postgresHarnessPartition,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";

const administrator = asPrincipal("issuer-administrator");
const reader = asPrincipal("issuer-reader");
const stranger = asPrincipal("issuer-stranger");

let harness: PostgresHarness;
let apiPool: pg.Pool;
const access = memoryProjectAccess();
before(async () => {
  harness = await postgresHarnessOpen();
  apiPool = postgresHarnessRolePool(apiRole);
});
after(async () => {
  await apiPool.end();
  await harness.close();
});

const connectors: readonly Connector[] = [
  {
    name: "anthropic",
    kind: "Anthropic",
    settings: { organizationId: "org-1", federationRuleId: "rule-1" },
  },
  {
    name: "aws",
    kind: "Aws",
    settings: { roleArn: "arn:aws:iam::123456789012:role/jobs" },
  },
  { name: "azure", kind: "Azure", settings: { tenantId: "t", clientId: "c" } },
  {
    name: "gcp",
    kind: "Gcp",
    settings: { projectNumber: "1234", pool: "chuggy", provider: "jobs" },
  },
];

/** The settings each connector is replaced with, still its kind's. */
function replaced(connector: Connector): Connector {
  switch (connector.kind) {
    case "Aws":
      return {
        ...connector,
        settings: { ...connector.settings, sessionTags: true },
      };
    case "Gcp":
      return {
        ...connector,
        settings: { ...connector.settings, serviceAccount: "jobs@x.example" },
      };
    case "Azure":
      return { ...connector, settings: { tenantId: "t", clientId: "d" } };
    case "Anthropic":
      return {
        ...connector,
        settings: { ...connector.settings, workspaceId: "ws-1" },
      };
  }
}

async function project(label: string): Promise<Partition> {
  const partition = postgresHarnessPartition(label);
  await harness.store.createProject(partition);
  access.grant({
    partition,
    principal: administrator,
    access: new Set(["Read", "Administer"]),
  });
  access.grant({ partition, principal: reader, access: new Set(["Read"]) });
  return partition;
}

/** The routes as `caller` reaches them in `partition`. */
function routes(caller: Principal, partition: Partition) {
  const app = callerApp(caller, {
    connectors: projectConnectorAdministration({
      access,
      store: postgresProjectConnectors(apiPool),
    }),
  });
  const headers = { authorization: "Bearer valid" };
  const connectorUrl = (name: string) =>
    endpointPath(nativeHttpRoutes.connector, { ...partition, name });
  return {
    app,
    list: () =>
      app.inject({
        url: endpointPath(nativeHttpRoutes.connectors, partition),
        headers,
      }),
    history: (query = "") =>
      app.inject({
        url: `${endpointPath(nativeHttpRoutes.connectorHistory, partition)}${query}`,
        headers,
      }),
    put: (name: string, body: unknown) =>
      app.inject({
        method: "PUT",
        url: connectorUrl(name),
        headers: { ...headers, "content-type": nativeHttpMediaType },
        payload: JSON.stringify(body),
      }),
    remove: (name: string, expectedRevision?: number) =>
      app.inject({
        method: "DELETE",
        url:
          expectedRevision === undefined
            ? connectorUrl(name)
            : `${connectorUrl(name)}?expectedRevision=${String(expectedRevision)}`,
        headers,
      }),
  };
}

function body(connector: Connector, expectedRevision?: number) {
  return {
    kind: connector.kind,
    settings: connector.settings,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  };
}

/** What the list and the history answer, which a refusal must leave as it found. */
async function standing(caller: ReturnType<typeof routes>) {
  const [listed, history] = await Promise.all([
    caller.list(),
    caller.history(),
  ]);
  assert.equal(listed.statusCode, 200);
  assert.equal(history.statusCode, 200);
  return { list: listed.json<unknown>(), history: history.json<unknown>() };
}

function code(answered: { json(): unknown }): string {
  return (answered.json() as { error: { code: string } }).error.code;
}

test("an administrator creates, lists, replaces and removes a connector of each kind, and the history holds each change as theirs", async () => {
  const partition = await project("connector-lifecycle");
  const as = routes(administrator, partition);
  for (const connector of connectors) {
    const created = await as.put(connector.name, body(connector));
    assert.equal(created.statusCode, 201, connector.kind);
    assert.deepEqual(created.json(), { ...connector, revision: 1 });
  }
  const listed = await as.list();
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(connectorsResponseSchema.parse(listed.json()), {
    connectors: connectors.map((row) => ({ ...row, revision: 1 })),
  });
  for (const connector of connectors) {
    const changed = await as.put(connector.name, body(replaced(connector), 1));
    assert.equal(changed.statusCode, 200, connector.kind);
    assert.deepEqual(changed.json(), { ...replaced(connector), revision: 2 });
  }
  assert.deepEqual((await as.list()).json(), {
    connectors: connectors.map((row) => ({ ...replaced(row), revision: 2 })),
  });
  for (const connector of connectors) {
    const removed = await as.remove(connector.name, 2);
    assert.equal(removed.statusCode, 204, connector.kind);
  }
  assert.deepEqual((await as.list()).json(), { connectors: [] });

  const history = await as.history();
  assert.equal(history.statusCode, 200);
  const page = connectorHistoryResponseSchema.parse(history.json());
  assert.equal(page.next, undefined);
  const author = { kind: "Member", subject: administrator };
  const expected = [
    ...connectors.map((row) => ({ ...row, action: "Created" })),
    ...connectors.map((row) => ({ ...replaced(row), action: "Changed" })),
    ...connectors.map((row) => ({ name: row.name, action: "Removed" })),
  ].reverse();
  assert.deepEqual(
    page.changes,
    expected.map((row, at) => ({
      change: page.changes[at]?.change,
      changedAt: page.changes[at]?.changedAt,
      ...row,
      author,
    })),
  );
  const numbers = page.changes.map((row) => row.change);
  assert.deepEqual(
    numbers,
    [...numbers].sort((left, right) => right - left),
  );
  await as.app.close();
});

test("a reader lists and reads history and is refused both writes, and a caller with no reach is refused all four, each as not found and changing nothing", async () => {
  const partition = await project("connector-standing");
  const as = routes(administrator, partition);
  const [aws] = connectors.filter((row) => row.kind === "Aws");
  assert.ok(aws !== undefined);
  assert.equal((await as.put(aws.name, body(aws))).statusCode, 201);
  const held = await standing(as);

  const byReader = routes(reader, partition);
  assert.deepEqual(await standing(byReader), held);
  for (const answered of [
    await byReader.put(aws.name, body(replaced(aws), 1)),
    await byReader.put("other", body(aws)),
    await byReader.remove(aws.name, 1),
  ]) {
    assert.equal(answered.statusCode, 404);
    assert.equal(code(answered), "NotFound");
  }

  const byStranger = routes(stranger, partition);
  for (const answered of [
    await byStranger.list(),
    await byStranger.history(),
    await byStranger.put(aws.name, body(replaced(aws), 1)),
    await byStranger.remove(aws.name, 1),
  ]) {
    assert.equal(answered.statusCode, 404);
    assert.equal(code(answered), "NotFound");
  }
  assert.deepEqual(await standing(as), held);
  await Promise.all([
    as.app.close(),
    byReader.app.close(),
    byStranger.app.close(),
  ]);
});

/** Each refusal an administrator meets against `aws` at revision 2, sent in turn, with what it must answer. */
async function refusals(
  as: ReturnType<typeof routes>,
  aws: Connector,
  gcp: Connector,
) {
  return [
    [
      "a create over one standing",
      await as.put(aws.name, body(aws)),
      409,
      "ConnectorStale",
      2,
    ],
    [
      "a replace of a revision gone",
      await as.put(aws.name, body(aws, 1)),
      409,
      "ConnectorStale",
      2,
    ],
    [
      "a replace of none standing",
      await as.put("absent", body(aws, 1)),
      409,
      "ConnectorStale",
      undefined,
    ],
    [
      "a removal naming no fence",
      await as.remove(aws.name),
      409,
      "ConnectorStale",
      2,
    ],
    [
      "a removal of a revision gone",
      await as.remove(aws.name, 1),
      409,
      "ConnectorStale",
      2,
    ],
    [
      "a removal of none standing",
      await as.remove("absent", 1),
      404,
      "ConnectorNotFound",
      undefined,
    ],
    [
      "settings of another kind",
      await as.put(aws.name, {
        kind: "Aws",
        settings: gcp.settings,
        expectedRevision: 2,
      }),
      400,
      "InvalidRequest",
      undefined,
    ],
    [
      "a name no connector has",
      await as.put("Not-A-Name", body(aws)),
      400,
      "InvalidRequest",
      undefined,
    ],
  ] as const;
}

test("each refusal of an administrator's write or removal answers its status and code and changes nothing", async () => {
  const partition = await project("connector-refusals");
  const as = routes(administrator, partition);
  const [aws, gcp] = [connectors[1], connectors[3]];
  assert.ok(aws !== undefined && gcp !== undefined);
  assert.equal((await as.put(aws.name, body(aws))).statusCode, 201);
  assert.equal(
    (await as.put(aws.name, body(replaced(aws), 1))).statusCode,
    200,
  );
  const held = await standing(as);

  for (const [
    label,
    answered,
    status,
    refused,
    standingRevision,
  ] of await refusals(as, aws, gcp)) {
    assert.equal(answered.statusCode, status, label);
    assert.equal(code(answered), refused, label);
    assert.equal(
      answered.json<{ standing?: number }>().standing,
      standingRevision,
      label,
    );
  }
  assert.deepEqual(await standing(as), held);
  await as.app.close();
});

test("a create into a project holding as many connectors as it may is refused by its own code and changes nothing", async () => {
  const partition = await project("connector-limit");
  const as = routes(administrator, partition);
  const [aws] = connectors.filter((row) => row.kind === "Aws");
  assert.ok(aws !== undefined);
  for (let at = 0; at < connectorsProjectMax; at += 1)
    assert.equal(
      (await as.put(`aws-${String(at)}`, body(aws))).statusCode,
      201,
    );
  const held = await standing(as);
  const refused = await as.put("one-more", body(aws));
  assert.equal(refused.statusCode, 409);
  assert.equal(code(refused), "ConnectorLimitReached");
  assert.deepEqual(await standing(as), held);
  await as.app.close();
});

test("a connector written in one project is absent from another's list and history", async () => {
  const [one, other] = [
    await project("connector-one"),
    await project("connector-other"),
  ];
  const inOne = routes(administrator, one);
  const inOther = routes(administrator, other);
  const [aws] = connectors.filter((row) => row.kind === "Aws");
  assert.ok(aws !== undefined);
  assert.equal((await inOne.put(aws.name, body(aws))).statusCode, 201);
  assert.deepEqual(await standing(inOther), {
    list: { connectors: [] },
    history: { changes: [] },
  });
  const removed = await inOther.remove(aws.name, 1);
  assert.equal(code(removed), "ConnectorNotFound");
  assert.equal(
    (await inOne.list()).json<{ connectors: unknown[] }>().connectors.length,
    1,
  );
  await Promise.all([inOne.app.close(), inOther.app.close()]);
});
