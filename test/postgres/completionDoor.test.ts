/**
 * What the completion door reports of a released ticket at the installed
 * schema, and the rows a release and a dispatch candidate hold.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import {
  deletionJournalRow,
  deletionPartition,
  identityExecution,
  journalledRevocation,
  migratedDatabase,
  releasedSecondDefinition,
  releasedSeeded,
  releasedWhole,
  releasedWorkDefinition,
  ticketCreated,
} from "./migrationHarness.ts";

/** What a candidate hangs from: the project's dispatch view and the revision it was cut against. */
const fanoutDispatchView = `
  INSERT INTO configuration_revision
    (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
  VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
  INSERT INTO dispatch_view(tenant,project,recovery_epoch,watermark,schema_version,digest)
  VALUES('tenant-5','project-5','epoch-5',1,1,repeat('a',64))`;

function fanoutCandidate(ticket: number, version: number): string {
  return `INSERT INTO dispatch_candidate
       (tenant,project,ticket,ticket_version,program,
        configuration_revision,configuration_digest,configuration_canonical)
     VALUES('tenant-5','project-5',${String(ticket)},${String(version)},'[]',
            'revision-5','digest-5','{}')`;
}

test("a candidate names a ticket and a version, each from one", async () => {
  await migratedDatabase("fanout_candidate", async (subject) => {
    await subject.query(`${deletionPartition}\n${fanoutDispatchView}`);
    await subject.query(fanoutCandidate(1, 1));
    for (const [what, ticket, version] of [
      ["a candidate for no ticket", 0, 1],
      ["a candidate at no version", 2, 0],
    ] as const)
      await assert.rejects(
        subject.query(fanoutCandidate(ticket, version)),
        /dispatch_candidate_check/u,
        what,
      );
  });
});

/** What a request task hangs from: a journalled decision, a revision and the request it authorized. */
const identityRequest = `${deletionJournalRow(1, journalledRevocation)};
  INSERT INTO configuration_revision
    (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
  VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
  INSERT INTO input_bundle(tenant,project,bundle,digest)
  VALUES('tenant-5','project-5','bundle-5',repeat('b',64));
  INSERT INTO execution_request
    (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
     kind,capacity_account,configuration_revision,configuration_digest,
     input_bundle,input_bundle_digest)
  SELECT 'tenant-5','project-5','request-5',1,0,1,1,'SpawnWork',a.account,
         'revision-5','digest-5','bundle-5',repeat('b',64)
    FROM capacity_account a
   WHERE a.account=project_capacity_account('tenant-5','project-5')`;

function identityTask(task: number, columns: string, values: string): string {
  return `INSERT INTO execution_request_task(tenant,project,request,task,${columns})
     VALUES('tenant-5','project-5','request-5',${String(task)},${values})`;
}

/** Every shape an identity can arrive in, and what the relation answers it. */
const identityShapes: readonly (readonly [
  string,
  string,
  string,
  RegExp | undefined,
])[] = [
  ["a work task naming its cycle", "kind,cycle", "'Work',1", undefined],
  [
    "an evaluation naming the whole of one",
    "kind,cycle,stage,generation,evaluator",
    "'Evaluation',1,1,1,1",
    undefined,
  ],
  ["a task naming no cycle at all", "kind", "'Work'", /cycle/u],
  [
    "a work task at a cycle of none",
    "kind,cycle",
    "'Work',0",
    /execution_request_task_check/u,
  ],
  [
    "a work task that also names a stage",
    "kind,cycle,stage",
    "'Work',1,1",
    /execution_request_task_check/u,
  ],
  [
    "a work task that also names a generation",
    "kind,cycle,generation",
    "'Work',1,1",
    /execution_request_task_check/u,
  ],
  [
    "a work task that also names an evaluator",
    "kind,cycle,evaluator",
    "'Work',1,1",
    /execution_request_task_check/u,
  ],
  [
    "an evaluation at the stage index this column used to take",
    "kind,cycle,stage,generation,evaluator",
    "'Evaluation',1,0,1,1",
    /execution_request_task_check/u,
  ],
  [
    "an evaluation naming no stage",
    "kind,cycle,generation,evaluator",
    "'Evaluation',1,1,1",
    /execution_request_task_check/u,
  ],
  [
    "an evaluation naming no generation",
    "kind,cycle,stage,evaluator",
    "'Evaluation',1,1,1",
    /execution_request_task_check/u,
  ],
  [
    "an evaluation naming no evaluator",
    "kind,cycle,stage,generation",
    "'Evaluation',1,1,1",
    /execution_request_task_check/u,
  ],
];

