/**
 * Who may answer a native action, and what feedback an answer may carry: an
 * evaluation approval by whom its approvers name and never by an agent or a
 * session, every other kind under `Mutate`, and a caller who may not read the
 * project told nothing is there.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nativeActionAnswerer,
  nativeActionFeedbackRefusal,
  nativeActionsAnswerable,
  type NativeActionAsked,
} from "../../src/interpreter/nativeActionAnswer.ts";
import type { SessionId } from "../../src/interpreter/agentSession.ts";
import type {
  Authority,
  AuthorityKind,
  AuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type {
  ProjectAccess,
  ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";

const partition: Partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const reader = asPrincipal("reader");
const developer = asPrincipal("developer");
const admin = asPrincipal("admin");
const outsider = asPrincipal("outsider");
const selector = asPrincipal("selector");
const session = "session-1" as SessionId;

/** Read for everyone but the outsider, develop for the developer, the admin and the selector, administer for the admin. */
const held: ReadonlyMap<Principal, readonly ProjectAccessKind[]> = new Map([
  [reader, ["Read"]],
  [developer, ["Read", "Mutate"]],
  [admin, ["Read", "Mutate", "Administer"]],
  [selector, ["Read", "Mutate", "Administer"]],
]);

function authorityOf(principal: Principal): Authority {
  return {
    kind: "Member" as AuthorityKind,
    subject: principal as string as AuthoritySubject,
  };
}

function access(asked: string[] = []): ProjectAccess {
  return {
    authorize: (principal, _partition, kind) => {
      asked.push(`${principal}:${kind}`);
      return Promise.resolve(
        held.get(principal)?.includes(kind) === true
          ? authorityOf(principal)
          : undefined,
      );
    },
    authorizeTenant: () => Promise.reject(new Error("no tenant read")),
    authorizeSite: () => Promise.reject(new Error("no site read")),
  };
}

const agents = { selector };

function approval(
  approvers: "Developer" | "Admin" | readonly string[],
): NativeActionAsked {
  return { kind: "EvaluationApproval", approvers };
}

async function answererOf(
  principal: Principal,
  asked: NativeActionAsked,
  viaSession?: SessionId,
) {
  return nativeActionAnswerer(
    access(),
    agents,
    viaSession === undefined ? { principal } : { principal, viaSession },
    partition,
    asked,
  );
}

test("a Developer approval admits every developer and admin, and refuses a reader as no approver", async () => {
  const asked = approval("Developer");
  assert.deepEqual(await answererOf(developer, asked), {
    answerer: "Answerer",
    authority: authorityOf(developer),
  });
  assert.equal((await answererOf(admin, asked)).answerer, "Answerer");
  assert.deepEqual(await answererOf(reader, asked), {
    answerer: "Refused",
    code: "NotAnApprover",
  });
});

test("an Admin approval admits only an administrator, and refuses a developer as no approver", async () => {
  const asked = approval("Admin");
  assert.equal((await answererOf(admin, asked)).answerer, "Answerer");
  assert.deepEqual(await answererOf(developer, asked), {
    answerer: "Refused",
    code: "NotAnApprover",
  });
});

test("a principal list admits exactly the readers it names, however little else they hold, and refuses a developer it does not name", async () => {
  const asked = approval([reader]);
  assert.deepEqual(await answererOf(reader, asked), {
    answerer: "Answerer",
    authority: authorityOf(reader),
  });
  assert.deepEqual(await answererOf(developer, asked), {
    answerer: "Refused",
    code: "NotAnApprover",
  });
});

test("a listed principal who no longer reads the project is told it is not found", async () => {
  assert.deepEqual(await answererOf(outsider, approval([outsider])), {
    answerer: "NotFound",
  });
});

test("an agent or a session never answers an approval, whatever it holds or whoever names it", async () => {
  for (const asked of [
    approval("Developer"),
    approval("Admin"),
    approval([selector, admin]),
  ]) {
    assert.deepEqual(await answererOf(selector, asked), {
      answerer: "Refused",
      code: "ApproverNotAPerson",
    });
    assert.deepEqual(await answererOf(admin, asked, session), {
      answerer: "Refused",
      code: "ApproverNotAPerson",
    });
  }
});

test("an escalation or a finalization approval is answered under Mutate, by a session as by a person", async () => {
  for (const kind of ["TicketEscalation", "FinalizationApproval"] as const) {
    assert.equal(
      (await answererOf(developer, { kind }, session)).answerer,
      "Answerer",
    );
    assert.equal((await answererOf(selector, { kind })).answerer, "Answerer");
    assert.deepEqual(await answererOf(reader, { kind }), {
      answerer: "NotFound",
    });
  }
});

test("only an evaluation approval takes feedback, and its Reject needs some", () => {
  assert.equal(
    nativeActionFeedbackRefusal("EvaluationApproval", "Approve", undefined),
    undefined,
  );
  assert.equal(
    nativeActionFeedbackRefusal("EvaluationApproval", "Approve", "fine"),
    undefined,
  );
  assert.equal(
    nativeActionFeedbackRefusal("EvaluationApproval", "Reject", "broken"),
    undefined,
  );
  assert.equal(
    nativeActionFeedbackRefusal("EvaluationApproval", "Reject", undefined),
    "RejectionWithoutFeedback",
  );
  assert.equal(
    nativeActionFeedbackRefusal("TicketEscalation", "Resume", "note"),
    "FeedbackNotAsked",
  );
  assert.equal(
    nativeActionFeedbackRefusal("FinalizationApproval", "Approve", "note"),
    "FeedbackNotAsked",
  );
  assert.equal(
    nativeActionFeedbackRefusal("FinalizationApproval", "Approve", undefined),
    undefined,
  );
});

test("each listed action says whether its caller may answer it, asking the authority each kind once", async () => {
  const asked: string[] = [];
  const answered = await nativeActionsAnswerable(
    access(asked),
    agents,
    { principal: reader },
    partition,
    [
      { kind: "TicketEscalation" as const },
      {
        kind: "EvaluationApproval" as const,
        approval: { approvers: [reader] },
      },
      {
        kind: "EvaluationApproval" as const,
        approval: { approvers: "Developer" as const },
      },
      {
        kind: "EvaluationApproval" as const,
        approval: { approvers: [developer] },
      },
    ],
  );
  assert.deepEqual(
    answered.map((action) => action.answerable),
    [false, true, false, false],
  );
  assert.deepEqual(asked, ["reader:Mutate", "reader:Read"]);
});
