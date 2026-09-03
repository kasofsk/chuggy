/**
 * The selector's production source: what the runtime asks the API, and with
 * which cursor.
 *
 * THE TRIGGER IS THE SLICE'S HEADLINE AND IT IS ONE READ. `moved` is the
 * runtime's name for the notification read, and both names must reach the one
 * authorized call with the cursor the project's last turn stood on — a source
 * that answered a constant, or always read from the start, would let every
 * quiet project take a turn while every suite over doubles stayed green.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { selectorNativeSource } from "../../src/interpreter/selectorNativeSource.ts";
import type {
  NotificationBatch,
  NotificationCursor,
} from "../../src/interpreter/notifications.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const principal = asPrincipal("selector");

const environment = {
  currentTimeEpochMs: () => Promise.resolve(0),
  currentInstant: () => Promise.resolve("2026-09-02T12:00:00.000Z"),
  decisionDeadline: () => new Promise<never>(() => undefined),
  operationalContext: () =>
    Promise.reject(new Error("no context was asked for")),
};

function nativeReads(page: NotificationBatch) {
  const asked: { partition: Partition; cursor: NotificationCursor }[] = [];
  const source = selectorNativeSource(
    {
      projectInventory: () => Promise.reject(new Error("unused")),
      notifications: (_principal, scope, cursor) => {
        asked.push({ partition: scope, cursor });
        return Promise.resolve({ result: "Authorized", value: page } as const);
      },
      dispatchView: () => Promise.reject(new Error("unused")),
      operation: () => Promise.reject(new Error("unused")),
      submit: () => Promise.reject(new Error("unused")),
    },
    principal,
    environment,
  );
  return { source, asked };
}

const movedPage: NotificationBatch = {
  result: "Events",
  cursor: 41,
  events: [{ ordinal: 41, kind: "Ticket", resource: "7" }],
};

test("the trigger reads from the cursor it is given, not from the start", async () => {
  const { source, asked } = nativeReads(movedPage);
  assert.deepEqual(await source.moved(partition, 40, 25), movedPage);
  assert.deepEqual(asked, [{ partition, cursor: { after: 40, limit: 25 } }]);
});

test("the trigger answers what the project's log says and never a constant", async () => {
  const unmoved: NotificationBatch = {
    result: "Events",
    cursor: 40,
    events: [],
  };
  assert.deepEqual(
    await nativeReads(unmoved).source.moved(partition, 40, 25),
    unmoved,
    "a project that did not move must answer that it did not",
  );
  assert.deepEqual(
    await nativeReads({ result: "Reset", cursor: 9 }).source.moved(
      partition,
      40,
      25,
    ),
    { result: "Reset", cursor: 9 },
  );
});

test("both names are the one authorized read", async () => {
  const { source, asked } = nativeReads(movedPage);
  await source.moved(partition, 40, 25);
  await source.notifications(partition, { after: 40, limit: 25 });
  assert.deepEqual(
    asked.map((ask) => ask.cursor),
    [
      { after: 40, limit: 25 },
      { after: 40, limit: 25 },
    ],
    "reading the page twice under two names would let a row land between them",
  );
});

test("a project the selector may not read is inaccessible, not empty", async () => {
  const source = selectorNativeSource(
    {
      projectInventory: () => Promise.reject(new Error("unused")),
      notifications: () => Promise.resolve({ result: "NotFound" } as const),
      dispatchView: () => Promise.reject(new Error("unused")),
      operation: () => Promise.reject(new Error("unused")),
      submit: () => Promise.reject(new Error("unused")),
    },
    principal,
    environment,
  );
  await assert.rejects(
    source.moved(partition, 40, 25),
    /project notifications/u,
    "an unreadable project must not look like a quiet one",
  );
});
