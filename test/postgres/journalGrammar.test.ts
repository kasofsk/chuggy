/**
 * What the journal, the inbox and the mailbox admit at the installed schema,
 * and the release index a read is answered from.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptanceFunction,
  apiRole,
  finalizationFunction,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import type pg from "pg";
import { postgresHarnessEpoch, postgresHarnessProject } from "./harness.ts";
import { postgresProjectStore } from "../../src/adapters/postgres/projectStore.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import type { ProjectRead } from "../../src/interpreter/nativeWeb.ts";
import { allRefusalCodes } from "../../src/interpreter/refusal.ts";
import {
  commandsBoundaryRefusals,
  commandsRefusal,
  commandsRefusals,
  commandsRefuse,
  deletionJournalRow,
  deletionPartition,
  journalledRevocation,
  migratedDatabase,
  releasedEvaluatorDefinition,
  releasedTask,
  releasedWhole,
  releasedWorkDefinition,
  ticketCreated,
  createdProposingDraft,
  seedProposingBinding,
} from "./migrationHarness.ts";

const journalInstantsReleases = 400;

/**
 * Each event the case journals, the value it carries and the key its ticket is
 * at: a release beside two events that name a ticket without releasing one.
 */
const journalInstantsEvents: readonly (readonly [string, unknown, string])[] = [
  [
    "TicketCreated",
    {
      id: 0,
      content: 1,
      dependencies: [],
      workConfiguration: {
        workload: 1,
        inputs: 1,
        executionRequirements: 1,
        resultContract: 1,
      },
      evaluationPlan: { stages: [] },
      finalizationConfiguration: 1,
    },
    "id",
  ],
  ["TicketDispatched", { ticket: 0, source: 1 }, "ticket"],
  [
    "TicketFinalizationSucceeded",
    { ticket: 0, workCycle: 1, generation: 1, evidence: 1 },
    "ticket",
  ],
];

function releasedPage(read: ProjectRead): readonly (string | undefined)[] {
  if (read.result !== "Found")
    throw new Error("migration case: the project has no page");
  return read.project.tickets.map((ticket) => ticket.releasedAt);
}

async function seedReleasedTickets(
  subject: pg.Pool,
  partition: { readonly tenant: string; readonly project: string },
  epoch: string,
): Promise<void> {
  const kinds = journalInstantsEvents
    .map(
      ([type, value, key], step) =>
        `(${String(step)},'${type}','${JSON.stringify(value)}'::jsonb,'${key}')`,
    )
    .join(",");
  const entries = journalInstantsReleases * journalInstantsEvents.length;
  await subject.query("BEGIN");
  await subject.query(
    `INSERT INTO decision_input
       (tenant,project,ordinal,input_kind,input_id,base_priority,
        lifecycle_generation,state,decided_seq,terminal_at)
     SELECT $1,$2,k.step*$3+n,'Operation','entry-'||(k.step*$3+n),
            'Ordinary',1,'Journaled',k.step*$3+n,now()
       FROM generate_series(1,$3::bigint) n,
            (VALUES ${kinds}) AS k(step,type,value,key)`,
    [partition.tenant, partition.project, journalInstantsReleases],
  );
  await subject.query(
    `INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id)
     SELECT $1,$2,k.step*$3+n,
       jsonb_build_object('seq',k.step*$3+n,'event',jsonb_build_object(
         'type',k.type,'value',jsonb_set(k.value,ARRAY[k.key],to_jsonb(n))))::text,
       'digest-'||(k.step*$3+n),'previous-'||(k.step*$3+n),'owner',1,$4,
       'Operation','entry-'||(k.step*$3+n)
       FROM generate_series(1,$3::bigint) n,
            (VALUES ${kinds}) AS k(step,type,value,key)`,
    [partition.tenant, partition.project, journalInstantsReleases, epoch],
  );
  await subject.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
     SELECT $1,$2,n,'Pending',n FROM generate_series(1,$3::bigint) n`,
    [partition.tenant, partition.project, journalInstantsReleases],
  );
  await subject.query(
    "UPDATE project SET head=$3 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project, entries],
  );
  await subject.query("COMMIT");
  await subject.query("ANALYZE journal_entry");
}

async function releaseIndexUse(
  subject: pg.Pool,
): Promise<{ scans: number; tuples: number }> {
  const found = await subject.query<{ scans: string; tuples: string }>(
    `SELECT idx_scan::text AS scans, idx_tup_read::text AS tuples
       FROM pg_stat_all_indexes
      WHERE relname='journal_entry'
        AND indexrelname='journal_entry_release_ticket'`,
  );
  const row = found.rows[0];
  if (row === undefined)
    throw new Error("migration case: there is no release index to use");
  return { scans: Number(row.scans), tuples: Number(row.tuples) };
}

/**
 * At the installed schema and no vintage: 013 re-renders the release index
 * over the key the payload now carries, and these reads spell the same key, so
 * a case pinned behind it would ask the adapter for a field no row holds.
 */
test("the release index is what answers every read of a ticket's release", async () => {
  await migratedDatabase("journal_instants_index", async (subject, url) => {
    const store = postgresProjectStore(subject);
    const epoch = await postgresHarnessEpoch(store);
    const partition = await postgresHarnessProject(store, "journal-instants");
    await seedReleasedTickets(subject, partition, epoch);
    const single = postgresPool(url, {
      connectionsMax: 1,
      connectionWaitMs: 5_000,
      statementTimeoutMs: 10_000,
    });
    const reads = postgresNativeReads(single);
    try {
      for (const [what, read] of [
        [
          "the ticket's own read",
          async () => [(await reads.ticket(partition, asTicketId(1)))?.phase],
        ],
        [
          "the page in identity order",
          async () =>
            releasedPage(await reads.project(partition, { limit: 10 })),
        ],
        [
          "the page in recent-activity order",
          async () =>
            releasedPage(
              await reads.project(partition, {
                limit: 10,
                order: "RecentActivity",
              }),
            ),
        ],
      ] as const) {
        const before = await releaseIndexUse(subject);
        const listed = await read();
        assert.ok(listed.length >= 1, `${what} listed no ticket`);
        for (const each of listed)
          assert.ok(each !== undefined, `${what} left a ticket unread`);
        await single.query("SELECT pg_stat_force_next_flush()");
        assert.ok(
          (await releaseIndexUse(subject)).scans > before.scans,
          `${what} was answered without the index that exists for it`,
        );
      }
      const before = await releaseIndexUse(subject);
      assert.ok(
        (await reads.ticket(partition, asTicketId(1)))?.releasedAt !==
          undefined,
        "the ticket read carries the release instant",
      );
      await single.query("SELECT pg_stat_force_next_flush()");
      const after = await releaseIndexUse(subject);
      assert.ok(
        after.tuples - before.tuples <= 1,
        `one ticket's release cost ${String(after.tuples - before.tuples)} entries out of the index, so it was scanned for rather than looked up`,
      );
    } finally {
      await single.end();
    }
  });
});

