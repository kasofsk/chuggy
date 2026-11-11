/**
 * A person's answer to an evaluation approval against a real server: the
 * deciding transaction resolves the action, writes the execution's result,
 * terminalizes it and submits its completion together, so `Approve` is a pass
 * and `Reject` a failure with its feedback carried into the next work cycle's
 * briefing, and an answer the approval no longer stands for settles nothing.
 *
 * The work each case judges is reported through the real scheduler, because
 * the completion an answer submits derives its context from that work's
 * recorded result.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresPriorEvaluationReports } from "../../src/adapters/postgres/evaluationReports.ts";
import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import {
  approvalFeedbackCharsMax,
  principalCharsMax,
  resultReportCharsMax,
} from "../../src/contract/http.ts";
import { executionResponseSchema } from "../../src/contract/responses.ts";
import type { Config } from "../../src/domain/config.ts";
import {
  executionSchedulerDefaults,
  type ExecutionId,
} from "../../src/interpreter/executionScheduler.ts";
import { asAuthoritySubject } from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { EvaluationApprovalResolution } from "../../src/interpreter/projectCommand.ts";
import { memberAuthorityKind } from "../../src/interpreter/projectAccess.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import {
  postgresHarnessDrain,
  postgresHarnessSubmission,
  postgresHarnessWriter,
} from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerInCluster,
  schedulerIngressPool,
  schedulerOwner,
  schedulerPlacedAttempt,
  schedulerProject,
  schedulerReport,
  schedulerRevoke,
  schedulerRigOpen,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";
import { canonicalConfigurationOf } from "../../src/interpreter/authoring.ts";

let rig: SchedulerRig;
let ingress: pg.Pool;

before(async () => {
  rig = await schedulerRigOpen();
  ingress = schedulerIngressPool();
});

after(async () => {
  await ingress.end();
  await rig.close();
});

const approver = "approval-person";

/** A catalog evaluating by an approval alone, or by a command beside one. */
function catalogOf(plan: "signOff" | "mixed") {
  return canonicalConfigurationOf({
    version: 2,
    image: "worker:v2",
    workloads: {
      build: {
        runner: "Agent",
        prompt: { text: "Build it." },
        worker: {
          mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
          setup: [],
          files: [],
        },
      },
      tests: { runner: "Commands", commands: ["npm test"] },
      approval: {
        runner: "Approval",
        instructions: "Say whether it may land.",
        approvers: "Developer",
      },
    },
    plans: {
      signOff: [{ name: "sign-off", evaluators: ["approval"] }],
      mixed: [{ name: "checks", evaluators: ["tests", "approval"] }],
    },
    defaults: { work: "build", evaluation: plan },
  });
}

/** A case's project, the memory its last decision left, and the bounds its writer decides under. */
interface Answering {
  readonly project: SchedulerProject;
  readonly memory: ProjectMemory;
  readonly config: Config;
}

async function drained(at: Answering): Promise<Answering> {
  const { memory } = await postgresHarnessDrain(
    rig.harness,
    at.project.partition,
    at.memory,
    at.config,
  );
  return { ...at, memory };
}

/** The ticket's newest spawn request of `kind`, registered through the real store. */
async function spawnRegistered(
  at: Answering,
  kind: "SpawnWork" | "SpawnEvaluation",
  label: string,
): Promise<void> {
  const [spawn] = (await rig.harness.query(
    `SELECT request FROM execution_request
      WHERE tenant=$1 AND project=$2 AND kind=$3 AND state='Open'
      ORDER BY effect_position DESC, authorizing_seq DESC LIMIT 1`,
    [at.project.partition.tenant, at.project.partition.project, kind],
  )) as readonly { request: string }[];
  assert.ok(spawn !== undefined, `no ${kind} is open to register`);
  const registered = await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      at.project.partition,
      spawn.request,
      schedulerOwner(label),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  assert.equal(registered.registered, "Registered");
}

/** The next admitted execution run by a worker reporting `verdict`, and every input that leaves decided. */
async function workerReported(
  at: Answering,
  label: string,
  verdict: "Pass" | "Fail" = "Pass",
): Promise<Answering> {
  const placed = await schedulerPlacedAttempt(rig, at.project, label);
  const settled = await rig.store.terminalize(
    schedulerReport(placed.attempt, verdict),
  );
  assert.equal(settled.terminalized, "Terminalized");
  return drained(at);
}

/** The ticket's next work cycle run and passed, and the evaluation it spawns registered. */
async function workPassed(at: Answering, label: string): Promise<Answering> {
  await spawnRegistered(at, "SpawnWork", `${label}-work`);
  const worked = await workerReported(at, `${label}-work`);
  await spawnRegistered(worked, "SpawnEvaluation", `${label}-evaluation`);
  return worked;
}

