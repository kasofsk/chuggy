import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresDispatchViews } from "../../src/adapters/postgres/dispatchViews.ts";
import { postgresNotifications } from "../../src/adapters/postgres/notifications.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  apiRole,
  boundaryOwnerRole,
  dispatchAcceptanceFunction,
  selectorControlRole,
  selectorProjectSettingsFunction,
  selectorReviewRole,
  selectorServiceRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { decisionSemanticsVersionCurrent } from "../../src/actor/decisionSemantics.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import { phaseOf } from "../../src/domain/phase.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { notificationPageLimitMax } from "../../src/interpreter/notifications.ts";
import type { DecisionInput } from "../../src/interpreter/projectDiscovery.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessHistory,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessReleaseSubmission,
  postgresHarnessSubmission,
  postgresHarnessUrl,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

function postgresRolePool(role: string) {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${role}`);
  return postgresPool(url.toString());
}

test("the API role reads a released ticket from the current dispatch view", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-view");
  const memory = await postgresHarnessHistory(harness, partition, "i5-view", 1);
  const pool = postgresRolePool(apiRole);
  try {
    const page = await postgresDispatchViews(pool).read(partition, {
      limit: 10,
    });
    assert.equal(page.result, "Page");
    assert.ok(page.result === "Page");
    assert.equal(page.token.watermark, memory.lease.head);
    assert.equal(page.candidates.length, 1);
    assert.equal(page.candidates[0]?.ticketVersion, memory.lease.head);
    assert.match(page.token.digest, /^[0-9a-f]{64}$/);
  } finally {
    await pool.end();
  }
});

test("a proposal carrying the current strict view dispatches", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-proposal");
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    "i5-proposal",
    1,
  );
  const pool = postgresPool(postgresHarnessUrl());
  try {
    const page = await postgresDispatchViews(pool).read(partition, {
      limit: 10,
    });
    assert.ok(page.result === "Page");
    const candidate = page.candidates[0];
    assert.ok(candidate !== undefined);
    const base = postgresHarnessSubmission(partition, "i5-proposal");
    const accepted = await harness.inbox.accept({
      ...base,
      command: {
        version: 1,
        command: "ProposeDispatch",
        ticket: candidate.ticket,
        expectedTicketVersion: candidate.ticketVersion,
        observedViewToken: page.token,
        selectorDecisionReference: "selector-decision",
      },
    });
    assert.equal(accepted.accepted, "Accepted");
    const input = await harness.discovery.next(partition);
    assert.ok(input !== undefined);
    const result = await projectWriterDecide(
      postgresHarnessWriter(harness),
      memory,
      input,
    );
    assert.equal(result.decided.decided, "Committed");
  } finally {
    await pool.end();
  }
});

/** A dispatch proposal fenced on a version its ticket does not stand at, accepted and awaiting the writer. */
async function i5StaleProposal(
  partition: Partition,
  page: Extract<
    Awaited<ReturnType<ReturnType<typeof postgresDispatchViews>["read"]>>,
    { result: "Page" }
  >,
  candidate: { readonly ticket: number; readonly ticketVersion: number },
): Promise<DecisionInput> {
  const accepted = await harness.inbox.accept({
    ...postgresHarnessSubmission(partition, "i5-refused-moves"),
    command: {
      version: 1,
      command: "ProposeDispatch",
      ticket: asTicketId(candidate.ticket),
      expectedTicketVersion: candidate.ticketVersion + 1,
      observedViewToken: page.token,
      selectorDecisionReference: "i5-refused-moves-decision",
    },
  });
  assert.equal(accepted.accepted, "Accepted");
  const input = await harness.discovery.next(partition, 300);
  if (input === undefined)
    throw new Error("i5: the accepted proposal reached no writer");
  return input;
}

/**
 * The change-driven runtime gives a project a turn only where its notification
 * log moved past the cursor its last turn stood on, so a decision whose every
 * dispatch the writer refuses must leave a row there or the lead is never asked
 * again. It does, because a refused operation is settled and published in the
 * deciding transaction exactly as a journaled one is.
 */
test("a refused proposal moves the project its lead's next turn waits on", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-refused-moves",
  );
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    "i5-refused-moves",
    1,
  );
  const pool = postgresPool(postgresHarnessUrl());
  try {
    const page = await postgresDispatchViews(pool).read(partition, {
      limit: 10,
    });
    assert.ok(page.result === "Page");
    const candidate = page.candidates[0];
    assert.ok(candidate !== undefined);
    const notifications = postgresNotifications(pool);
    const standing = await notifications.read(partition, {
      after: 0,
      limit: notificationPageLimitMax,
    });
    assert.ok(standing.result === "Events");
    const input = await i5StaleProposal(partition, page, candidate);
    const decided = await projectWriterDecide(
      postgresHarnessWriter(harness),
      memory,
      input,
    );
    assert.equal(
      decided.decided.decided,
      "Refused",
      "a version the ticket does not stand at is what the fence refuses",
    );
    const moved = await notifications.read(partition, {
      after: standing.cursor,
      limit: notificationPageLimitMax,
    });
    assert.ok(moved.result === "Events");
    assert.deepEqual(
      moved.events.map((event) => event.kind),
      ["Operation"],
      "the refusal is what the lead's next turn is triggered by",
    );
    assert.equal(
      moved.events[0]?.resource,
      input.source.kind === "Operation" ? input.source.operation : undefined,
      "and it names the operation the proposal was submitted under",
    );
    assert.equal(
      phaseOf(ticketAt(decided.memory.graph, candidate.ticket).state),
      "Pending",
      "a refused dispatch leaves its ticket where the lead will see it again",
    );
  } finally {
    await pool.end();
  }
});

test("manual and agentic dispatch race by ordinary journal order", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-dispatch-race",
  );
  let memory = await postgresHarnessHistory(
    harness,
    partition,
    "i5-dispatch-race",
    1,
  );
  const pool = postgresPool(postgresHarnessUrl());
  try {
    const page = await postgresDispatchViews(pool).read(partition, {
      limit: 10,
    });
    assert.ok(page.result === "Page");
    const candidate = page.candidates[0];
    assert.ok(candidate !== undefined);
    const manual = postgresHarnessSubmission(partition, "i5-race-manual");
    const proposal = postgresHarnessSubmission(partition, "i5-race-proposal");
    assert.equal(
      (
        await harness.inbox.accept({
          ...manual,
          command: {
            version: 1,
            command: "ManualDispatch",
            ticket: candidate.ticket,
            expectedTicketVersion: candidate.ticketVersion,
          },
        })
      ).accepted,
      "Accepted",
    );
    assert.equal(
      (
        await harness.inbox.accept({
          ...proposal,
          command: {
            version: 1,
            command: "ProposeDispatch",
            ticket: candidate.ticket,
            expectedTicketVersion: candidate.ticketVersion,
            observedViewToken: page.token,
            selectorDecisionReference: "selector-racing-manual",
          },
        })
      ).accepted,
      "Accepted",
    );
    const writer = postgresHarnessWriter(harness);
    const first = await harness.discovery.next(partition);
    assert.ok(first !== undefined);
    const dispatched = await projectWriterDecide(writer, memory, first);
    assert.equal(dispatched.decided.decided, "Committed");
    memory = dispatched.memory;
    const dispatchedHead = memory.lease.head;

    const second = await harness.discovery.next(partition);
    assert.ok(second !== undefined);
    const staleChoice = await projectWriterDecide(writer, memory, second);
    assert.equal(staleChoice.decided.decided, "Refused");
    assert.equal(staleChoice.memory.lease.head, dispatchedHead);
  } finally {
    await pool.end();
  }
});

/** Releases a second independent ticket, so one observed page carries two candidates. */
async function i5TwoReleased(
  partition: Partition,
  label: string,
): Promise<ProjectMemory> {
  const writer = postgresHarnessWriter(harness);
  const memory = await postgresHarnessHistory(harness, partition, label, 1);
  const second = await postgresHarnessReleaseSubmission(
    harness,
    partition,
    `${label}-second`,
  );
  assert.equal((await harness.inbox.accept(second)).accepted, "Accepted");
  const release = await harness.discovery.next(partition, 300);
  assert.ok(release !== undefined);
  const released = await projectWriterDecide(writer, memory, release);
  assert.equal(released.decided.decided, "Committed");
  return released.memory;
}

test("one decision's proposals over the same observed page each dispatch", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-several");
  const writer = postgresHarnessWriter(harness);
  let memory = await i5TwoReleased(partition, "i5-several");
  const pool = postgresPool(postgresHarnessUrl());
  try {
    const page = await postgresDispatchViews(pool).read(partition, {
      limit: 10,
    });
    assert.ok(page.result === "Page");
    assert.equal(page.candidates.length, 2);
    for (const candidate of page.candidates) {
      const accepted = await harness.inbox.accept({
        ...postgresHarnessSubmission(
          partition,
          `i5-several-${String(candidate.ticket)}`,
        ),
        command: {
          version: 1,
          command: "ProposeDispatch",
          ticket: candidate.ticket,
          expectedTicketVersion: candidate.ticketVersion,
          observedViewToken: page.token,
          selectorDecisionReference: "i5-several-decision",
        },
      });
      assert.equal(accepted.accepted, "Accepted");
    }
    const journaled: number[] = [];
    for (let delivered = 0; delivered < page.candidates.length; delivered++) {
      const input = await harness.discovery.next(partition, 300);
      assert.ok(input !== undefined);
      const step = await projectWriterDecide(writer, memory, input);
      assert.equal(step.decided.decided, "Committed");
      memory = step.memory;
      journaled.push(memory.lease.head);
    }
    assert.deepEqual(
      page.candidates.map((candidate) =>
        phaseOf(ticketAt(memory.graph, candidate.ticket).state),
      ),
      ["Work", "Work"],
    );
    const rows = await harness.query(
      `SELECT seq, decision_semantics_version
         FROM journal_entry
        WHERE tenant = $1 AND project = $2 AND seq = ANY($3::bigint[])
        ORDER BY seq`,
      [partition.tenant, partition.project, journaled],
    );
    assert.deepEqual(
      rows.map((row) => row["decision_semantics_version"]),
      journaled.map(() => decisionSemanticsVersionCurrent),
    );
  } finally {
    await pool.end();
  }
});

test("dispatch acceptance refuses every command the wire parser cannot read", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-invalid-dispatch",
  );
  const pool = postgresPool(postgresHarnessUrl());
  const token = {
    ...partition,
    recoveryEpoch: "epoch",
    schemaVersion: 1,
    watermark: 0,
    digest: "a".repeat(64),
  };
  const commands = [
    {
      version: 1,
      command: "ManualDispatch",
      ticket: 1,
      expectedTicketVersion: 9_007_199_254_740_992,
    },
    {
      version: 1,
      command: "ProposeDispatch",
      ticket: 1,
      expectedTicketVersion: 1,
      observedViewToken: { ...token, recoveryEpoch: "" },
      selectorDecisionReference: "decision",
    },
    {
      version: 1,
      command: "ProposeDispatch",
      ticket: 1,
      expectedTicketVersion: 1,
      observedViewToken: { ...token, watermark: -1 },
      selectorDecisionReference: "decision",
    },
  ];
  try {
    for (const [index, command] of commands.entries()) {
      const found = await pool.query<{ result: string }>(
        `SELECT result FROM ${dispatchAcceptanceFunction}(
          $1,$2,$3,'User','subject','v1',$4,$5,ARRAY[]::text[],ARRAY[]::text[],$6,10,100,NULL)`,
        [
          partition.tenant,
          partition.project,
          `invalid-${String(index)}`,
          `key-${String(index)}`,
          `payload-${String(index)}`,
          JSON.stringify(command),
        ],
      );
      assert.equal(found.rows[0]?.result, "InvalidCommand");
    }
  } finally {
    await pool.end();
  }
});

/**
 * Every definer this slice re-created, with the roles it answers to: a drop
 * takes the owner, the `search_path` pin, the revoke and the grants with it,
 * `CREATE OR REPLACE` drops the pin the same way by taking everything but the
 * owner and the privileges from the new command, and a re-create that loses
 * one of them is world-executable or is resolved under the caller's path. The
 * pin is the arm no functional case can find, because an unpinned definer
 * answers an ordinary caller exactly as a pinned one does and differs only for
 * one that has shadowed a relation in `pg_temp`.
 */
const i5SliceDefiners: readonly (readonly [
  string,
  string,
  readonly string[],
])[] = [
  [
    selectorProjectSettingsFunction,
    "text,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text,text,text,text,text",
    [apiRole],
  ],
];

const i5SelectorRoles = [
  apiRole,
  selectorServiceRole,
  selectorControlRole,
  selectorReviewRole,
  ticketServiceRole,
];

test("each definer this slice re-created is owned, pinned, world-revoked and granted where it was", async () => {
  for (const [name, signature, granted] of i5SliceDefiners) {
    const identity = `${name}(${signature})`;
    assert.deepEqual(
      await harness.query(
        `SELECT prosecdef AS definer,pg_get_userbyid(proowner) AS owner,
                array_to_string(proconfig,',') AS settings,
                EXISTS(SELECT 1 FROM aclexplode(proacl) entry
                        WHERE entry.grantee=0) AS world
           FROM pg_proc WHERE oid=$1::regprocedure`,
        [identity],
      ),
      [
        {
          definer: true,
          owner: boundaryOwnerRole,
          settings: "search_path=pg_catalog, public, pg_temp",
          world: false,
        },
      ],
      identity,
    );
    for (const role of i5SelectorRoles)
      assert.deepEqual(
        await harness.query(
          `SELECT has_function_privilege($1,$2::regprocedure,'EXECUTE') AS held`,
          [role, identity],
        ),
        [{ held: granted.includes(role) }],
        `${identity} to ${role}`,
      );
  }
});