test("a request task carries a whole identity for its kind and no half of one", async () => {
  await migratedDatabase("identity_columns", async (subject) => {
    await subject.query(`${deletionPartition}\n${identityRequest}`);
    for (const [
      order,
      [what, columns, values, refused],
    ] of identityShapes.entries()) {
      const insert = identityTask(order + 1, columns, values);
      if (refused === undefined) await subject.query(insert);
      else await assert.rejects(subject.query(insert), refused, what);
    }
  });
});

/** Every source the relation admits an execution under, and the one no task names any more. */
const identitySources: readonly (readonly [string, string, boolean])[] = [
  ["a requirement a task named for itself", "ExplicitTask", false],
  ["a requirement its kind named", "TaskKindDefault", true],
  ["a requirement its ticket named", "TicketDefault", true],
  ["the platform's requirement", "PlatformDefault", true],
];

function identityRegistration(task: number, source: string): string {
  return `INSERT INTO execution
     (tenant,project,execution,ticket,task,source_request,account,cluster,
      configuration_revision,configuration_digest,requirement_identity,
      requirement_value,requirement_digest,requirement_source,
      platform_default_version,status)
   SELECT 'tenant-5','project-5','execution-${source}',1,${String(task)},'request-5',
          a.account,a.cluster,'revision-5','digest-5','requirement-${source}',
          '{"mode":"Container","operatingSystem":"Linux","architecture":"Amd64","image":"worker"}'::jsonb,
          repeat('e',64),'${source}',1,'Running'
     FROM capacity_account a
    WHERE a.account=project_capacity_account('tenant-5','project-5')`;
}

test("an execution registered under a requirement a task named is refused", async () => {
  await migratedDatabase("identity_sources", async (subject) => {
    await subject.query(`${deletionPartition}\n${identityRequest}`);
    await subject.query(identityTask(1, "kind,cycle", "'Work',1"));
    for (const evaluator of [1, 2, 3]) {
      await subject.query(
        identityTask(
          evaluator + 1,
          "kind,cycle,stage,generation,evaluator",
          `'Evaluation',1,1,1,${String(evaluator)}`,
        ),
      );
    }
    for (const [order, [what, source, admitted]] of identitySources.entries()) {
      const insert = identityRegistration(order + 1, source);
      if (admitted) await subject.query(insert);
      else
        await assert.rejects(
          subject.query(insert),
          /execution_requirement_source_known/u,
          what,
        );
    }
  });
});

