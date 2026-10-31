/**
 * The project read's ticket page and the ticket read are planned below
 * `jit_above_cost` even in a session that has JIT on, so the pool's JIT
 * setting is not what keeps either from compiling.
 *
 * THE PLAN IS THE READ'S OWN. Each pooled client explains the statement the
 * read hands it that joins the per-ticket functions, with the read's own
 * parameters, before running it, so a case cannot drift from the statement the
 * route issues. The control restores the default estimate on those functions
 * inside a transaction it rolls back, and holds that the same statement then
 * carries a JIT block: a server that could not JIT would otherwise pass the
 * case for the wrong reason. The identity page is not controlled, because on
 * an empty projection its limit over the key's order is planned cheap at
 * either estimate, and neither is the searched page, whose rows are read by
 * identity once its positions are picked.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { ticketReadFunctionsAt103 } from "../../src/adapters/postgres/schema/migrations/103-ticket-reads-estimate-one-row.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { NativeReadStore } from "../../src/interpreter/nativeWeb.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessProject, postgresHarnessUrl } from "./harness.ts";
import { postgresReadHarness } from "./readHarness.ts";

const subject = postgresReadHarness();

/** A statement as `pg` is handed it by the read, which is a text and its parameters. */
interface ExplainedStatement {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** Whether a statement is the one that joins the per-ticket functions. */
function ticketReadPlanIsJoined(text: string): boolean {
  return text.includes("ticket_runner_loss(");
}

/** Whether an `EXPLAIN (FORMAT JSON)` answer carries the block a JIT-compiled plan does. */
function ticketReadPlanJits(explained: unknown): boolean {
  const plans = explained as readonly Record<string, unknown>[];
  return plans.some((plan) => "JIT" in plan);
}

/** One read a case plans, as a route issues it. */
interface TicketReadPlanned {
  readonly name: string;
  readonly read: (
    reads: NativeReadStore,
    partition: Partition,
  ) => Promise<unknown>;
  readonly controlled: boolean;
}

const ticketReadsPlanned: readonly TicketReadPlanned[] = [
  {
    name: "the identity page",
    read: (reads, partition) =>
      reads.project(partition, { order: "Identity", limit: 100 }),
    controlled: false,
  },
  {
    name: "the recent activity page",
    read: (reads, partition) =>
      reads.project(partition, { order: "RecentActivity", limit: 100 }),
    controlled: true,
  },
  {
    name: "the searched active page",
    read: (reads, partition) =>
      reads.project(partition, {
        order: "RecentActivity",
        limit: 100,
        search: "gate",
        active: true,
      }),
    controlled: false,
  },
  {
    name: "the ticket read",
    read: (reads, partition) => reads.ticket(partition, asTicketId(1)),
    controlled: true,
  },
];

/** A client's own `query`, as the wrapper around it issues statements. */
type TicketReadPlanIssue = (
  statement: unknown,
  values?: readonly unknown[],
) => Promise<pg.QueryResult>;

/** Explains `statement` into `explained` first where it is a joined statement the read built. */
async function ticketReadPlanExplained(
  issue: TicketReadPlanIssue,
  statement: unknown,
  explained: (ExplainedStatement & { plan: unknown })[],
): Promise<void> {
  if (
    typeof statement !== "object" ||
    statement === null ||
    !("text" in statement) ||
    !("values" in statement)
  )
    return;
  const { text, values } = statement as ExplainedStatement;
  if (!ticketReadPlanIsJoined(text)) return;
  const found = await issue(`EXPLAIN (FORMAT JSON) ${text}`, [...values]);
  explained.push({
    text,
    values,
    plan: (found.rows[0] as Record<string, unknown>)["QUERY PLAN"],
  });
}

/**
 * The joined statements one read issues through a pool whose every session
 * has JIT turned back on, each beside its plan.
 */
async function ticketReadPlanOf(
  planned: TicketReadPlanned,
): Promise<readonly (ExplainedStatement & { readonly plan: unknown })[]> {
  const partition = await postgresHarnessProject(subject.harness.store, "plan");
  const explained: (ExplainedStatement & { plan: unknown })[] = [];
  const pool = postgresPool(postgresHarnessUrl());
  pool.on("connect", (client) => {
    const issue = client.query.bind(client) as TicketReadPlanIssue;
    void issue("SET jit = on");
    (client as { query: unknown }).query = (
      statement: unknown,
      values?: readonly unknown[],
      answered?: (failure: Error | null, result?: pg.QueryResult) => void,
    ) => {
      const result = ticketReadPlanExplained(issue, statement, explained).then(
        () => issue(statement, values),
      );
      if (answered === undefined) return result;
      result.then(
        (found) => {
          answered(null, found);
        },
        (failure: unknown) => {
          answered(
            failure instanceof Error ? failure : new Error(String(failure)),
          );
        },
      );
      return undefined;
    };
  });
  try {
    await planned.read(postgresNativeReads(pool), partition);
  } finally {
    await pool.end();
  }
  return explained;
}

for (const planned of ticketReadsPlanned) {
  test(`${planned.name} compiles nothing in a session with JIT on`, async () => {
    const explained = await ticketReadPlanOf(planned);
    assert.equal(explained.length, 1, "the read issued one joined statement");
    for (const { plan } of explained)
      assert.equal(ticketReadPlanJits(plan), false, JSON.stringify(plan));
  });
}

for (const planned of ticketReadsPlanned.filter((each) => each.controlled)) {
  test(`${planned.name} at the default estimate would compile, which is what its case guards`, async () => {
    const [statement] = await ticketReadPlanOf(planned);
    assert.ok(statement !== undefined);
    const client = await subject.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL jit = on");
      for (const signature of ticketReadFunctionsAt103)
        await client.query(`ALTER FUNCTION ${signature} ROWS 1000`);
      const found = await client.query<{ "QUERY PLAN": unknown }>(
        `EXPLAIN (FORMAT JSON) ${statement.text}`,
        [...statement.values],
      );
      assert.equal(ticketReadPlanJits(found.rows[0]?.["QUERY PLAN"]), true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
}
