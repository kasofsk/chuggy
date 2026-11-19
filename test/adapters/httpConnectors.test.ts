/**
 * A project's connectors as their routes answer them: what each outcome of the
 * service is sent as, what each route hands it, and that a body or a name the
 * contract refuses never reaches it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectorHistoryResponseSchema,
  connectorStaleResponseSchema,
  connectorStandingSchema,
  connectorsResponseSchema,
} from "../../src/contract/connectorAdministration.ts";
import type { Connector } from "../../src/contract/connectors.ts";
import { endpointPath } from "../../src/contract/endpoints.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import type {
  ProjectConnectorAdministration,
  ProjectConnectorRemoved,
  ProjectConnectorWritten,
} from "../../src/interpreter/projectConnectors.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { callerApp } from "./callerAppFixture.ts";

const caller = asPrincipal("issuer-subject");
const json = { "content-type": nativeHttpMediaType };
const bearer = { authorization: "Bearer valid" };
const partitionParameters = { tenant: "acme", project: "atlas" };
const aws: Connector = {
  name: "aws-prod",
  kind: "Aws",
  settings: { roleArn: "arn:aws:iam::123456789012:role/jobs" },
};
const listUrl = endpointPath(nativeHttpRoutes.connectors, partitionParameters);
const historyUrl = endpointPath(
  nativeHttpRoutes.connectorHistory,
  partitionParameters,
);
const connectorUrl = (name: string) =>
  endpointPath(nativeHttpRoutes.connector, { ...partitionParameters, name });

/** A service answering each door as the case sets it, keeping what each was handed. */
function connectors(answers: {
  readonly written?: ProjectConnectorWritten;
  readonly removed?: ProjectConnectorRemoved;
}): ProjectConnectorAdministration & { readonly asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    listed: (principal, partition) => {
      asked.push(["listed", principal, partition]);
      return Promise.resolve({
        result: "Found",
        connectors: [{ connector: aws, revision: 2 }],
      });
    },
    written: (principal, partition, write) => {
      asked.push(["written", principal, partition, write]);
      return Promise.resolve(answers.written ?? { result: "NotFound" });
    },
    removed: (principal, partition, remove) => {
      asked.push(["removed", principal, partition, remove]);
      return Promise.resolve(answers.removed ?? { result: "NotFound" });
    },
    history: (principal, partition, before) => {
      asked.push(["history", principal, partition, before]);
      return Promise.resolve({
        result: "Found",
        changes: [
          {
            change: 7,
            changedAt: "2026-11-19T00:00:00.000000Z",
            authority: memberAuthority(caller),
            action: "Removed",
            name: aws.name,
          },
          {
            change: 6,
            changedAt: "2026-11-18T00:00:00.000000Z",
            authority: memberAuthority(caller),
            action: "Created",
            connector: aws,
          },
        ],
        next: 6,
      });
    },
  };
}

async function writing(
  service: ProjectConnectorAdministration,
  payload: unknown,
  name = aws.name,
  headers: Readonly<Record<string, string>> = json,
) {
  await using app = callerApp(caller, { connectors: service });
  return await app.inject({
    method: "PUT",
    url: connectorUrl(name),
    headers: { ...bearer, ...headers },
    payload: JSON.stringify(payload),
  });
}

async function removing(service: ProjectConnectorAdministration, url: string) {
  await using app = callerApp(caller, { connectors: service });
  return await app.inject({ method: "DELETE", url, headers: bearer });
}

test("a list answers each connector with its revision, after handing the service the caller and the partition", async () => {
  const service = connectors({});
  await using app = callerApp(caller, { connectors: service });
  const answered = await app.inject({ url: listUrl, headers: bearer });
  assert.equal(answered.statusCode, 200);
  const body: unknown = answered.json();
  assert.deepEqual(body, { connectors: [{ ...aws, revision: 2 }] });
  assert.deepEqual(connectorsResponseSchema.parse(body), body);
  assert.deepEqual(service.asked, [["listed", caller, partitionParameters]]);
});

test("the history is its own route, never a connector's name, and hands the service the cursor it names", async () => {
  const service = connectors({});
  await using app = callerApp(caller, { connectors: service });
  const answered = await app.inject({
    url: `${historyUrl}?before=9`,
    headers: bearer,
  });
  assert.equal(answered.statusCode, 200);
  const body: unknown = answered.json();
  assert.deepEqual(body, {
    changes: [
      {
        change: 7,
        changedAt: "2026-11-19T00:00:00.000000Z",
        author: { kind: "Member", subject: caller },
        name: aws.name,
        action: "Removed",
      },
      {
        change: 6,
        changedAt: "2026-11-18T00:00:00.000000Z",
        author: { kind: "Member", subject: caller },
        ...aws,
        action: "Created",
      },
    ],
    next: 6,
  });
  assert.deepEqual(connectorHistoryResponseSchema.parse(body), body);
  assert.deepEqual(service.asked, [
    ["history", caller, partitionParameters, 9],
  ]);
});