/** Every escalation a parked ticket may carry, and one the machine has never had. */
const escalationKinds = [
  "NoEscalation",
  "WorkFailureEscalated",
  "WorkExecutionUnavailableEscalated",
  "EvaluationFailureEscalated",
  "EvaluationBlockedEscalated",
  "FinalizationUnavailableEscalated",
] as const;

const escalationUnknown = "ReworkBudgetExhausted";

test("the projection carries one escalation and no name off its roster", async () => {
  await migratedDatabase("escalation_projection", async (subject) => {
    await subject.query(deletionPartition);
    for (const [index, kind] of escalationKinds.entries())
      await subject.query(
        `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,escalation)
         VALUES('tenant-5','project-5',$1,'Escalated',1,$2)`,
        [index + 1, kind],
      );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT escalation FROM ticket_projection ORDER BY ticket",
        )
      ).rows,
      escalationKinds.map((escalation) => ({ escalation })),
    );
    await assert.rejects(
      subject.query(
        `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,escalation)
         VALUES('tenant-5','project-5',90,'Escalated',1,$1)`,
        [escalationUnknown],
      ),
      /ticket_projection_escalation_is_known/u,
    );
    await subject.query(
      `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
       VALUES('tenant-5','project-5',94,'Pending',1)`,
    );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT escalation,escalation_evidence FROM ticket_projection WHERE ticket=94",
        )
      ).rows,
      [{ escalation: "NoEscalation", escalation_evidence: null }],
      "a ticket nothing parked carries the escalation that is none",
    );
  });
});

test("the desk task takes the projection's roster and keeps the arm its settled rows are at", async () => {
  await migratedDatabase("escalation_desk", async (subject) => {
    await subject.query(
      `${deletionPartition}\n${deletionJournalRow(1, journalledRevocation)}`,
    );
    const task = async (escalation: string, state: string): Promise<void> => {
      await subject.query(
        `INSERT INTO native_action
           (tenant,project,action,authorizing_seq,effect_position,ticket,
            action_version,kind,escalation,required_capability,state)
         VALUES('tenant-5','project-5','action-1',1,0,1,1,'TicketEscalation',
                $1,'ResolveTicket',$2)`,
        [escalation, state],
      );
      await subject.query("DELETE FROM native_action");
    };
    for (const kind of escalationKinds) await task(kind, "Open");
    await task("DependencyRevoked", "Withdrawn");
    await assert.rejects(
      task("DependencyRevoked", "Open"),
      /native_action_escalation_check/u,
      "the settled arm is the settled rows' and no live row reaches it",
    );
    await assert.rejects(
      task(escalationUnknown, "Withdrawn"),
      /native_action_escalation_check/u,
    );
  });
});

test("the projection admits evidence only beside an escalation, and the desk reads it", async () => {
  await migratedDatabase("escalation_evidence", async (subject) => {
    await subject.query(deletionPartition);
    await assert.rejects(
      subject.query(
        `INSERT INTO ticket_projection
           (tenant,project,ticket,phase,seq,escalation,escalation_evidence)
         VALUES('tenant-5','project-5',91,'Work',1,'NoEscalation','RuntimeVersionUnsupported')`,
      ),
      /ticket_projection_evidence_needs_an_escalation/u,
    );
    await subject.query(
      `INSERT INTO ticket_projection
         (tenant,project,ticket,phase,seq,escalation,escalation_evidence)
       VALUES('tenant-5','project-5',92,'Escalated',1,
              'WorkExecutionUnavailableEscalated','RuntimeVersionUnsupported'),
             ('tenant-5','project-5',93,'Escalated',1,
              'EvaluationFailureEscalated',NULL)`,
    );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT escalation_evidence FROM ticket_projection WHERE ticket IN (92,93) ORDER BY ticket",
        )
      ).rows,
      [
        { escalation_evidence: "RuntimeVersionUnsupported" },
        { escalation_evidence: null },
      ],
      "evidence is what an escalation may carry, not what it must",
    );
    for (const [role, privilege, table, column] of [
      [apiRole, "SELECT", "ticket_projection", "escalation"],
      [apiRole, "SELECT", "ticket_projection", "escalation_evidence"],
      [ticketServiceRole, "UPDATE", "ticket_projection", "escalation"],
      [ticketServiceRole, "UPDATE", "ticket_projection", "escalation_evidence"],
      [ticketServiceRole, "SELECT", "execution", "completion_operation"],
      [ticketServiceRole, "SELECT", "execution", "blocked_reason"],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            `SELECT has_column_privilege($1,'public.${table}',$2,$3) AS granted`,
            [role, column, privilege],
          )
        ).rows[0]?.granted,
        true,
        `${role} ${privilege} ${table}.${column}`,
      );
  });
});

function releasedEvent(value: unknown): unknown {
  return { type: "CreateTicket", value };
}

const releasedObligation = {
  task: releasedTask,
  definition: releasedWorkDefinition,
  contextRef: 3,
};

function releasedCompletion(report: unknown): unknown {
  return {
    type: "TaskDone",
    value: { ticket: 1, task: releasedTask, report },
  };
}

/** The evaluator obligation a produced evaluation report below carries. */
const eventsEvaluatorObligation = {
  task: {
    type: "EvaluationTask",
    value: { ticket: 1, workCycle: 2, stage: 1, generation: 1, evaluator: 3 },
  },
  definition: releasedEvaluatorDefinition,
  contextRef: 9,
};

function eventsEvaluated(verdict: string): unknown {
  return {
    type: "EvaluationResultReport",
    value: {
      result: { obligation: eventsEvaluatorObligation, resultRef: 11 },
      verdict,
    },
  };
}

const eventsBlocked = {
  type: "TerminalFailureReport",
  value: {
    failure: { task: eventsEvaluatorObligation.task, evidence: 4 },
    kind: "ExecutionUnavailableFailure",
  },
};

const eventsRework = [{ evaluator: 3, resultRef: 11 }];

const eventsFinalization = {
  ticket: 1,
  workCycle: 2,
  generation: 1,
  evidence: 6,
};