/** Each row the two relations a release fills admit, and each half one they refuse. */
const releasedRows: readonly (readonly [string, string, boolean])[] = [
  [
    "a definition materialized for the ticket that was released",
    `INSERT INTO ticket_definition(tenant,project,ticket,definition,digest)
     VALUES('tenant-5','project-5',1,'{"image":"worker"}','digest-1')`,
    true,
  ],
  [
    "a definition for the ticket no ticket is",
    `INSERT INTO ticket_definition(tenant,project,ticket,definition,digest)
     VALUES('tenant-5','project-5',0,'{}','digest-0')`,
    false,
  ],
  [
    "a definition that is a document rather than the material it names",
    `INSERT INTO ticket_definition(tenant,project,ticket,definition,digest)
     VALUES('tenant-5','project-5',2,'"worker"','digest-2')`,
    false,
  ],
  [
    "a definition nothing can be addressed by",
    `INSERT INTO ticket_definition(tenant,project,ticket,definition,digest)
     VALUES('tenant-5','project-5',3,'{}','')`,
    false,
  ],
  [
    "the source a ticket bound to a repository was dispatched at",
    `INSERT INTO ticket_source(tenant,project,ticket,source,repository,commit,ref)
     VALUES('tenant-5','project-5',1,7,'owner/repo',repeat('a',40),'refs/heads/main')`,
    true,
  ],
  [
    "the source a ticket naming no repository runs at",
    `INSERT INTO ticket_source(tenant,project,ticket,source)
     VALUES('tenant-5','project-5',2,8)`,
    true,
  ],
  [
    "a source at the reference no reference is",
    `INSERT INTO ticket_source(tenant,project,ticket,source)
     VALUES('tenant-5','project-5',3,0)`,
    false,
  ],
  [
    "a repository named with no commit taken from it",
    `INSERT INTO ticket_source(tenant,project,ticket,source,repository)
     VALUES('tenant-5','project-5',4,9,'owner/repo')`,
    false,
  ],
  [
    "a commit named by no repository it was taken from",
    `INSERT INTO ticket_source(tenant,project,ticket,source,commit)
     VALUES('tenant-5','project-5',5,10,repeat('a',40))`,
    false,
  ],
  [
    "a commit that is not one",
    `INSERT INTO ticket_source(tenant,project,ticket,source,repository,commit)
     VALUES('tenant-5','project-5',6,11,'owner/repo','head')`,
    false,
  ],
];

test("the two relations a release fills hold a whole row and refuse a half one", async () => {
  await migratedDatabase("released_rows", async (subject) => {
    await subject.query(deletionPartition);
    for (const [label, row, held] of releasedRows)
      if (held) await subject.query(row);
      else await assert.rejects(subject.query(row), label);
  });
});

/** The repository the accepted work result was produced at, and the commit it names. */
const releasedRepository = "owner/repo";

const releasedRef = "refs/heads/main";

const releasedCommit = "a".repeat(40);

async function releasedFold(subject: pg.Pool, digest: string): Promise<number> {
  const found = (
    await subject.query<{ folded: string }>(
      "SELECT result_digest_fold($1)::text AS folded",
      [digest],
    )
  ).rows[0]?.folded;
  if (found === undefined) throw new Error("the digest fold answered nothing");
  return Number(found);
}

async function releasedJournalled(
  subject: pg.Pool,
  operation: string,
): Promise<unknown> {
  return (
    await subject.query<{ journalled: unknown }>(
      `SELECT (command::jsonb)->'ticketCommand' AS journalled
         FROM operation WHERE operation=$1`,
      [operation],
    )
  ).rows[0]?.journalled;
}

function releasedSubmission(ordinal: number): string {
  const at = String(ordinal);
  return `SELECT result,operation FROM submit_task_completion
     ('tenant-5','project-5','execution-${at}',1,${at},${at},'Passed','manifest-${at}',
      repeat('d',64),NULL,'operation-released-${at}','subject-5')`;
}

