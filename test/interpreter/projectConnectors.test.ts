/**
 * A project's connectors as the service decides them: who may read and who may
 * change them, decided by the permits a repository's settings are, the
 * authority each change is recorded under, and the cursor a history page
 * answers.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectorChangesPageMax,
  type Connector,
} from "../../src/contract/connectors.ts";
import {
  memberAuthority,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectConnectorAdministration,
  type ProjectConnectorChange,
  type ProjectConnectorRemoveOutcome,
  type ProjectConnectorStore,
  type ProjectConnectorWriteOutcome,
} from "../../src/interpreter/projectConnectors.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  repositoryReaderAuthority,
  repositorySettingsAuthority,
} from "../../src/interpreter/repositoryOnboarding.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const caller = asPrincipal("issuer-caller");
const aws: Connector = {
  name: "aws-prod",
  kind: "Aws",
  settings: { roleArn: "arn:aws:iam::123456789012:role/jobs" },
};

function change(number: number): ProjectConnectorChange {
  return {
    change: number,
    changedAt: "2026-11-19T00:00:00.000000Z",
    authority: memberAuthority(caller),
    action: "Created",
    connector: aws,
  };
}

/** A store answering as a case scripts it, keeping what each door was handed. */
function scriptedStore(answers: {
  readonly written?: ProjectConnectorWriteOutcome;
  readonly removed?: ProjectConnectorRemoveOutcome;
  readonly changes?: readonly ProjectConnectorChange[];
}): ProjectConnectorStore & { readonly asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    connector: (_partition, name) => {
      asked.push(["connector", name]);
      return Promise.resolve(undefined);
    },
    connectors: (at) => {
      asked.push(["connectors", at]);
      return Promise.resolve([{ connector: aws, revision: 1 }]);
    },
    write: (command) => {
      asked.push(["write", command]);
      return Promise.resolve(
        answers.written ?? { outcome: "Created", revision: 1 },
      );
    },
    remove: (command) => {
      asked.push(["remove", command]);
      return Promise.resolve(
        answers.removed ?? { outcome: "Removed", revision: 2 },
      );
    },
    changes: (at, before) => {
      asked.push(["changes", at, before]);
      return Promise.resolve(answers.changes ?? []);
    },
  };
}

function administered(
  kinds: readonly ProjectAccessKind[],
  store: ProjectConnectorStore,
) {
  const access = memoryProjectAccess();
  access.grant({ partition, principal: caller, access: new Set(kinds) });
  return { access, service: projectConnectorAdministration({ access, store }) };
}

const standings: readonly (readonly ProjectAccessKind[])[] = [
  [],
  ["Read"],
  ["Read", "Mutate"],
  ["Administer"],
  ["Read", "Administer"],
];

test("a caller writes and removes a project's connectors exactly where they may change a repository's settings", async () => {
  for (const kinds of standings) {
    const store = scriptedStore({});
    const { access, service } = administered(kinds, store);
    const settings = await repositorySettingsAuthority(
      access,
      caller,
      partition,
    );
    const written = await service.written(caller, partition, {
      connector: aws,
    });
    const removed = await service.removed(caller, partition, {
      name: aws.name,
      expectedRevision: 1,
    });
    const label = kinds.join(",");
    assert.equal(written.result !== "NotFound", settings !== undefined, label);
    assert.equal(removed.result !== "NotFound", settings !== undefined, label);
    if (settings === undefined) assert.deepEqual(store.asked, [], label);
  }
});

test("a caller lists and reads a project's connector history exactly where they may read its repositories", async () => {
  for (const kinds of standings) {
    const store = scriptedStore({});
    const { access, service } = administered(kinds, store);
    const reader = await repositoryReaderAuthority(access, caller, partition);
    const listed = await service.listed(caller, partition);
    const history = await service.history(caller, partition);
    const label = kinds.join(",");
    assert.equal(listed.result === "Found", reader !== undefined, label);
    assert.equal(history.result === "Found", reader !== undefined, label);
    if (reader === undefined) assert.deepEqual(store.asked, [], label);
  }
});

test("a write and a removal are recorded under the caller's own authority, with the fence it named", async () => {
  const store = scriptedStore({});
  const { service } = administered(["Administer"], store);
  assert.deepEqual(
    await service.written(caller, partition, {
      connector: aws,
      expectedRevision: 3,
    }),
    { result: "Created", standing: { connector: aws, revision: 1 } },
  );
  assert.deepEqual(
    await service.removed(caller, partition, { name: aws.name }),
    { result: "Removed" },
  );
  assert.deepEqual(store.asked, [
    [
      "write",
      {
        connector: aws,
        expectedRevision: 3,
        partition,
        authority: memberAuthority(caller),
      },
    ],
    [
      "remove",
      { name: aws.name, partition, authority: memberAuthority(caller) },
    ],
  ]);
});

test("each refusal of the store is answered by its own result", async () => {
  for (const [written, result] of [
    [
      { outcome: "Stale", standing: 4 },
      { result: "Stale", standing: 4 },
    ],
    [{ outcome: "Stale" }, { result: "Stale" }],
    [{ outcome: "LimitReached" }, { result: "LimitReached" }],
    [{ outcome: "ProjectAbsent" }, { result: "NotFound" }],
    [
      { outcome: "Changed", revision: 5 },
      { result: "Changed", standing: { connector: aws, revision: 5 } },
    ],
  ] as const) {
    const { service } = administered(
      ["Administer"],
      scriptedStore({ written }),
    );
    assert.deepEqual(
      await service.written(caller, partition, { connector: aws }),
      result,
    );
  }
  for (const [removed, result] of [
    [
      { outcome: "Stale", standing: 4 },
      { result: "Stale", standing: 4 },
    ],
    [{ outcome: "Stale" }, { result: "Absent" }],
  ] as const) {
    const { service } = administered(
      ["Administer"],
      scriptedStore({ removed }),
    );
    assert.deepEqual(
      await service.removed(caller, partition, { name: aws.name }),
      result,
    );
  }
});

test("a full history page answers its oldest change as the next cursor, and a shorter one none", async () => {
  const full = Array.from({ length: connectorChangesPageMax }, (_, at) =>
    change(connectorChangesPageMax + 10 - at),
  );
  const store = scriptedStore({ changes: full });
  const { service } = administered(["Read"], store);
  const page = await service.history(caller, partition, 500);
  assert.equal(page.result, "Found");
  assert.equal(page.result === "Found" ? page.next : undefined, 11);
  assert.deepEqual(store.asked, [["changes", partition, 500]]);
  const last = await administered(
    ["Read"],
    scriptedStore({ changes: full.slice(1) }),
  ).service.history(caller, partition);
  assert.deepEqual(last, { result: "Found", changes: full.slice(1) });
});