/** Every event a journal row may carry, one per arm, and the rows it may not. */
const eventsJournalled: readonly (readonly [string, unknown, boolean])[] = [
  ["TicketCreated", ticketCreated(releasedWhole), true],
  [
    "TicketDispatched",
    { type: "TicketDispatched", value: { ticket: 1, source: 7 } },
    true,
  ],
  ["TicketRevoked", { type: "TicketRevoked", value: 1 }, true],
  ["TicketWorkResumed", { type: "TicketWorkResumed", value: 1 }, true],
  [
    "TicketEvaluationResumed",
    { type: "TicketEvaluationResumed", value: 1 },
    true,
  ],
  [
    "TicketFinalizationResumed",
    { type: "TicketFinalizationResumed", value: 1 },
    true,
  ],
  [
    "TicketWorkResultAccepted",
    {
      type: "TicketWorkResultAccepted",
      value: {
        ticket: 1,
        result: { obligation: releasedObligation, resultRef: 5 },
        acceptedSourceRef: 7,
      },
    },
    true,
  ],
  [
    "TicketWorkProcessFailed",
    {
      type: "TicketWorkProcessFailed",
      value: { ticket: 1, task: releasedTask, evidence: 2 },
    },
    true,
  ],
  [
    "TicketWorkExecutionUnavailable",
    {
      type: "TicketWorkExecutionUnavailable",
      value: { ticket: 1, task: releasedTask, evidence: 2 },
    },
    true,
  ],
  [
    "TicketEvaluationProgressed",
    {
      type: "TicketEvaluationProgressed",
      value: { ticket: 1, report: eventsEvaluated("EvaluatorPass") },
    },
    true,
  ],
  [
    "TicketEvaluationPassed",
    {
      type: "TicketEvaluationPassed",
      value: { ticket: 1, report: eventsEvaluated("EvaluatorPass") },
    },
    true,
  ],
  [
    "TicketEvaluationReworkStarted",
    {
      type: "TicketEvaluationReworkStarted",
      value: {
        ticket: 1,
        report: eventsEvaluated("EvaluatorFail"),
        evidence: eventsRework,
      },
    },
    true,
  ],
  [
    "TicketEvaluationFailureEscalated",
    {
      type: "TicketEvaluationFailureEscalated",
      value: {
        ticket: 1,
        report: eventsEvaluated("EvaluatorFail"),
        evidence: eventsRework,
      },
    },
    true,
  ],
  [
    "TicketEvaluationBlocked",
    {
      type: "TicketEvaluationBlocked",
      value: { ticket: 1, report: eventsBlocked },
    },
    true,
  ],
  [
    "TicketFinalizationSucceeded",
    { type: "TicketFinalizationSucceeded", value: eventsFinalization },
    true,
  ],
  [
    "TicketFinalizationNeedsWork",
    { type: "TicketFinalizationNeedsWork", value: eventsFinalization },
    true,
  ],
  [
    "TicketFinalizationUnavailable",
    { type: "TicketFinalizationUnavailable", value: eventsFinalization },
    true,
  ],
  [
    "a command-shaped completion",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: { obligation: releasedObligation, resultRef: 5 },
        acceptedSourceRef: 7,
      },
    }),
    false,
  ],
  ["a command's release", releasedEvent(releasedWhole), false],
  [
    "a dispatch at the source no source is",
    { type: "TicketDispatched", value: { ticket: 1, source: 0 } },
    false,
  ],
  ["a revocation of no ticket", { type: "TicketRevoked", value: 0 }, false],
  [
    "a finalization fact about no ticket",
    {
      type: "TicketFinalizationSucceeded",
      value: { ...eventsFinalization, ticket: 0 },
    },
    false,
  ],
  [
    "a finalization fact at no evidence",
    {
      type: "TicketFinalizationNeedsWork",
      value: { ...eventsFinalization, evidence: 0 },
    },
    false,
  ],
  [
    "a finalization fact with no evidence",
    {
      type: "TicketFinalizationUnavailable",
      value: { ...eventsFinalization, evidence: undefined },
    },
    false,
  ],
  [
    "a work failure at no evidence",
    {
      type: "TicketWorkProcessFailed",
      value: { ticket: 1, task: releasedTask, evidence: 0 },
    },
    false,
  ],
  [
    "a work failure with no evidence",
    {
      type: "TicketWorkExecutionUnavailable",
      value: { ticket: 1, task: releasedTask },
    },
    false,
  ],
  [
    "a release with no work definition",
    ticketCreated({ ...releasedWhole, workConfiguration: undefined }),
    false,
  ],
  [
    "an accepted work result at no source",
    {
      type: "TicketWorkResultAccepted",
      value: {
        ticket: 1,
        result: { obligation: releasedObligation, resultRef: 5 },
      },
    },
    false,
  ],
  [
    "an accepted work result whose obligation has no definition",
    {
      type: "TicketWorkResultAccepted",
      value: {
        ticket: 1,
        result: {
          obligation: { ...releasedObligation, definition: undefined },
          resultRef: 5,
        },
        acceptedSourceRef: 7,
      },
    },
    false,
  ],
  [
    "a work failure of a task at cycle zero",
    {
      type: "TicketWorkProcessFailed",
      value: {
        ticket: 1,
        task: { type: "WorkTask", value: { ticket: 1, cycle: 0 } },
        evidence: 2,
      },
    },
    false,
  ],
  [
    "an evaluator's report at a verdict nobody gives",
    {
      type: "TicketEvaluationPassed",
      value: { ticket: 1, report: eventsEvaluated("EvaluatorAbstains") },
    },
    false,
  ],
  [
    "a block whose failure names no kind",
    {
      type: "TicketEvaluationBlocked",
      value: {
        ticket: 1,
        report: {
          ...eventsBlocked,
          value: { failure: eventsBlocked.value.failure },
        },
      },
    },
    false,
  ],
  [
    "a block whose failure names no task",
    {
      type: "TicketEvaluationBlocked",
      value: {
        ticket: 1,
        report: {
          ...eventsBlocked,
          value: { ...eventsBlocked.value, failure: { evidence: 4 } },
        },
      },
    },
    false,
  ],
  [
    "a block in the spelling that named no task",
    {
      type: "TicketEvaluationBlocked",
      value: {
        ticket: 1,
        report: {
          ...eventsBlocked,
          value: { evidence: 4, kind: "ExecutionUnavailableFailure" },
        },
      },
    },
    false,
  ],
  [
    "a rework that names no evidence",
    {
      type: "TicketEvaluationReworkStarted",
      value: { ticket: 1, report: eventsEvaluated("EvaluatorFail") },
    },
    false,
  ],
  [
    "an escalation whose evidence is empty",
    {
      type: "TicketEvaluationFailureEscalated",
      value: {
        ticket: 1,
        report: eventsEvaluated("EvaluatorFail"),
        evidence: [],
      },
    },
    false,
  ],
  [
    "a rework whose evidence names no evaluator",
    {
      type: "TicketEvaluationReworkStarted",
      value: {
        ticket: 1,
        report: eventsEvaluated("EvaluatorFail"),
        evidence: [{ evaluator: 0, resultRef: 11 }],
      },
    },
    false,
  ],
  [
    "a finalization fact at no generation",
    {
      type: "TicketFinalizationSucceeded",
      value: { ...eventsFinalization, generation: undefined },
    },
    false,
  ],
];

