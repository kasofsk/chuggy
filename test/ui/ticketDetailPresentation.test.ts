import assert from "node:assert/strict";
import test from "node:test";
import { content, elements } from "./domHarness.ts";
import type { TestElement } from "./domHarness.ts";

const detailPresentationModule = "../../ui/console/dom/ticketDetailView.js";
const { ticketDetailPage } = (await import(detailPresentationModule)) as {
  ticketDetailPage: (controller: unknown) => unknown;
};

function controller(draftState = "Draft") {
  return {
    state: {
      detail: {
        ticket: 7,
        identity: {
          state: "Data",
          value: { ticket: 7, phase: "Working", sequence: 19 },
        },
        draft: {
          state: "Data",
          value: {
            partition: { tenant: "acme", project: "atlas" },
            ticket: 7,
            authoringVersion: 2,
            state: draftState,
            configurationRevision: "revision-1",
            authoring: {
              dependencies: [2],
              program: [{ fanout: 1, combinator: "UnanimousPass" }],
              workFanout: 1,
              reworkPolicy: { type: "BudgetedRework", value: 0 },
              finalizationPricing: "DeadlineOnly",
              resumePricing: "RetryCharged",
              finalizer: "ManagedFinalizer",
            },
          },
        },
        configuration: {
          state: "Data",
          value: {
            partition: { tenant: "acme", project: "atlas" },
            revision: "revision-1",
            parent: undefined,
            canonical: '{"image":"worker:v1"}',
            digest: "digest-1",
          },
        },
        executions: {
          state: "Data",
          value: {
            executions: [
              {
                execution: "execution-1",
                ticket: 7,
                task: 1,
                taskKind: "Work",
                stage: undefined,
                cluster: "primary",
                configurationRevision: "revision-1",
                status: "Terminal",
                outcome: "Passed",
                retriesSpent: 0,
                registeredAt: "2026-08-24T12:00:00Z",
                terminalAt: undefined,
              },
            ],
          },
        },
      },
    },
    edit: () => undefined,
    delete: () => undefined,
    release: () => undefined,
    openExecution: () => undefined,
    nextExecutions: () => Promise.resolve(),
  };
}

test("ticket detail presents identity, full configuration, authoring, and outcomes", () => {
  const page = ticketDetailPage(controller()) as TestElement;
  const rendered = content(page);
  assert.match(rendered, /#7/);
  assert.match(rendered, /PhaseWorking/);
  assert.match(rendered, /Latest sequence19/);
  assert.match(rendered, /Revisionrevision-1/);
  assert.match(rendered, /worker:v1/);
  assert.match(rendered, /Dependencies2/);
  assert.match(rendered, /execution-1 · Work · Terminal · Passed/);
  assert.deepEqual(elements(page, "button").map(content), [
    "Release",
    "execution-1",
  ]);
});

test("released tickets do not render draft mutation actions", () => {
  const page = ticketDetailPage(controller("Released")) as TestElement;
  assert.deepEqual(elements(page, "button").map(content), ["execution-1"]);
});

test("failed reads remain explicit while retained content stays visible", () => {
  const ready = controller();
  const subject = {
    ...ready,
    state: {
      detail: {
        ...ready.state.detail,
        identity: {
          state: "Error" as const,
          held: { ticket: 7, phase: "Working", sequence: 19 },
          error: {
            kind: "Unavailable" as const,
            reason: "Ticket refresh failed.",
          },
        },
      },
    },
  };
  const page = ticketDetailPage(subject) as TestElement;
  assert.match(content(page), /Ticket refresh failed/);
  assert.match(content(page), /PhaseWorking/);
  assert.equal(elements(page, "p")[0]?.attributes.get("role"), "alert");
});
