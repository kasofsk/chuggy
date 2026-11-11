/**
 * Who may answer an evaluation approval, asked of a real authority: each
 * approver shape admits exactly the principals the project's tuples make it
 * name, and refuses every other caller by name, a person who may not read the
 * project being told nothing is there.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionId } from "../../src/interpreter/agentSession.ts";
import {
  nativeActionAnswerer,
  type NativeActionAsked,
} from "../../src/interpreter/nativeActionAnswer.ts";
import {
  oidcPrincipalSubject,
  type Principal,
} from "../../src/interpreter/principal.ts";
import { projectPrincipalGrant } from "../../src/interpreter/projectGrant.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  ketoHarnessAccess,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessSomeone,
} from "./harness.ts";

const grants = ketoHarnessGrants();

/** One principal written into `relation` on the project. */
async function granted(
  partition: Partition,
  label: string,
  relation: string,
): Promise<Principal> {
  const principal = ketoHarnessSomeone(label);
  const subject = oidcPrincipalSubject(ketoHarnessIssuer, principal);
  assert.ok(subject !== undefined);
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      tenant: partition.tenant,
      project: partition.project,
      relation,
    }),
  );
  return principal;
}

/** A project holding an administrator, a developer, a viewer and the site's selector as a developer. */
async function staffed(label: string) {
  const partition = ketoHarnessPartition(label);
  return {
    partition,
    admin: await granted(partition, `${label}-admin`, "admins"),
    developer: await granted(partition, `${label}-developer`, "developers"),
    viewer: await granted(partition, `${label}-viewer`, "viewers"),
    selector: await granted(partition, `${label}-selector`, "developers"),
    stranger: ketoHarnessSomeone(`${label}-stranger`),
  };
}

const session = "approval-session" as SessionId;

/** What each caller is answered when it would answer `asked` on the project. */
async function answersTo(
  project: Awaited<ReturnType<typeof staffed>>,
  asked: NativeActionAsked,
  callers: readonly (readonly [Principal, SessionId?])[],
): Promise<readonly string[]> {
  const access = ketoHarnessAccess();
  const answers: string[] = [];
  for (const [principal, viaSession] of callers) {
    const answer = await nativeActionAnswerer(
      access,
      { selector: project.selector },
      viaSession === undefined ? { principal } : { principal, viaSession },
      project.partition,
      asked,
    );
    answers.push(answer.answerer === "Refused" ? answer.code : answer.answerer);
  }
  return answers;
}

test("a Developer approval admits whoever holds develop, and refuses a viewer, an agent and a session by name", async () => {
  const project = await staffed("approval-developer");
  assert.deepEqual(
    await answersTo(
      project,
      { kind: "EvaluationApproval", approvers: "Developer" },
      [
        [project.developer],
        [project.admin],
        [project.viewer],
        [project.selector],
        [project.developer, session],
        [project.stranger],
      ],
    ),
    [
      "Answerer",
      "Answerer",
      "NotAnApprover",
      "ApproverNotAPerson",
      "ApproverNotAPerson",
      "NotFound",
    ],
  );
});

test("an Admin approval admits only whoever holds administer", async () => {
  const project = await staffed("approval-admin");
  assert.deepEqual(
    await answersTo(
      project,
      { kind: "EvaluationApproval", approvers: "Admin" },
      [
        [project.admin],
        [project.developer],
        [project.viewer],
        [project.admin, session],
      ],
    ),
    ["Answerer", "NotAnApprover", "NotAnApprover", "ApproverNotAPerson"],
  );
});

test("a principal list admits exactly the readers it names, and no developer or administrator it does not", async () => {
  const project = await staffed("approval-listed");
  assert.deepEqual(
    await answersTo(
      project,
      {
        kind: "EvaluationApproval",
        approvers: [project.viewer, project.stranger, project.selector],
      },
      [
        [project.viewer],
        [project.stranger],
        [project.selector],
        [project.developer],
        [project.admin],
      ],
    ),
    [
      "Answerer",
      "NotFound",
      "ApproverNotAPerson",
      "NotAnApprover",
      "NotAnApprover",
    ],
  );
});

test("an escalation is answered by whoever holds develop, as before", async () => {
  const project = await staffed("approval-escalation");
  assert.deepEqual(
    await answersTo(project, { kind: "TicketEscalation" }, [
      [project.developer],
      [project.selector],
      [project.developer, session],
      [project.viewer],
    ]),
    ["Answerer", "Answerer", "Answerer", "NotFound"],
  );
});