/** A released ticket evaluating by `plan`, its work cycle 1 passed. */
async function evaluating(
  label: string,
  plan: "signOff" | "mixed",
): Promise<Answering> {
  const release =
    plan === "signOff"
      ? { authoring: plainAuthoring, config: refinementInstance }
      : {
          authoring: {
            deps: new Set<number>(),
            prog: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
          },
          config: { ...refinementInstance, nTasks: 2 },
        };
  const project = await schedulerProject(
    rig,
    label,
    { tasks: 1 },
    catalogOf(plan),
    undefined,
    undefined,
    release,
  );
  return workPassed(
    { project, memory: project.memory, config: release.config },
    label,
  );
}

/** The ticket's one open evaluation approval and the execution it stands for. */
async function openApproval(at: Answering) {
  const open = (await rig.harness.query(
    `SELECT action, authorizing_seq::int AS seq, execution
       FROM native_action
      WHERE tenant=$1 AND project=$2 AND kind='EvaluationApproval' AND state='Open'`,
    [at.project.partition.tenant, at.project.partition.project],
  )) as readonly { action: string; seq: number; execution: string }[];
  assert.equal(open.length, 1, "one approval is open");
  const [only] = open;
  assert.ok(only !== undefined);
  return only;
}

/** Offers one answer to the mailbox as the member `principal`, and what acceptance said. */
async function offered(
  at: Answering,
  action: { readonly action: string; readonly seq: number },
  resolution: EvaluationApprovalResolution,
  feedback?: string,
  principal: string = approver,
) {
  const submission = postgresHarnessSubmission(
    at.project.partition,
    `answer-${resolution}`,
  );
  const accepted = await rig.harness.inbox.accept({
    ...submission,
    authority: {
      kind: memberAuthorityKind,
      subject: asAuthoritySubject(principal),
    },
    command: {
      version: 1,
      command: "ResolveNativeAction",
      action: action.action,
      authorizingSeq: action.seq,
      resolution,
      ...(feedback === undefined ? {} : { feedback }),
    },
  });
  return { operation: submission.operation, accepted: accepted.accepted };
}

/** Accepts one answer as the member `principal` and decides every input it leaves. */
async function answered(
  at: Answering,
  action: { readonly action: string; readonly seq: number },
  resolution: EvaluationApprovalResolution,
  feedback?: string,
  principal: string = approver,
): Promise<Answering & { readonly operation: string }> {
  const { operation, accepted } = await offered(
    at,
    action,
    resolution,
    feedback,
    principal,
  );
  assert.equal(accepted, "Accepted");
  return { ...(await drained(at)), operation };
}

async function phaseOf(at: Answering): Promise<string | undefined> {
  const [row] = (await rig.harness.query(
    `SELECT phase FROM ticket_projection WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [
      at.project.partition.tenant,
      at.project.partition.project,
      at.project.ticket,
    ],
  )) as readonly { phase: string }[];
  return row?.phase;
}

async function outcomeOf(
  at: Answering,
  operation: string,
): Promise<string | null | undefined> {
  const [row] = (await rig.harness.query(
    `SELECT outcome_code FROM decision_input
      WHERE tenant=$1 AND project=$2 AND input_kind='Operation' AND input_id=$3`,
    [at.project.partition.tenant, at.project.partition.project, operation],
  )) as readonly { outcome_code: string | null }[];
  return row?.outcome_code;
}

async function actionRow(at: Answering, action: string) {
  const [row] = (await rig.harness.query(
    `SELECT state, resolution, answered_by, answered_at IS NOT NULL AS dated, feedback
       FROM native_action WHERE tenant=$1 AND project=$2 AND action=$3`,
    [at.project.partition.tenant, at.project.partition.project, action],
  )) as readonly {
    state: string;
    resolution: string | null;
    answered_by: string | null;
    dated: boolean;
    feedback: string | null;
  }[];
  return row;
}

async function executionRow(at: Answering, execution: string) {
  const [row] = (await rig.harness.query(
    `SELECT status, outcome, result_manifest, completion_operation
       FROM execution WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [at.project.partition.tenant, at.project.partition.project, execution],
  )) as readonly {
    status: string;
    outcome: string | null;
    result_manifest: string | null;
    completion_operation: string | null;
  }[];
  return row;
}

/** The newest work execution the ticket registered. */
async function newestWork(at: Answering): Promise<ExecutionId> {
  const [row] = (await rig.harness.query(
    `SELECT e.execution FROM execution e
       JOIN execution_request_task t
         ON t.tenant=e.tenant AND t.project=e.project
        AND t.request=e.source_request AND t.task=e.task
      WHERE e.tenant=$1 AND e.project=$2 AND t.kind='Work'
      ORDER BY e.task DESC LIMIT 1`,
    [at.project.partition.tenant, at.project.partition.project],
  )) as readonly { execution: ExecutionId }[];
  assert.ok(row !== undefined);
  return row.execution;
}