/** Journals one entry at seq 1 and takes it back, answering whether the journal admitted it. */
async function eventsAdmitted(
  subject: pg.Pool,
  entry: string,
): Promise<boolean> {
  const client = await subject.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(deletionJournalRow(1, entry));
      return true;
    } catch (error: unknown) {
      assert.match(
        String(error),
        /is not its sequence and one ticket event/u,
        "a row the journal refuses is refused by the journal's own check",
      );
      return false;
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
  }
}

test("a journal row is its own sequence and one event, and nothing beside them", async () => {
  await migratedDatabase("events_entry", async (subject) => {
    await subject.query(deletionPartition);
    const event = { type: "TicketRevoked", value: 1 };
    for (const [label, entry, admitted] of [
      ["an event at its sequence", { seq: 1, event }, true],
      [
        "an event beside the record of deciding it",
        {
          seq: 1,
          event,
          rec: { label: "ticket-revoked", transitions: [], effects: [] },
        },
        false,
      ],
      ["an entry at another sequence", { seq: 2, event }, false],
      ["an entry with no event", { seq: 1 }, false],
    ] as const)
      assert.equal(
        await eventsAdmitted(subject, JSON.stringify(entry)),
        admitted,
        label,
      );
    assert.equal(await eventsAdmitted(subject, "not json"), false, "text");
  });
});

test("the ticket service journals through the check without holding the validator", async () => {
  await migratedDatabase("events_writer", async (subject) => {
    await subject.query(deletionPartition);
    const journalled = (entry: string) =>
      `INSERT INTO journal_entry
         (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
          recovery_epoch,cause_kind,cause_id)
       VALUES('tenant-5','project-5',1,$entry$${entry}$entry$,'digest-1','genesis',
              'owner',1,'epoch-5','Operation','operation-1')`;
    const client = await subject.connect();
    try {
      for (const [entry, admitted] of [
        [
          JSON.stringify({ seq: 1, event: { type: "Revoke", value: 1 } }),
          false,
        ],
        [journalledRevocation, true],
      ] as const) {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO decision_input
             (tenant,project,ordinal,input_kind,input_id,base_priority,
              lifecycle_generation,state,decided_seq,terminal_at)
           VALUES('tenant-5','project-5',1,'Operation','operation-1','Ordinary',
                  1,'Journaled',1,now())`,
        );
        await client.query(`SET LOCAL ROLE ${ticketServiceRole}`);
        if (admitted) {
          await client.query(journalled(entry));
          await client.query("COMMIT");
        } else {
          await assert.rejects(
            client.query(journalled(entry)),
            /is not its sequence and one ticket event/u,
          );
          await client.query("ROLLBACK");
        }
      }
    } finally {
      client.release();
    }
    assert.deepEqual(
      (
        await subject.query(
          `SELECT has_function_privilege($1,'public.decision_event_is_valid(jsonb)','EXECUTE') AS validator,
                  has_function_privilege($1,'public.journal_entry_is_an_event()','EXECUTE') AS check,
                  (SELECT count(*)::int FROM journal_entry) AS journalled`,
          [ticketServiceRole],
        )
      ).rows,
      [{ validator: false, check: false, journalled: 1 }],
    );
  });
});

test("a desk task is opened once per decision, whatever position it names", async () => {
  await migratedDatabase("events_desk", async (subject) => {
    await subject.query(
      `${deletionPartition}\n${deletionJournalRow(1, journalledRevocation)}`,
    );
    const desk = (action: string, position: number, ticket: number) =>
      subject.query(
        `INSERT INTO native_action
           (tenant,project,action,authorizing_seq,effect_position,ticket,
            action_version,kind,escalation,required_capability,state)
         VALUES('tenant-5','project-5',$1,1,$2,$3,1,'TicketEscalation',
                'WorkFailureEscalated','ResolveTicket','Withdrawn')`,
        [action, position, ticket],
      );
    await desk("action-1", 0, 1);
    await assert.rejects(
      desk("action-2", 1, 2),
      /native_action_decision_opens_one_desk/u,
      "a second desk task at the same decision, whatever position it names",
    );
  });
});

test("a decision input counts the passes it was deferred", async () => {
  await migratedDatabase("events_deferral", async (subject) => {
    await subject.query(deletionPartition);
    const input = (ordinal: number, kind: string, passes?: number) =>
      passes === undefined
        ? subject.query(
            `INSERT INTO decision_input
               (tenant,project,ordinal,input_kind,input_id,base_priority,
                lifecycle_generation)
             VALUES('tenant-5','project-5',$1,$2,$3,'Ordinary',1)`,
            [ordinal, kind, `input-${String(ordinal)}`],
          )
        : subject.query(
            `INSERT INTO decision_input
               (tenant,project,ordinal,input_kind,input_id,base_priority,
                lifecycle_generation,deferred_passes)
             VALUES('tenant-5','project-5',$1,$2,$3,'Ordinary',1,$4)`,
            [ordinal, kind, `input-${String(ordinal)}`, passes],
          );
    await input(1, "Operation");
    assert.deepEqual(
      (await subject.query("SELECT deferred_passes FROM decision_input")).rows,
      [{ deferred_passes: 0 }],
    );
    await assert.rejects(
      input(2, "Operation", -1),
      /decision_input_deferred_passes_are_counted/u,
    );
    await assert.rejects(
      input(3, "Continuation"),
      /decision_input_kind_is_known/u,
    );
    for (const column of ["deferred_passes"])
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_column_privilege($1,'public.decision_input',$2,'UPDATE') AS granted",
            [ticketServiceRole, column],
          )
        ).rows[0]?.granted,
        true,
        `${ticketServiceRole} bumps ${column}`,
      );
  });
});

/** How many releases the index case seeds, so a scan of them all is visible as one. */
const eventsIndexEntries = 400;

test("the release index answers a read at the one tag a release is journalled at", async () => {
  await migratedDatabase("events_index", async (subject) => {
    await subject.query(deletionPartition);
    await subject.query("BEGIN");
    await subject.query(
      `INSERT INTO decision_input
         (tenant,project,ordinal,input_kind,input_id,base_priority,
          lifecycle_generation,state,decided_seq,terminal_at)
       SELECT 'tenant-5','project-5',n,'Operation','entry-'||n,
              'Ordinary',1,'Journaled',n,now()
         FROM generate_series(1,$1::bigint) n`,
      [eventsIndexEntries],
    );
    await subject.query(
      `INSERT INTO journal_entry
         (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
          recovery_epoch,cause_kind,cause_id)
       SELECT 'tenant-5','project-5',n,
         jsonb_build_object('seq',n,'event',jsonb_build_object('type','TicketCreated',
           'value',jsonb_set($2::jsonb,'{id}',to_jsonb(n))))::text,
         'digest-'||n,'previous-'||n,'owner',1,'epoch-5','Operation','entry-'||n
         FROM generate_series(1,$1::bigint) n`,
      [eventsIndexEntries, JSON.stringify(releasedWhole)],
    );
    await subject.query("COMMIT");
    await subject.query("ANALYZE journal_entry");
    const before = await releaseIndexUse(subject);
    assert.equal(
      (
        await subject.query(
          `SELECT j.seq FROM journal_entry j
            WHERE j.tenant='tenant-5' AND j.project='project-5'
              AND (CASE WHEN j.entry IS JSON OBJECT
                        THEN j.entry::jsonb->'event'->>'type' END) = 'TicketCreated'
              AND (CASE WHEN j.entry IS JSON OBJECT
                        THEN j.entry::jsonb->'event'->'value'->'id' END)=to_jsonb(1)`,
        )
      ).rowCount,
      1,
    );
    await subject.query("SELECT pg_stat_force_next_flush()");
    const after = await releaseIndexUse(subject);
    assert.ok(
      after.scans > before.scans && after.tuples - before.tuples <= 1,
      `one release cost ${String(after.tuples - before.tuples)} entries out of the index, so it was scanned for rather than looked up`,
    );
  });
});

/**
 * The codes a refused input may carry are the writer's, read off the check
 * itself, so a code the writer gains or loses is a finding here before it is a
 * refused settlement.
 */
test("the refusal codes the inbox admits are exactly the ones the writer decides", async () => {
  await migratedDatabase("commands_codes", async (subject) => {
    const [row] = (
      await subject.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
          WHERE conname='decision_input_outcome_is_known'`,
      )
    ).rows;
    assert.ok(row !== undefined);
    assert.deepEqual(
      [...row.definition.matchAll(/'([A-Za-z]+)'::text/gu)]
        .map((match) => match[1])
        .sort(),
      [...allRefusalCodes].sort(),
    );
  });
});