test("the door reports the work obligation the release wrote down and the source it was accepted at", async () => {
  await migratedDatabase("released_work", async (subject) => {
    await releasedSeeded(subject);
    const digest = await releasedFold(subject, "d".repeat(64));
    const source = await releasedFold(subject, releasedCommit);
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3"),
    );
    await subject.query(
      `INSERT INTO execution_result_source
         (tenant,project,manifest,repository,ref,commit,base,expected_base)
       VALUES('tenant-5','project-5','manifest-1','${releasedRepository}','${releasedRef}',
              '${releasedCommit}',repeat('e',40),repeat('e',40))`,
    );
    assert.deepEqual(
      (await subject.query(releasedSubmission(1))).rows,
      [{ result: "Submitted", operation: "operation-released-1" }],
      "the work result the release was dispatched for",
    );
    assert.deepEqual(
      await releasedJournalled(subject, "operation-released-1"),
      {
        type: "ReportTaskTerminal",
        value: {
          type: "WorkResultReport",
          value: {
            ticket: 1,
            result: {
              obligation: {
                task: { type: "WorkTask", value: { ticket: 1, cycle: 3 } },
                definition: releasedWorkDefinition,
                contextRef: 3,
              },
              resultRef: digest,
            },
            acceptedSourceRef: source,
          },
        },
      },
      "the work obligation is the definition the release wrote down",
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT ticket::text AS ticket,source::text AS source,repository,commit,ref
             FROM ticket_source WHERE tenant='tenant-5' AND project='project-5'`,
        )
      ).rows,
      [
        {
          ticket: "1",
          source: String(source),
          repository: releasedRepository,
          commit: releasedCommit,
          ref: releasedRef,
        },
      ],
      "the source the result was accepted at is the source the ticket now runs at",
    );
  });
});

test("the door reports a failure as the task that failed and the evidence it can be read at", async () => {
  await migratedDatabase("events_failure_door", async (subject) => {
    await releasedSeeded(subject);
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3", "Fail"),
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT result,operation FROM submit_task_completion
             ('tenant-5','project-5','execution-1',1,1,1,'Failed','manifest-1',
              repeat('d',64),NULL,'operation-failed-1','subject-5')`,
        )
      ).rows,
      [{ result: "Submitted", operation: "operation-failed-1" }],
    );
    const task = { type: "WorkTask", value: { ticket: 1, cycle: 3 } };
    assert.deepEqual(await releasedJournalled(subject, "operation-failed-1"), {
      type: "ReportTaskTerminal",
      value: {
        type: "TerminalFailureReport",
        value: {
          ticket: 1,
          failure: { task, evidence: 1 },
          kind: "ProcessFailure",
        },
      },
    });
  });
});

/** The identity the stage the release names spawns its second evaluator under. */
const releasedEvaluatorTask = {
  type: "EvaluationTask",
  value: { ticket: 1, workCycle: 2, stage: 1, generation: 5, evaluator: 3 },
};

/** The passed work manifest of the cycle the evaluator above judges. */
const releasedJudgedDigest = "f".repeat(64);

/** That cycle's work execution, at a digest of its own so its fold is visible. */
const releasedJudgedWork = identityExecution(
  2,
  "SpawnWork",
  "kind,cycle",
  "'Work',2",
  "Pass",
  `repeat('f',64)`,
);

/**
 * A LATER cycle of the same ticket, passed and written first, so a read that
 * asks the ticket for a work result rather than the cycle takes this one.
 */
const releasedLaterWork = identityExecution(
  3,
  "SpawnWork",
  "kind,cycle",
  "'Work',3",
  "Pass",
  `repeat('9',64)`,
);

/** The same cycle, passed, on ANOTHER ticket: a read not scoped by ticket takes it. */
const releasedOtherTicketWork = identityExecution(
  4,
  "SpawnWork",
  "kind,cycle",
  "'Work',2",
  "Pass",
  `repeat('8',64)`,
  2,
);