test("a write hands the service the connector its path and body name, and answers it as written", async () => {
  for (const [written, status] of [
    [{ result: "Created", standing: { connector: aws, revision: 1 } }, 201],
    [{ result: "Changed", standing: { connector: aws, revision: 4 } }, 200],
  ] as const) {
    const service = connectors({ written });
    const answered = await writing(service, {
      kind: aws.kind,
      settings: aws.settings,
      expectedRevision: 3,
    });
    assert.equal(answered.statusCode, status, written.result);
    const body: unknown = answered.json();
    assert.deepEqual(body, { ...aws, revision: written.standing.revision });
    assert.deepEqual(connectorStandingSchema.parse(body), body);
    assert.deepEqual(service.asked, [
      [
        "written",
        caller,
        partitionParameters,
        { connector: aws, expectedRevision: 3 },
      ],
    ]);
  }
});

test("each refusal of a write is its own status and code", async () => {
  for (const [written, status, code, standing] of [
    [{ result: "NotFound" }, 404, "NotFound", undefined],
    [{ result: "Stale", standing: 2 }, 409, "ConnectorStale", 2],
    [{ result: "Stale" }, 409, "ConnectorStale", undefined],
    [{ result: "LimitReached" }, 409, "ConnectorLimitReached", undefined],
  ] as const) {
    const answered = await writing(connectors({ written }), {
      kind: aws.kind,
      settings: aws.settings,
    });
    assert.equal(answered.statusCode, status, written.result);
    const body = answered.json<{
      error: { code: string };
      standing?: number;
    }>();
    assert.equal(body.error.code, code, written.result);
    assert.equal(body.standing, standing, written.result);
    if (code === "ConnectorStale") connectorStaleResponseSchema.parse(body);
  }
});

test("a write whose settings are not its kind's, whose name is not a connector's, or whose body is not versioned, is refused before the service", async () => {
  for (const [payload, name] of [
    [{ kind: "Gcp", settings: aws.settings }, aws.name],
    [{ kind: "Aws", settings: { roleArn: "role/jobs" } }, aws.name],
    [{ kind: "Aws", settings: aws.settings, extra: true }, aws.name],
    [{ kind: "Aws", settings: aws.settings, expectedRevision: 0 }, aws.name],
    [{ kind: "Aws", settings: aws.settings, name: "other" }, aws.name],
    [{ kind: "Kubernetes", settings: {} }, aws.name],
    [{ kind: "Aws", settings: aws.settings }, "Prod"],
    [{ kind: "Aws", settings: aws.settings }, "-prod"],
    [{ kind: "Aws", settings: aws.settings }, "p".repeat(41)],
  ] as const) {
    const service = connectors({});
    const answered = await writing(service, payload, name);
    const label = `${name} ${JSON.stringify(payload)}`;
    assert.equal(answered.statusCode, 400, label);
    assert.equal(
      answered.json<{ error: { code: string } }>().error.code,
      "InvalidRequest",
      label,
    );
    assert.deepEqual(service.asked, [], label);
  }
  const service = connectors({});
  const answered = await writing(
    service,
    { kind: aws.kind, settings: aws.settings },
    aws.name,
    { "content-type": "application/json" },
  );
  assert.equal(answered.statusCode, 415);
  assert.deepEqual(service.asked, []);
});

test("a removal hands the service the name and the fence it names, and each answer is its own status and code", async () => {
  for (const [removed, status, code] of [
    [{ result: "Removed" }, 204, undefined],
    [{ result: "NotFound" }, 404, "NotFound"],
    [{ result: "Absent" }, 404, "ConnectorNotFound"],
    [{ result: "Stale", standing: 5 }, 409, "ConnectorStale"],
  ] as const) {
    const service = connectors({ removed });
    const answered = await removing(
      service,
      `${connectorUrl(aws.name)}?expectedRevision=4`,
    );
    assert.equal(answered.statusCode, status, removed.result);
    if (code !== undefined)
      assert.equal(
        answered.json<{ error: { code: string } }>().error.code,
        code,
        removed.result,
      );
    assert.deepEqual(service.asked, [
      [
        "removed",
        caller,
        partitionParameters,
        { name: aws.name, expectedRevision: 4 },
      ],
    ]);
  }
});

test("a removal naming no fence is handed the service without one, and one naming a malformed fence or name is refused before it", async () => {
  const service = connectors({ removed: { result: "Stale", standing: 5 } });
  const answered = await removing(service, connectorUrl(aws.name));
  assert.equal(answered.statusCode, 409);
  assert.equal(answered.json<{ standing: number }>().standing, 5);
  assert.deepEqual(service.asked, [
    ["removed", caller, partitionParameters, { name: aws.name }],
  ]);
  for (const url of [
    `${connectorUrl(aws.name)}?expectedRevision=one`,
    `${connectorUrl(aws.name)}?expectedRevision=-1`,
    `${connectorUrl(aws.name)}?expectedRevision=1&force=true`,
    `${connectorUrl("Prod")}?expectedRevision=1`,
  ]) {
    const refused = connectors({});
    const answer = await removing(refused, url);
    assert.equal(answer.statusCode, 400, url);
    assert.deepEqual(refused.asked, [], url);
  }
});