/** A report as the package spells it, naming the ticket it is about when one is given. */
function commandsReport(
  report: { readonly type: string; readonly value: object },
  ticket?: number,
): unknown {
  return {
    type: report.type,
    value: ticket === undefined ? report.value : { ticket, ...report.value },
  };
}

const commandsWorkReport = {
  type: "WorkResultReport",
  value: {
    result: { obligation: releasedObligation, resultRef: 5 },
    acceptedSourceRef: 7,
  },
};

const commandsEvaluationReport = {
  type: "EvaluationResultReport",
  value: {
    result: { obligation: eventsEvaluatorObligation, resultRef: 11 },
    verdict: "EvaluatorFail",
  },
};

const commandsBlockedReport = {
  type: "TerminalFailureReport",
  value: eventsBlocked.value,
};

const commandsFailureReport = {
  type: "TerminalFailureReport",
  value: {
    failure: { task: releasedTask, evidence: 2 },
    kind: "ProcessFailure",
  },
};

/** The events that carry a report, each around the report it is given. */
const commandsReportEvents: readonly (readonly [
  string,
  { readonly type: string; readonly value: object },
  (report: unknown) => unknown,
])[] = [
  [
    "TicketEvaluationProgressed",
    commandsEvaluationReport,
    (report) => ({
      type: "TicketEvaluationProgressed",
      value: { ticket: 1, report },
    }),
  ],
  [
    "TicketEvaluationPassed",
    commandsEvaluationReport,
    (report) => ({
      type: "TicketEvaluationPassed",
      value: { ticket: 1, report },
    }),
  ],
  [
    "TicketEvaluationBlocked",
    commandsBlockedReport,
    (report) => ({
      type: "TicketEvaluationBlocked",
      value: { ticket: 1, report },
    }),
  ],
  [
    "TicketEvaluationReworkStarted",
    commandsEvaluationReport,
    (report) => ({
      type: "TicketEvaluationReworkStarted",
      value: { ticket: 1, report, evidence: eventsRework },
    }),
  ],
  [
    "TicketEvaluationFailureEscalated",
    commandsEvaluationReport,
    (report) => ({
      type: "TicketEvaluationFailureEscalated",
      value: { ticket: 1, report, evidence: eventsRework },
    }),
  ],
];

test("the journal takes a report only about the ticket its event is about", async () => {
  await migratedDatabase("commands_journal", async (subject) => {
    await subject.query(deletionPartition);
    for (const [tag, report, around] of commandsReportEvents)
      for (const [label, event, admitted] of [
        ["about its ticket", around(commandsReport(report, 1)), true],
        ["naming no ticket", around(commandsReport(report)), false],
        ["about another ticket", around(commandsReport(report, 2)), false],
        ["about no ticket", around(commandsReport(report, 0)), false],
      ] as const)
        assert.equal(
          await eventsAdmitted(subject, JSON.stringify({ seq: 1, event })),
          admitted,
          `${tag}: a report ${label}`,
        );
    for (const [label, event, admitted] of eventsJournalled)
      if (!JSON.stringify(event).includes('"report"'))
        assert.equal(
          await eventsAdmitted(subject, JSON.stringify({ seq: 1, event })),
          admitted,
          `as 014 admits it: ${label}`,
        );
  });
});

/** A `Decide` envelope around one ticket command, under the field it is carried at. */
function commandsDecide(command: unknown): string {
  return JSON.stringify({
    version: 1,
    command: "Decide",
    ticketCommand: command,
  });
}

const commandsFinalization = {
  ticket: 1,
  workCycle: 2,
  generation: 1,
  result: { type: "FinalizationNeedsWork", value: 6 },
};