test("the door reports the definition the evaluator's own key carries, under what its cycle produced", async () => {
  await migratedDatabase("released_evaluation", async (subject) => {
    await releasedSeeded(subject);
    const digest = await releasedFold(subject, "d".repeat(64));
    const judged = await releasedFold(subject, releasedJudgedDigest);
    await subject.query(
      identityExecution(
        1,
        "SpawnEvaluation",
        "kind,cycle,stage,generation,evaluator",
        "'Evaluation',2,1,5,3",
      ),
    );
    await subject.query(releasedLaterWork);
    await subject.query(releasedJudgedWork);
    assert.notEqual(
      judged,
      2,
      "the reference the work reported is not the cycle it ran in",
    );
    assert.notEqual(judged, digest, "nor is it the evaluator's own result");
    assert.deepEqual(
      (await subject.query(releasedSubmission(1))).rows,
      [{ result: "Submitted", operation: "operation-released-1" }],
      "the evaluator the stage the release names runs",
    );
    assert.deepEqual(
      await releasedJournalled(subject, "operation-released-1"),
      {
        type: "ReportTaskTerminal",
        value: {
          type: "EvaluationResultReport",
          value: {
            ticket: 1,
            result: {
              obligation: {
                task: releasedEvaluatorTask,
                definition: releasedSecondDefinition,
                contextRef: judged,
              },
              resultRef: digest,
            },
            verdict: "EvaluatorPass",
          },
        },
      },
      "the evaluator judges under the reference its work cycle reported",
    );
  });
});

/** A definition a second stage carries, distinct from every one the first stage lists. */
const releasedThirdDefinition = {
  workload: 17,
  inputs: 18,
  executionRequirements: 19,
  resultContract: 20,
};

/**
 * A release of TWO stages listing the same evaluator key under different
 * definitions, so a door that selects by evaluator key alone answers the
 * first stage's definition for the second stage's task.
 */
const releasedTwoStageEntry = JSON.stringify({
  seq: 1,
  event: ticketCreated({
    ...releasedWhole,
    evaluationPlan: {
      stages: [
        { key: 1, evaluators: [{ key: 3, task: releasedSecondDefinition }] },
        { key: 2, evaluators: [{ key: 3, task: releasedThirdDefinition }] },
      ],
    },
  }),
});

test("the door reports the definition of the stage the evaluator runs in, not the first stage listing its key", async () => {
  await migratedDatabase("released_second_stage", async (subject) => {
    await subject.query(
      `${deletionPartition}\n${deletionJournalRow(1, releasedTwoStageEntry)};
       UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
       INSERT INTO configuration_revision
         (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
       VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
       INSERT INTO input_bundle(tenant,project,bundle,digest)
       VALUES('tenant-5','project-5','bundle-5',repeat('b',64))`,
    );
    const digest = await releasedFold(subject, "d".repeat(64));
    const judged = await releasedFold(subject, releasedJudgedDigest);
    await subject.query(
      identityExecution(
        1,
        "SpawnEvaluation",
        "kind,cycle,stage,generation,evaluator",
        "'Evaluation',2,2,1,3",
      ),
    );
    await subject.query(releasedJudgedWork);
    assert.deepEqual(
      (await subject.query(releasedSubmission(1))).rows,
      [{ result: "Submitted", operation: "operation-released-1" }],
      "the second stage's evaluator runs",
    );
    assert.deepEqual(
      await releasedJournalled(subject, "operation-released-1"),
      {
        type: "ReportTaskTerminal",
        value: {
          type: "EvaluationResultReport",
          value: {
            ticket: 1,
            result: {
              obligation: {
                task: {
                  type: "EvaluationTask",
                  value: {
                    ticket: 1,
                    workCycle: 2,
                    stage: 2,
                    generation: 1,
                    evaluator: 3,
                  },
                },
                definition: releasedThirdDefinition,
                contextRef: judged,
              },
              resultRef: digest,
            },
            verdict: "EvaluatorPass",
          },
        },
      },
      "the evaluator judges under its own stage's definition",
    );
  });
});

