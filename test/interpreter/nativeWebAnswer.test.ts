/**
 * A resolution's submission is held to who may answer the action it names and
 * to the feedback that action takes, before anything reaches the mailbox: a
 * refused answer is named, a caller who may not read is told nothing is there,
 * and an accepted one is offered under the caller's own authority.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionId } from "../../src/interpreter/agentSession.ts";
import type { NativeActionAsked } from "../../src/interpreter/nativeActionAnswer.ts";
import {
  nativeWeb,
  type NativeReadStore,
} from "../../src/interpreter/nativeWeb.ts";
import {
  asIdempotencyKey,
  asOperationId,
  type OperationInbox,
} from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { NativeActionResolution } from "../../src/interpreter/projectCommand.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { unaskedNativeWebPorts } from "./nativeWebFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const developer = asPrincipal("developer");
const reader = asPrincipal("reader");
const stranger = asPrincipal("stranger");
const session = "session-1" as SessionId;

const [unaskedReads, , authoring, notifications, backlog] =
  unaskedNativeWebPorts;

function desk(asked: NativeActionAsked | undefined) {
  const access = memoryProjectAccess();
  access.grant({
    partition,
    principal: developer,
    access: new Set(["Read", "Mutate"]),
  });
  access.grant({ partition, principal: reader, access: new Set(["Read"]) });
  const accepted: string[] = [];
  const reads: NativeReadStore = {
    ...unaskedReads,
    nativeActionAsked: () => Promise.resolve(asked),
  };
  const inbox: OperationInbox = {
    accept: (request) => {
      accepted.push(request.authority.subject);
      return Promise.resolve({ accepted: "InvalidCommand" });
    },
    cancel: () => Promise.resolve({ cancelled: "Unknown" }),
    operation: () => Promise.resolve(undefined),
  };
  const web = nativeWeb(
    access,
    reads,
    inbox,
    authoring,
    notifications,
    backlog,
  );
  return { web, accepted };
}

function resolution(
  answer: NativeActionResolution,
  feedback?: string,
  viaSession?: SessionId,
) {
  return {
    partition,
    operation: asOperationId("operation-1"),
    key: asIdempotencyKey("key-1"),
    command: {
      version: 1 as const,
      command: "ResolveNativeAction" as const,
      action: "action-1",
      authorizingSeq: 3,
      resolution: answer,
      ...(feedback === undefined ? {} : { feedback }),
    },
    ...(viaSession === undefined ? {} : { viaSession }),
  };
}

const listed: NativeActionAsked = {
  kind: "EvaluationApproval",
  approvers: [reader],
};

test("an approver's Approve, and their Reject with feedback, reach the mailbox under their own authority", async () => {
  const { web, accepted } = desk(listed);
  assert.notEqual(
    (await web.submit(reader, resolution("Approve"))).result,
    "AnswerRefused",
  );
  assert.notEqual(
    (await web.submit(reader, resolution("Reject", "the tests fail"))).result,
    "AnswerRefused",
  );
  assert.deepEqual(accepted, [reader, reader]);
});

test("a developer a principal list does not name is refused NotAnApprover, and nothing is offered", async () => {
  const { web, accepted } = desk(listed);
  assert.deepEqual(await web.submit(developer, resolution("Approve")), {
    result: "AnswerRefused",
    code: "NotAnApprover",
  });
  assert.deepEqual(accepted, []);
});

test("an approver answering through a session is refused ApproverNotAPerson", async () => {
  const { web, accepted } = desk(listed);
  assert.deepEqual(
    await web.submit(reader, resolution("Approve", undefined, session)),
    { result: "AnswerRefused", code: "ApproverNotAPerson" },
  );
  assert.deepEqual(accepted, []);
});

test("a Reject without feedback is refused RejectionWithoutFeedback", async () => {
  const { web, accepted } = desk(listed);
  assert.deepEqual(await web.submit(reader, resolution("Reject")), {
    result: "AnswerRefused",
    code: "RejectionWithoutFeedback",
  });
  assert.deepEqual(accepted, []);
});

test("feedback on an escalation's answer is refused FeedbackNotAsked, and the answer without it is offered as before", async () => {
  const { web, accepted } = desk({ kind: "TicketEscalation" });
  assert.deepEqual(
    await web.submit(developer, resolution("Resume", "carry on")),
    { result: "AnswerRefused", code: "FeedbackNotAsked" },
  );
  assert.notEqual(
    (await web.submit(developer, resolution("Resume", undefined, session)))
      .result,
    "AnswerRefused",
  );
  assert.deepEqual(accepted, [developer]);
});

test("a caller who may not read the project is told the action is not found", async () => {
  const { web, accepted } = desk(listed);
  assert.deepEqual(await web.submit(stranger, resolution("Approve")), {
    result: "NotFound",
  });
  assert.deepEqual(accepted, []);
});