async function openKinds(at: Answering): Promise<readonly string[]> {
  const rows = (await rig.harness.query(
    `SELECT kind FROM native_action
      WHERE tenant=$1 AND project=$2 AND state='Open' ORDER BY kind`,
    [at.project.partition.tenant, at.project.partition.project],
  )) as readonly { kind: string }[];
  return rows.map((row) => row.kind);
}

test("Approve on an approval-only final stage passes it, and the ticket moves to Finalization", async () => {
  const at = await evaluating("answer-approve", "signOff");
  const asked = await openApproval(at);
  const after = await answered(at, asked, "Approve");
  assert.equal(await outcomeOf(after, after.operation), null);
  assert.equal(await phaseOf(after), "Finalization");
  assert.deepEqual(await actionRow(after, asked.action), {
    state: "Resolved",
    resolution: "Approve",
    answered_by: approver,
    dated: true,
    feedback: null,
  });
  const execution = await executionRow(after, asked.execution);
  assert.equal(execution?.status, "Terminal");
  assert.equal(execution.outcome, "Passed");
  assert.notEqual(execution.completion_operation, null);
});

test("who answered, when, how and with what feedback are read back from the execution's result", async () => {
  const at = await evaluating("answer-read", "signOff");
  const asked = await openApproval(at);
  await answered(at, asked, "Approve", "Looks right to me.");
  const resource = await postgresOperationalReads(ingress).execution(
    at.project.partition,
    asked.execution as ExecutionId,
    asPrincipal("answer-reader"),
  );
  const result = resource?.result;
  assert.ok(result !== undefined, "the answered execution has a result");
  assert.equal(result.attempt, undefined);
  assert.equal(result.verdict, "Pass");
  assert.equal(result.report, `Approved by ${approver}: Looks right to me.`);
  assert.equal(result.approval?.principal, approver);
  assert.equal(result.approval.resolution, "Approve");
  assert.equal(result.approval.feedback, "Looks right to me.");
  assert.equal(result.approval.action, asked.action);
  executionResponseSchema.parse(resource);
});

test("Reject with feedback fails the stage, and the rework's briefing reads the feedback behind the approver's name", async () => {
  const at = await evaluating("answer-reject", "signOff");
  const asked = await openApproval(at);
  const feedback = "The migration drops a column the reader still selects.";
  const after = await answered(at, asked, "Reject", feedback);
  assert.equal(await outcomeOf(after, after.operation), null);
  assert.equal(await phaseOf(after), "Work");
  assert.deepEqual(await actionRow(after, asked.action), {
    state: "Resolved",
    resolution: "Reject",
    answered_by: approver,
    dated: true,
    feedback,
  });
  assert.equal((await executionRow(after, asked.execution))?.outcome, "Failed");
  await spawnRegistered(after, "SpawnWork", "answer-reject-rework");
  assert.deepEqual(
    await postgresPriorEvaluationReports(rig.pool).reports(
      after.project.partition,
      await newestWork(after),
    ),
    {
      read: "Reports",
      reports: { reports: [`Rejected by ${approver}: ${feedback}`] },
    },
  );
});

test("Reject at the rework cap escalates the ticket", async () => {
  let at = await evaluating("answer-cap", "signOff");
  let cycles = 1;
  for (; cycles <= 8; cycles++) {
    at = await answered(at, await openApproval(at), "Reject", "Not yet.");
    if ((await phaseOf(at)) !== "Work") break;
    at = await workPassed(at, `answer-cap-${String(cycles)}`);
  }
  assert.ok(cycles > 1, "the cap allowed a rework before it escalated");
  assert.equal(await phaseOf(at), "Escalated");
  assert.deepEqual(await openKinds(at), ["TicketEscalation"]);
});

test("a mixed stage concludes only once its command and its approval have both answered", async () => {
  const at = await evaluating("answer-mixed", "mixed");
  const asked = await openApproval(at);
  const approved = await answered(at, asked, "Approve");
  assert.equal(await phaseOf(approved), "Evaluation");
  const tested = await workerReported(approved, "answer-mixed-tests");
  assert.equal(await phaseOf(tested), "Finalization");
});

test("a mixed stage whose command failed reworks the ticket once the approval answers too", async () => {
  const at = await evaluating("answer-mixed-fail", "mixed");
  const asked = await openApproval(at);
  const tested = await workerReported(at, "answer-mixed-fail-tests", "Fail");
  assert.equal(await phaseOf(tested), "Evaluation");
  const after = await answered(tested, asked, "Approve");
  assert.equal(await phaseOf(after), "Work");
});

