/**
 * The access token an accepted operation came through: both columns written
 * onto the row, neither for a person, and outside the idempotency scope.
 *
 * A KEY OFFERED THROUGH A TOKEN AND AGAIN AT THE CONSOLE IS ITS MAKER RETRYING,
 * since the token acts as its maker: the scope stays the tenant, the project,
 * the authority kind and the key digest, so the second finds the first.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresOperationInbox } from "../../src/adapters/postgres/operationInbox.ts";
import { accessTokenNameCharsMaxAt212 } from "../../src/adapters/postgres/schema/migrations/212-operation-via-token.ts";
import { apiRole } from "../../src/adapters/postgres/schema/shared.ts";
import { accessTokenNameCharsMax } from "../../src/contract/accessToken.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { id } from "../domain/fixtures.ts";
import {
  postgresHarnessKeying,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  postgresHarnessSubmission,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let api: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  api = postgresHarnessRolePool(apiRole);
});
after(async () => {
  await api.end();
  await harness.close();
});

interface Recorded {
  readonly via_session: string | null;
  readonly via_token: string | null;
  readonly via_token_name: string | null;
}

/** What the row of `operation` says it came through. */
async function recorded(
  partition: Partition,
  operation: string,
): Promise<Recorded> {
  const rows = (await harness.query(
    `SELECT via_session, via_token, via_token_name FROM operation
      WHERE tenant=$1 AND project=$2 AND operation=$3`,
    [partition.tenant, partition.project, operation],
  )) as unknown as readonly Recorded[];
  const row = rows[0];
  if (row === undefined)
    throw new Error(`via token: no operation ${operation}`);
  return row;
}

function through(name: string) {
  return { token: randomUUID(), name };
}

test("an operation submitted through a token records the token and its name", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "token-carried",
  );
  const submission = postgresHarnessSubmission(partition, "token-carried");
  const viaToken = through("nightly");
  assert.equal(
    (await harness.inbox.accept({ ...submission, viaToken })).accepted,
    "Accepted",
  );
  assert.deepEqual(await recorded(partition, submission.operation), {
    via_session: null,
    via_token: viaToken.token,
    via_token_name: "nightly",
  });
});

test("an operation submitted by a person alone records neither", async () => {
  const partition = await postgresHarnessProject(harness.store, "token-none");
  const submission = postgresHarnessSubmission(partition, "token-none");
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  assert.deepEqual(await recorded(partition, submission.operation), {
    via_session: null,
    via_token: null,
    via_token_name: null,
  });
});

test("one key through a token and then at the console is one operation, and it is the first", async () => {
  const partition = await postgresHarnessProject(harness.store, "token-retry");
  const submission = postgresHarnessSubmission(partition, "token-retry");
  const viaToken = through("retried");
  assert.equal(
    (await harness.inbox.accept({ ...submission, viaToken })).accepted,
    "Accepted",
  );
  assert.equal((await harness.inbox.accept(submission)).accepted, "Original");
  assert.deepEqual(await recorded(partition, submission.operation), {
    via_session: null,
    via_token: viaToken.token,
    via_token_name: "retried",
  });
});

test("a dispatch through a token records it too, by the other door", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "token-dispatch",
  );
  const submission = postgresHarnessSubmission(partition, "token-dispatch");
  const viaToken = through("dispatcher");
  const dispatch = {
    ...submission,
    command: {
      version: 1,
      command: "ManualDispatch",
      ticket: id(1),
      expectedTicketVersion: 1,
    } as const,
    viaToken,
  };
  assert.equal((await harness.inbox.accept(dispatch)).accepted, "Accepted");
  assert.deepEqual(await recorded(partition, submission.operation), {
    via_session: null,
    via_token: viaToken.token,
    via_token_name: "dispatcher",
  });
});

/**
 * The API's pool with each acceptance call made as a caller of the earlier
 * parameter list makes it, its last two arguments left off, and every call so
 * made counted.
 */
function earlierCaller(pool: pg.Pool, made: string[]): pg.Pool {
  const trailing = /,\$15,\$16\)$/u;
  const narrowed = (text: string, values: unknown) => {
    if (!/accept_(dispatch_)?operation\(/u.test(text) || !trailing.test(text))
      return undefined;
    made.push(text);
    return {
      text: text.replace(trailing, ")"),
      values: (values as readonly unknown[]).slice(0, -2),
    };
  };
  return new Proxy(pool, {
    get: (target, property) => {
      if (property !== "connect")
        return Reflect.get(target, property) as unknown;
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get: (held, name) => {
            if (name !== "query") return Reflect.get(held, name) as unknown;
            return (query: unknown, ...rest: unknown[]) => {
              if (typeof query === "object" && query !== null) {
                const { text, values } = query as {
                  text: string;
                  values: unknown;
                };
                const earlier = narrowed(text, values);
                if (earlier !== undefined) return held.query(earlier);
              }
              return (held.query as (...args: unknown[]) => unknown)(
                query,
                ...rest,
              );
            };
          },
        });
      };
    },
  });
}

test("a call of the earlier parameter list is still accepted at both doors, and records no token", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "token-earlier",
  );
  const made: string[] = [];
  const inbox = postgresOperationInbox(
    earlierCaller(api, made),
    postgresHarnessKeying(),
  );
  const accepting = postgresHarnessSubmission(partition, "token-earlier");
  assert.equal((await inbox.accept(accepting)).accepted, "Accepted");
  const dispatching = {
    ...postgresHarnessSubmission(partition, "token-earlier-dispatch"),
    command: {
      version: 1,
      command: "ManualDispatch",
      ticket: id(1),
      expectedTicketVersion: 1,
    } as const,
  };
  assert.equal((await inbox.accept(dispatching)).accepted, "Accepted");
  assert.equal(made.length, 2, "both doors were called the earlier way");
  for (const operation of [accepting.operation, dispatching.operation])
    assert.deepEqual(await recorded(partition, operation), {
      via_session: null,
      via_token: null,
      via_token_name: null,
    });
});

test("the row refuses a token without its name, a token beside a session, and an identity the mint never draws", async () => {
  const partition = await postgresHarnessProject(harness.store, "token-checks");
  const submission = postgresHarnessSubmission(partition, "token-checks");
  assert.equal(
    (
      await harness.inbox.accept({
        ...submission,
        viaToken: through("checked"),
      })
    ).accepted,
    "Accepted",
  );
  const set = (assignment: string, values: readonly unknown[]) =>
    harness.query(
      `UPDATE operation SET ${assignment}
        WHERE tenant=$1 AND project=$2 AND operation=$3`,
      [partition.tenant, partition.project, submission.operation, ...values],
    );
  await assert.rejects(
    set("via_token_name=NULL", []),
    /operation_via_token_is_named/u,
  );
  await assert.rejects(
    set("via_token=$4", ["not-a-token"]),
    /operation_via_token_is_drawn/u,
  );
  await assert.rejects(
    set("via_token_name=$4", ["n".repeat(accessTokenNameCharsMax + 1)]),
    /operation_via_token_name_is_bounded/u,
  );
  await assert.rejects(
    set("via_session=$4", ["session"]),
    /operation_via_one_bearer/u,
  );
});

test("the row bounds a token's name where the contract bounds it", () => {
  assert.equal(accessTokenNameCharsMaxAt212, accessTokenNameCharsMax);
});