/** What the grammar and the mailbox answer about each command, one per tag and each tag that left. */
const commandsTable: readonly (readonly [string, unknown, boolean, boolean])[] =
  [
    ["a release", { type: "CreateTicket", value: releasedWhole }, true, false],
    [
      "a dispatch",
      { type: "DispatchTicket", value: { ticket: 1, source: 9 } },
      true,
      false,
    ],
    ["a revocation", { type: "RevokeTicket", value: 1 }, true, true],
    ["a resume", { type: "ResumeTicket", value: 1 }, true, true],
    [
      "a work report",
      {
        type: "ReportTaskTerminal",
        value: commandsReport(commandsWorkReport, 1),
      },
      true,
      true,
    ],
    [
      "an evaluation report",
      {
        type: "ReportTaskTerminal",
        value: commandsReport(commandsEvaluationReport, 1),
      },
      true,
      true,
    ],
    [
      "a failure report",
      {
        type: "ReportTaskTerminal",
        value: commandsReport(commandsFailureReport, 1),
      },
      true,
      true,
    ],
    [
      "a report naming no ticket",
      { type: "ReportTaskTerminal", value: commandsReport(commandsWorkReport) },
      false,
      false,
    ],
    [
      "a report about no ticket",
      {
        type: "ReportTaskTerminal",
        value: commandsReport(commandsFailureReport, 0),
      },
      false,
      false,
    ],
    [
      "a finalization result",
      { type: "ReportFinalizationResult", value: commandsFinalization },
      true,
      false,
    ],
    [
      "a finalization result at no evidence",
      {
        type: "ReportFinalizationResult",
        value: {
          ...commandsFinalization,
          result: { type: "FinalizationSucceeded", value: 0 },
        },
      },
      false,
      false,
    ],
    [
      "a finalization result in an arm the package has none of",
      {
        type: "ReportFinalizationResult",
        value: {
          ...commandsFinalization,
          result: { type: "FinalizationFailed", value: 6 },
        },
      },
      false,
      false,
    ],
    [
      "a finalization result at no generation",
      {
        type: "ReportFinalizationResult",
        value: { ...commandsFinalization, generation: undefined },
      },
      false,
      false,
    ],
    [
      "a dispatch at no source",
      { type: "DispatchTicket", value: { ticket: 1, source: 0 } },
      false,
      false,
    ],
    [
      "a revocation of no ticket",
      { type: "RevokeTicket", value: 0 },
      false,
      false,
    ],
    ["the revocation's old tag", { type: "Revoke", value: 1 }, false, false],
    [
      "the dispatch's old tag",
      { type: "Dispatch", value: { ticket: 1, source: 9 } },
      false,
      false,
    ],
    [
      "the completion's old tag",
      releasedCompletion(commandsReport(commandsWorkReport, 1)),
      false,
      false,
    ],
    [
      "the finalization's old tag",
      {
        type: "FinalizationResult",
        value: { ticket: 1, out: "FinalizationSucceeded", evidence: 3 },
      },
      false,
      false,
    ],
    ["a ticket event", { type: "TicketRevoked", value: 1 }, false, false],
  ];

test("the inbox's grammar is the ticket commands, and both exclusions hold at their names", async () => {
  await migratedDatabase("commands_grammar", async (subject) => {
    for (const [label, command, grammar, mailbox] of commandsTable)
      assert.deepEqual(
        (
          await subject.query<{ grammar: boolean; mailbox: boolean }>(
            `SELECT decision_command_is_valid($1::jsonb) AS grammar,
                    ticket_command_is_valid($2::jsonb) AS mailbox`,
            [JSON.stringify(command), commandsDecide(command)],
          )
        ).rows,
        [{ grammar, mailbox }],
        label,
      );
    const revocation = { type: "RevokeTicket", value: 1 };
    for (const [label, envelope] of [
      [
        "a command under the field an event was carried at",
        { version: 1, command: "Decide", event: revocation },
      ],
      [
        "a command beside an event",
        {
          version: 1,
          command: "Decide",
          ticketCommand: revocation,
          event: revocation,
        },
      ],
    ] as const)
      assert.deepEqual(
        (
          await subject.query<{ mailbox: boolean }>(
            "SELECT ticket_command_is_valid($1::jsonb) AS mailbox",
            [JSON.stringify(envelope)],
          )
        ).rows,
        [{ mailbox: false }],
        label,
      );
  });
});

/** One overrides change as a principal's envelope stores it, with whatever a case changes. */
function overridesEnvelope(
  changed: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    version: 1,
    command: "ChangeTicketOverrides",
    ticket: 1,
    action: "action-5",
    authorizingSeq: 1,
    overrides: { worker: { setup: ["npm ci"] } },
    ...changed,
  });
}

test("a principal's overrides change names a ticket and an action, carries its overrides as an object, and nothing else", async () => {
  await migratedDatabase("overrides_envelope", async (subject) => {
    const valid = async (envelope: string) =>
      (
        await subject.query<{ valid: boolean }>(
          "SELECT public_ticket_command_is_valid($1::jsonb) AS valid",
          [envelope],
        )
      ).rows[0]?.valid;
    assert.equal(await valid(overridesEnvelope()), true);
    for (const changed of [
      { overrides: ["npm ci"] },
      { ticket: 0 },
      { action: "" },
      { resolution: "Resume" },
    ])
      assert.equal(
        await valid(overridesEnvelope(changed)),
        false,
        JSON.stringify(changed),
      );
  });
});

test("the boundary admits neither a handoff outcome nor a handoff resolution", async () => {
  await migratedDatabase("nohandoff_boundary", async (subject) => {
    await assert.rejects(
      subject.query(
        `SELECT * FROM ${finalizationFunction}(
           'tenant-3','project-3','request-3','attempt-3','PromotionAccepted',
           NULL,1,'epoch-3','operation-3','finalizer')`,
      ),
      /PromotionAccepted is not one this boundary submits/u,
    );
    const resolution = JSON.stringify({
      version: 1,
      command: "ResolveNativeAction",
      action: "action-3",
      authorizingSeq: 1,
      resolution: "RetryHandoff",
    });
    assert.deepEqual(
      (
        await subject.query<{ admitted: boolean }>(
          "SELECT public_ticket_command_is_valid($1::jsonb) AS admitted",
          [resolution],
        )
      ).rows,
      [{ admitted: false }],
    );
    assert.deepEqual(
      (
        await subject.query<{ result: string }>(
          `SELECT result FROM ${acceptanceFunction}(
             'tenant-3','project-3','operation-3','User','author','v1',
             'key-3','payload-3','{}'::text[],'{}'::text[],$1,10,20,NULL)`,
          [resolution],
        )
      ).rows,
      [{ result: "InvalidCommand" }],
    );
  });
});

/** What one acceptance door answered a user's command with. */
async function commandsAccepted(
  subject: pg.Pool,
  door: string,
  operation: string,
  command: string,
): Promise<unknown> {
  return (
    await subject.query(
      `SELECT result FROM ${door}('tenant-5','project-5',$1,'User','subject',
         'v1',$1,$1,ARRAY[$1]::text[],ARRAY[$1]::text[],$2,1000,2000,NULL)`,
      [operation, command],
    )
  ).rows[0];
}

/** How the mailbox classified one accepted operation. */
async function commandsClassified(
  subject: pg.Pool,
  operation: string,
): Promise<unknown> {
  return (
    await subject.query(
      `SELECT o.command_tag, o.admission, d.base_priority FROM operation o
         JOIN decision_input d ON d.input_id=o.operation WHERE o.operation=$1`,
      [operation],
    )
  ).rows;
}

