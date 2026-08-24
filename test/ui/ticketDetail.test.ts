import assert from "node:assert/strict";
import test from "node:test";

import {
  ticketDetailActions,
  ticketDetailDraftReceived,
  ticketDetailExecutionsNext,
  ticketDetailExecutionsReceived,
  ticketDetailInitial,
} from "../../ui/app/ticketDetail.js";

const partition = { tenant: "acme", project: "atlas" };

function draft(state = "Draft") {
  return {
    partition,
    ticket: 7,
    authoringVersion: 3,
    state,
    configurationRevision: "revision-1",
    authoring: {
      dependencies: [],
      program: [{ fanout: 1, combinator: "UnanimousPass" }],
      workFanout: 1,
      reworkPolicy: { type: "BudgetedRework", value: 0 },
      finalizationPricing: "DeadlineOnly",
      resumePricing: "RetryCharged",
      finalizer: "ManagedFinalizer",
    },
  };
}

function execution(execution: string) {
  return {
    execution,
    ticket: 7,
    task: 1,
    taskKind: "Work",
    cluster: "primary",
    configurationRevision: "revision-1",
    status: "Terminal",
    outcome: "Passed",
    retriesSpent: 0,
    registeredAt: "2026-08-24T12:00:00Z",
  };
}

test("a retained draft starts its configuration read and enables draft actions", () => {
  const initial = ticketDetailInitial("token", partition, 7, 20);
  const answered = ticketDetailDraftReceived(
    initial.state,
    { outcome: "Ok", body: draft() },
    "token",
    partition,
  );

  assert.equal(
    answered.request?.url,
    "/api/v1/tenants/acme/projects/atlas/configurations/revision-1",
  );
  assert.deepEqual(ticketDetailActions(answered.state), {
    edit: true,
    delete: true,
    release: true,
  });
});

test("an absent retained draft is a legible state and does not request a configuration", () => {
  const initial = ticketDetailInitial("token", partition, 7);
  const answered = ticketDetailDraftReceived(
    initial.state,
    { outcome: "Absent" },
    "token",
    partition,
  );

  assert.equal(answered.request, undefined);
  assert.equal(answered.state.draft.state, "Data");
  assert.deepEqual(answered.state.configuration, { state: "Absent" });
  assert.deepEqual(ticketDetailActions(answered.state), {
    edit: false,
    delete: false,
    release: false,
  });
});

test("execution continuation retains earlier rows and remains ticket scoped", () => {
  const initial = ticketDetailInitial("token", partition, 7, 1);
  const first = ticketDetailExecutionsReceived(initial.state, {
    outcome: "Ok",
    body: { executions: [execution("first")], nextAfter: "cursor" },
  });
  const next = ticketDetailExecutionsNext(first, "token", partition, 1);
  assert.ok(next);
  assert.equal(
    next.request.url,
    "/api/v1/tenants/acme/projects/atlas/executions?after=cursor&limit=1&ticket=7",
  );
  const complete = ticketDetailExecutionsReceived(next.state, {
    outcome: "Ok",
    body: { executions: [execution("second")] },
  });
  assert.deepEqual(
    complete.executions.state === "Data"
      ? complete.executions.value.executions.map((row) => row.execution)
      : [],
    ["first", "second"],
  );
});

test("released and deleted authoring cannot expose draft mutations", () => {
  for (const state of ["Released", "Deleted"]) {
    const initial = ticketDetailInitial("token", partition, 7);
    const answered = ticketDetailDraftReceived(
      initial.state,
      { outcome: "Ok", body: draft(state) },
      "token",
      partition,
    );
    assert.deepEqual(ticketDetailActions(answered.state), {
      edit: false,
      delete: false,
      release: false,
    });
  }
});
