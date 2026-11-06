/**
 * The boundary of a project's epics: every read reauthorizes before it reaches
 * the store, and a write asks for `Mutate` and tells a reader without it from
 * a caller who cannot see the project.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { nativeEpicMethods } from "../../src/interpreter/epics.ts";
import type { EpicStore } from "../../src/interpreter/epicStore.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const member = asPrincipal("issuer-member");
const content = {
  title: "the footer",
  description: "",
  visibility: "Active",
  tickets: [],
} as const;

function boundary(kinds: readonly ProjectAccessKind[]) {
  const calls: string[] = [];
  const access = memoryProjectAccess();
  access.grant({ partition, principal: member, access: new Set(kinds) });
  const store: EpicStore = {
    save: (_partition, command, actor) => {
      calls.push(`save:${command.kind}:${actor.subject}`);
      return Promise.resolve({ kind: "Saved", epic: 1, revision: 1 });
    },
    list: () => {
      calls.push("list");
      return Promise.resolve({ epics: [] });
    },
    view: (_partition, epic) => {
      calls.push(`view:${String(epic)}`);
      return Promise.resolve(undefined);
    },
    history: () => {
      calls.push("history");
      return Promise.resolve({ revisions: [] });
    },
    graph: () => {
      calls.push("graph");
      return Promise.resolve({ nodes: [], edges: [] });
    },
  };
  return { calls, web: nativeEpicMethods(access, store) };
}

test("a reader reads the list, the history and the graph, and an absent epic is not found", async () => {
  const { calls, web } = boundary(["Read"]);

  assert.deepEqual(await web.epics(member, partition, { limit: 20 }), {
    result: "Found",
    value: { epics: [] },
  });
  assert.equal(
    (await web.epicHistory(member, partition, 1, { limit: 20 })).result,
    "Found",
  );
  assert.equal((await web.epicGraph(member, partition, 1)).result, "Found");
  assert.deepEqual(await web.epic(member, partition, 9), {
    result: "NotFound",
  });
  assert.deepEqual(calls, ["list", "history", "graph", "view:9"]);
});

test("a caller who may not read the project reaches no store, on a read or a write", async () => {
  const { calls, web } = boundary([]);

  assert.deepEqual(await web.epics(member, partition, { limit: 20 }), {
    result: "NotFound",
  });
  assert.deepEqual(await web.epic(member, partition, 1), {
    result: "NotFound",
  });
  assert.deepEqual(
    await web.writeEpic(member, partition, { kind: "Create", content }),
    { result: "NotFound" },
  );
  assert.deepEqual(calls, []);
});

test("a reader without Mutate is forbidden a write and the store is not asked", async () => {
  const { calls, web } = boundary(["Read"]);

  assert.deepEqual(
    await web.writeEpic(member, partition, { kind: "Create", content }),
    { result: "Forbidden" },
  );
  assert.deepEqual(calls, []);
});

test("a caller holding Mutate saves as the authority that granted it", async () => {
  const { calls, web } = boundary(["Read", "Mutate"]);

  const written = await web.writeEpic(member, partition, {
    kind: "Create",
    content,
  });

  assert.deepEqual(written, {
    result: "Decided",
    outcome: { kind: "Saved", epic: 1, revision: 1 },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0] ?? "", /^save:Create:/u);
});

test("an unconfigured store is a composition fault and not an answer", async () => {
  const access = memoryProjectAccess();
  access.grant({ partition, principal: member, access: new Set(["Read"]) });
  const web = nativeEpicMethods(access);

  await assert.rejects(
    web.epics(member, partition, { limit: 20 }),
    /no epic store/u,
  );
});