test("the mailbox classifies at the new tags and a revocation keeps its priority", async () => {
  await migratedDatabase("commands_accept", async (subject) => {
    await subject.query(deletionPartition);
    const accepted = (door: string, operation: string, command: string) =>
      commandsAccepted(subject, door, operation, command);
    const classified = (operation: string) =>
      commandsClassified(subject, operation);
    for (const [operation, tag, priority, admission] of [
      ["operation-revoke", "RevokeTicket", "Safety", "CorrectnessReducing"],
      ["operation-resume", "ResumeTicket", "Ordinary", "Ordinary"],
    ] as const) {
      assert.deepEqual(
        await accepted(
          "accept_operation",
          operation,
          commandsDecide({ type: tag, value: 1 }),
        ),
        { result: "Accepted" },
        tag,
      );
      assert.deepEqual(
        await classified(operation),
        [{ command_tag: tag, admission, base_priority: priority }],
        tag,
      );
    }
    assert.deepEqual(
      await accepted(
        "accept_operation",
        "operation-report",
        commandsDecide({
          type: "ReportTaskTerminal",
          value: commandsReport(commandsFailureReport, 1),
        }),
      ),
      { result: "InvalidCommand" },
      "a report a caller offers",
    );
    assert.deepEqual(
      await accepted(
        "accept_dispatch_operation",
        "operation-dispatch",
        JSON.stringify({
          version: 1,
          command: "ManualDispatch",
          ticket: 1,
          expectedTicketVersion: 1,
        }),
      ),
      { result: "Accepted" },
      "a dispatch through its own door",
    );
    assert.deepEqual(await classified("operation-dispatch"), [
      {
        command_tag: "ManualDispatch",
        admission: "Ordinary",
        base_priority: "Ordinary",
      },
    ]);
  });
});

test("the authority a completion is admitted under follows the completion's tag", async () => {
  await migratedDatabase("commands_authority", async (subject) => {
    await subject.query(deletionPartition);
    const stored = (operation: string, authority: string, tag: string) =>
      subject.query(
        `INSERT INTO operation
           (tenant,project,operation,authority_kind,authority_subject,admission,
            key_version,key_digest,payload_digest,command,command_tag)
         VALUES('tenant-5','project-5',$1,$2,'author','CorrectnessReducing',
                'v1',$1,'payload-5','{}',$3)`,
        [operation, authority, tag],
      );
    for (const [tag, authority] of [
      ["ReportTaskTerminal", "ExecutionScheduler"],
      ["ReportFinalizationResult", "Finalizer"],
    ] as const) {
      await assert.rejects(
        stored(`operation-user-${tag}`, "User", tag),
        /operation_completion_authority_is_its_boundary/u,
        `${tag} from an authority that is not ${authority}`,
      );
      await stored(`operation-own-${tag}`, authority, tag);
    }
  });
});

const commandsKnown = "decision_input_outcome_is_known";

const commandsCarried = "decision_input_refusal_is_its_outcome";

/** What the refusal columns refuse, and the check that refuses it. */
const commandsRefused: readonly (readonly [
  string,
  string,
  string | null,
  string,
])[] = [
  ["the one word every refusal was", "NotEnabled", null, commandsKnown],
  ["a code nothing produces", "CommandUnreadable", null, commandsKnown],
  [
    "a machine refusal with nothing refused",
    "TicketNotFound",
    null,
    commandsCarried,
  ],
  [
    "a boundary refusal with a payload",
    "TicketChanged",
    commandsRefusal("TicketNotFound", 1),
    commandsCarried,
  ],
  ["a payload that is not json", "TicketNotFound", "not json", commandsCarried],
  [
    "a payload of another refusal",
    "TicketNotFound",
    commandsRefusal("TicketNotRevocable", 1),
    commandsCarried,
  ],
  [
    "a refusal about no ticket",
    "TicketNotFound",
    commandsRefusal("TicketNotFound", 0),
    commandsCarried,
  ],
  [
    "incomplete dependencies naming none",
    "DependenciesIncomplete",
    commandsRefusal("DependenciesIncomplete", { ticket: 1, dependencies: [] }),
    commandsCarried,
  ],
  [
    "missing dependencies naming one twice",
    "DependenciesNotFound",
    commandsRefusal("DependenciesNotFound", {
      ticket: 1,
      dependencies: [2, 2],
    }),
    commandsCarried,
  ],
  [
    "missing dependencies naming no ticket",
    "DependenciesNotFound",
    commandsRefusal("DependenciesNotFound", { ticket: 1, dependencies: [0] }),
    commandsCarried,
  ],
  [
    "a stale revision naming no current one",
    "TicketRevisionStale",
    commandsRefusal("TicketRevisionStale", { ticket: 1, expected: 2 }),
    commandsCarried,
  ],
  [
    "a task not current naming no task",
    "TaskNotCurrent",
    commandsRefusal("TaskNotCurrent", {
      ticket: 1,
      task: { type: "WorkTask", value: { ticket: 1, cycle: 0 } },
    }),
    commandsCarried,
  ],
  [
    "an evaluation not current about no ticket",
    "EvaluationNotCurrent",
    commandsRefusal("EvaluationNotCurrent", { workCycle: 2 }),
    commandsCarried,
  ],
  [
    "a finalization not current at no generation",
    "FinalizationNotCurrent",
    commandsRefusal("FinalizationNotCurrent", { ticket: 1, workCycle: 2 }),
    commandsCarried,
  ],
  [
    "a finalization not current about no ticket",
    "FinalizationNotCurrent",
    commandsRefusal("FinalizationNotCurrent", { workCycle: 2, generation: 1 }),
    commandsCarried,
  ],
  [
    "revoked dependencies naming none",
    "DependenciesRevoked",
    commandsRefusal("DependenciesRevoked", { ticket: 1, dependencies: [] }),
    commandsCarried,
  ],
  [
    "a cycle about no ticket",
    "DependencyCycle",
    commandsRefusal("DependencyCycle", { dependencies: [2] }),
    commandsCarried,
  ],
  [
    "the code an update moving the dependencies was refused under",
    "TicketDependenciesChanged",
    commandsRefusal("TicketDependenciesChanged", 1),
    commandsKnown,
  ],
];

test("a refused input keeps the refusal the machine decided and none for the boundary's own", async () => {
  await migratedDatabase("commands_refusals", async (subject) => {
    await subject.query(deletionPartition);
    let ordinal = 0;
    for (const [code, value] of commandsRefusals)
      assert.equal(
        await commandsRefuse(
          subject,
          ++ordinal,
          code,
          commandsRefusal(code, value),
        ),
        null,
        code,
      );
    for (const code of commandsBoundaryRefusals)
      assert.equal(
        await commandsRefuse(subject, ++ordinal, code, null),
        null,
        code,
      );
    for (const [label, code, refusal, check] of commandsRefused) {
      const refused = await commandsRefuse(subject, ++ordinal, code, refusal);
      assert.ok(refused?.includes(check), `${label}: ${String(refused)}`);
    }
  });
});