test("a second answer to a settled approval is refused at the mailbox and changes nothing", async () => {
  const at = await evaluating("answer-twice", "signOff");
  const asked = await openApproval(at);
  const first = await answered(at, asked, "Approve");
  const second = await offered(first, asked, "Reject", "Changed my mind.");
  assert.equal(second.accepted, "InvalidCommand");
  assert.equal((await actionRow(first, asked.action))?.resolution, "Approve");
  assert.equal((await executionRow(first, asked.execution))?.outcome, "Passed");
});

test("an answer after a revoke withdrew the approval is refused at the mailbox and writes no result", async () => {
  const at = await evaluating("answer-revoked", "signOff");
  const asked = await openApproval(at);
  await schedulerRevoke(
    rig,
    { ...at.project, memory: at.memory },
    "answer-revoked",
  );
  const refused = await offered(at, asked, "Approve");
  assert.equal(refused.accepted, "InvalidCommand");
  assert.equal((await actionRow(at, asked.action))?.answered_by, null);
  assert.equal(
    (await executionRow(at, asked.execution))?.result_manifest,
    null,
  );
});

test("an answer racing the cancellation that withdrew its approval is refused, and settles nothing", async () => {
  const at = await evaluating("answer-race", "signOff");
  const asked = await openApproval(at);
  const submission = postgresHarnessSubmission(
    at.project.partition,
    "answer-race",
  );
  const accepted = await rig.harness.inbox.accept({
    ...submission,
    authority: {
      kind: memberAuthorityKind,
      subject: asAuthoritySubject(approver),
    },
    command: {
      version: 1,
      command: "ResolveNativeAction",
      action: asked.action,
      authorizingSeq: asked.seq,
      resolution: "Approve",
    },
  });
  assert.equal(accepted.accepted, "Accepted");
  const input = await rig.harness.discovery.next(at.project.partition, 300);
  assert.ok(input !== undefined);
  assert.equal(input.source.nativeAction?.open, true);
  await rig.harness.query(
    `UPDATE execution SET status='Cancelled', terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [
      at.project.partition.tenant,
      at.project.partition.project,
      asked.execution,
    ],
  );
  const decided = await projectWriterDecide(
    postgresHarnessWriter(rig.harness),
    at.memory,
    input,
  );
  assert.equal(decided.decided.decided, "Refused");
  assert.equal(await outcomeOf(at, submission.operation), "TicketChanged");
  assert.deepEqual(await actionRow(at, asked.action), {
    state: "Withdrawn",
    resolution: null,
    answered_by: null,
    dated: false,
    feedback: null,
  });
  assert.equal(
    (await executionRow(at, asked.execution))?.completion_operation,
    null,
  );
});

test("the longest feedback beside the widest approver fits its report whole", async () => {
  assert.equal(
    `Rejected by ${"p".repeat(principalCharsMax)}: ${"f".repeat(approvalFeedbackCharsMax)}`
      .length,
    resultReportCharsMax,
  );
  const at = await evaluating("answer-widest", "signOff");
  const asked = await openApproval(at);
  const widest = "w".repeat(principalCharsMax);
  const feedback = "f".repeat(approvalFeedbackCharsMax);
  const after = await answered(at, asked, "Reject", feedback, widest);
  assert.equal(await outcomeOf(after, after.operation), null);
  const [report] = (await rig.harness.query(
    `SELECT p.report FROM execution e
       JOIN execution_result_report p
         ON p.tenant=e.tenant AND p.project=e.project AND p.manifest=e.result_manifest
      WHERE e.tenant=$1 AND e.project=$2 AND e.execution=$3`,
    [
      at.project.partition.tenant,
      at.project.partition.project,
      asked.execution,
    ],
  )) as readonly { report: string }[];
  assert.equal(report?.report, `Rejected by ${widest}: ${feedback}`);
});

test("feedback past its bound is refused at the mailbox rather than truncated", async () => {
  const at = await evaluating("answer-overlong", "signOff");
  const asked = await openApproval(at);
  const accepted = await rig.harness.inbox.accept({
    ...postgresHarnessSubmission(at.project.partition, "answer-overlong"),
    authority: {
      kind: memberAuthorityKind,
      subject: asAuthoritySubject(approver),
    },
    command: {
      version: 1,
      command: "ResolveNativeAction",
      action: asked.action,
      authorizingSeq: asked.seq,
      resolution: "Reject",
      feedback: "f".repeat(approvalFeedbackCharsMax + 1),
    },
  });
  assert.notEqual(accepted.accepted, "Accepted");
  assert.equal((await openApproval(at)).action, asked.action);
});