test("an evaluator whose cycle records no passed work result is refused by name", async () => {
  await migratedDatabase("released_unjudged", async (subject) => {
    await releasedSeeded(subject);
    await subject.query(
      identityExecution(
        1,
        "SpawnEvaluation",
        "kind,cycle,stage,generation,evaluator",
        "'Evaluation',2,1,5,3",
      ),
    );
    await subject.query(
      identityExecution(2, "SpawnWork", "kind,cycle", "'Work',2", "Fail"),
    );
    await subject.query(releasedLaterWork);
    await subject.query(releasedOtherTicketWork);
    assert.deepEqual(
      (await subject.query(releasedSubmission(1))).rows,
      [{ result: "WorkResultUnrecorded", operation: null }],
      "a judgement whose own cycle records no passed result of its own ticket",
    );
    assert.deepEqual(
      (
        await subject.query<{ held: number }>(
          "SELECT count(*)::int AS held FROM operation WHERE operation='operation-released-1'",
        )
      ).rows,
      [{ held: 0 }],
      "the refused completion journalled nothing",
    );
  });
});

test("a work result nothing observed a source for is refused on a ticket bound to a repository", async () => {
  await migratedDatabase("released_unsourced", async (subject) => {
    await releasedSeeded(subject);
    await subject.query(
      `INSERT INTO ticket_source(tenant,project,ticket,source,repository,commit,ref)
       VALUES('tenant-5','project-5',1,7,'${releasedRepository}','${releasedCommit}','${releasedRef}')`,
    );
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',4"),
    );
    assert.deepEqual(
      (await subject.query(releasedSubmission(1))).rows,
      [{ result: "SourceUnrecorded", operation: null }],
      "a pass nothing observed a source for",
    );
    assert.deepEqual(
      (
        await subject.query<{ held: number }>(
          "SELECT count(*)::int AS held FROM operation WHERE operation='operation-released-1'",
        )
      ).rows,
      [{ held: 0 }],
      "the refused completion journalled nothing",
    );
  });
});

test("the completion door stores the report under the tag of the command it built", async () => {
  await migratedDatabase("commands_door", async (subject) => {
    await releasedSeeded(subject);
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3", "Fail"),
    );
    await subject.query(
      `SELECT result FROM submit_task_completion
         ('tenant-5','project-5','execution-1',1,1,1,'Failed','manifest-1',
          repeat('d',64),NULL,'operation-failed-1','subject-5')`,
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT command_tag, (command::jsonb)->>'command' AS envelope,
                  (command::jsonb) ? 'event' AS event
             FROM operation WHERE operation='operation-failed-1'`,
        )
      ).rows,
      [{ command_tag: "ReportTaskTerminal", envelope: "Decide", event: false }],
    );
  });
});

test("the door reports the work obligation of the ticket's latest definition", async () => {
  await migratedDatabase("update_door", async (subject) => {
    await releasedSeeded(subject);
    await subject.query(
      `${deletionJournalRow(
        2,
        JSON.stringify({
          seq: 2,
          event: {
            type: "TicketUpdated",
            value: {
              ticket: 1,
              revision: 2,
              definition: {
                ...releasedWhole,
                workConfiguration: releasedSecondDefinition,
              },
            },
          },
        }),
      )};
       UPDATE project SET ingress_next=3 WHERE tenant='tenant-5' AND project='project-5'`,
    );
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3"),
    );
    await subject.query(
      `INSERT INTO execution_result_source
         (tenant,project,manifest,repository,ref,commit,base,expected_base)
       VALUES('tenant-5','project-5','manifest-1','${releasedRepository}','${releasedRef}',
              '${releasedCommit}',repeat('e',40),repeat('e',40))`,
    );
    assert.deepEqual((await subject.query(releasedSubmission(1))).rows, [
      { result: "Submitted", operation: "operation-released-1" },
    ]);
    const journalled = (await releasedJournalled(
      subject,
      "operation-released-1",
    )) as {
      readonly value: {
        readonly value: {
          readonly result: {
            readonly obligation: { readonly definition: unknown };
          };
        };
      };
    };
    assert.deepEqual(
      journalled.value.value.result.obligation.definition,
      releasedSecondDefinition,
    );
  });
});