test("the ticket service settles a refusal through the check, and the api reads it", async () => {
  await migratedDatabase("commands_refusal_writer", async (subject) => {
    await subject.query(deletionPartition);
    await subject.query(
      `INSERT INTO decision_input
         (tenant,project,ordinal,input_kind,input_id,base_priority,lifecycle_generation)
       VALUES('tenant-5','project-5',1,'Operation','input-1','Ordinary',1)`,
    );
    const settled = commandsRefusal("TicketNotFound", 1);
    const client = await subject.connect();
    const settle = (refusal: string | null) =>
      client.query(
        `UPDATE decision_input
            SET state='Refused', outcome_code='TicketNotFound', refusal=$1,
                refused_head=0, refused_lifecycle_generation=1, terminal_at=now()
          WHERE input_id='input-1'`,
        [refusal],
      );
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${ticketServiceRole}`);
      await assert.rejects(settle(null), new RegExp(commandsCarried, "u"));
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${ticketServiceRole}`);
      await settle(settled);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    assert.deepEqual(
      (
        await subject.query(
          `SELECT refusal,
                  has_column_privilege($1,'public.decision_input','refusal','SELECT') AS reads,
                  has_column_privilege($1,'public.decision_input','refusal','UPDATE') AS writes,
                  has_function_privilege($1,'public.decision_refusal_is_valid(text,text)','EXECUTE') AS executes,
                  has_function_privilege('public','public.decision_refusal_is_valid(text,text)','EXECUTE') AS anyone
             FROM decision_input`,
          [apiRole],
        )
      ).rows,
      [
        {
          refusal: settled,
          reads: true,
          writes: false,
          executes: false,
          anyone: false,
        },
      ],
    );
  });
});

/** An update of a ticket to the released ticket given, at a revision. */
function updateJournalled(
  revision: unknown,
  definition: unknown,
  ticket = 1,
): string {
  return JSON.stringify({
    seq: 1,
    event: { type: "TicketUpdated", value: { ticket, revision, definition } },
  });
}

test("the journal takes an update past the release's revision, about the ticket its definition names", async () => {
  await migratedDatabase("update_journal", async (subject) => {
    await subject.query(deletionPartition);
    const contentless: Record<string, unknown> = { ...releasedWhole };
    delete contentless["content"];
    for (const [label, entry, admitted] of [
      [
        "an update at the second revision",
        updateJournalled(2, releasedWhole),
        true,
      ],
      [
        "an update at a later revision",
        updateJournalled(7, releasedWhole),
        true,
      ],
      [
        "an update at the release's revision",
        updateJournalled(1, releasedWhole),
        false,
      ],
      ["an update at no revision", updateJournalled(0, releasedWhole), false],
      [
        "an update naming no revision",
        updateJournalled(undefined, releasedWhole),
        false,
      ],
      [
        "an update at a revision that is text",
        updateJournalled("2", releasedWhole),
        false,
      ],
      [
        "an update about another ticket than its definition names",
        updateJournalled(2, releasedWhole, 2),
        false,
      ],
      [
        "an update to a definition naming another ticket",
        updateJournalled(2, { ...releasedWhole, id: 2 }),
        false,
      ],
      [
        "an update to a definition that is not a released ticket",
        updateJournalled(2, contentless),
        false,
      ],
    ] as const)
      assert.equal(await eventsAdmitted(subject, entry), admitted, label);
  });
});

/** An update command, varied one field at a time. */
function updateCommand(value: Record<string, unknown>): unknown {
  return {
    type: "UpdateTicket",
    value: {
      ticket: 1,
      expectedRevision: 1,
      definition: releasedWhole,
      ...value,
    },
  };
}

test("the inbox's grammar takes an update at a revision it expects, and no Decide carries one", async () => {
  await migratedDatabase("update_grammar", async (subject) => {
    for (const [label, command, grammar] of [
      ["an update", updateCommand({}), true],
      [
        "an update expecting a later revision",
        updateCommand({ expectedRevision: 4 }),
        true,
      ],
      [
        "an update whose definition names another ticket",
        updateCommand({ definition: { ...releasedWhole, id: 2 } }),
        true,
      ],
      [
        "an update expecting no revision",
        updateCommand({ expectedRevision: 0 }),
        false,
      ],
      [
        "an update naming no expected revision",
        updateCommand({ expectedRevision: undefined }),
        false,
      ],
      ["an update of no ticket", updateCommand({ ticket: 0 }), false],
      [
        "an update in the spelling the release left",
        updateCommand({ definition: { ...releasedWhole, deps: [2] } }),
        false,
      ],
      [
        "an update to no definition",
        updateCommand({ definition: undefined }),
        false,
      ],
    ] as const)
      assert.deepEqual(
        (
          await subject.query<{ grammar: boolean; mailbox: boolean }>(
            `SELECT decision_command_is_valid($1::jsonb) AS grammar,
                    ticket_command_is_valid($2::jsonb) AS mailbox`,
            [JSON.stringify(command), commandsDecide(command)],
          )
        ).rows,
        [{ grammar, mailbox: false }],
        label,
      );
  });
});

/** The envelope a principal offers an update of draft 1 under, varied one field at a time. */
function updateEnvelope(value: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    command: "UpdateTicket",
    ticket: 1,
    expectedRevision: 1,
    authoringVersion: 1,
    configurationRevision: "revision-91",
    ...value,
  });
}

/** What the mailbox answered a user's command with, on the project the drafts are in. */
async function updateAccepted(
  subject: pg.Pool,
  operation: string,
  command: string,
): Promise<unknown> {
  return (
    await subject.query(
      `SELECT result FROM accept_operation('tenant-91','project-91',$1,'User','subject',
         'v1',$1,$1,ARRAY[$1]::text[],ARRAY[$1]::text[],$2,1000,2000,NULL)`,
      [operation, command],
    )
  ).rows[0];
}

test("a principal offers an update as its own envelope, classified ordinary against a draft revision that exists", async () => {
  await migratedDatabase("update_accept", async (subject) => {
    await seedProposingBinding(subject);
    assert.deepEqual(
      await createdProposingDraft(subject, "refs/heads/branch-91"),
      [{ result: "Created", ticket: "1" }],
    );
    assert.deepEqual(
      await updateAccepted(subject, "operation-update", updateEnvelope()),
      { result: "Accepted" },
    );
    assert.deepEqual(await commandsClassified(subject, "operation-update"), [
      {
        command_tag: "UpdateTicket",
        admission: "Ordinary",
        base_priority: "Ordinary",
      },
    ]);
    for (const [label, command] of [
      [
        "an update expecting no revision",
        updateEnvelope({ expectedRevision: 0 }),
      ],
      [
        "an update naming no expected revision",
        updateEnvelope({ expectedRevision: undefined }),
      ],
      [
        "an update at an authoring version the draft never had",
        updateEnvelope({ authoringVersion: 2 }),
      ],
      [
        "an update at a configuration the draft was not revised to",
        updateEnvelope({ configurationRevision: "revision-92" }),
      ],
      ["an update as a Decide", commandsDecide(updateCommand({}))],
    ] as const)
      assert.deepEqual(
        await updateAccepted(subject, `operation-${label}`, command),
        { result: "InvalidCommand" },
        label,
      );
  });
});
