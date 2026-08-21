import assert from "node:assert/strict";
import { test } from "node:test";

import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { observeSelectorProject } from "../../src/interpreter/selector.ts";
import {
  deliverSelectorProposal,
  reconcileSelectorProposal,
  type SelectorDelivery,
  type SelectorStateStore,
} from "../../src/interpreter/selector.ts";
import { selectorHistory } from "../../src/interpreter/selectorHistory.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asAuthorityKind,
  asOperationId,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const deliveryAuthority = {
  kind: asAuthorityKind("Selector"),
  subject: asAuthoritySubject("selector"),
};

const delivery: SelectorDelivery = {
  decision: "decision",
  partition,
  operation: asOperationId("operation"),
  attempts: 0,
  command: {
    version: 1,
    command: "ProposeDispatch",
    ticket: asTicketId(1),
    expectedTicketVersion: 1,
    observedViewToken: {
      ...partition,
      recoveryEpoch: "epoch",
      schemaVersion: 1,
      watermark: 1,
      digest: "a".repeat(64),
    },
    selectorDecisionReference: "decision",
  },
};

function stateStore(
  onTerminal: (outcome: unknown) => void,
): SelectorStateStore {
  return {
    inventoryCursor: () => Promise.resolve(undefined),
    saveInventoryCursor: () => Promise.resolve(),
    recordInteraction: () => Promise.resolve(true),
    record: () => Promise.resolve(true),
    pending: () => Promise.resolve([]),
    submittedDeliveries: () => Promise.resolve([]),
    submitted: () => Promise.resolve(),
    terminal: (_decision, outcome) => {
      onTerminal(outcome);
      return Promise.resolve();
    },
    history: () => Promise.resolve([]),
    project: () => Promise.resolve(undefined),
  };
}

test("selector observation resumes from a reset cursor and pins every view page", async () => {
  const watermarks: (number | undefined)[] = [];
  const observed = await observeSelectorProject(
    { partition, notificationCursor: 3, attention: "Monitoring" },
    {
      notifications: () => Promise.resolve({ result: "Reset", cursor: 12 }),
      dispatchView: (_partition, query) => {
        watermarks.push(query.token?.watermark);
        return Promise.resolve({
          result: "Page",
          token: {
            ...partition,
            recoveryEpoch: "epoch",
            schemaVersion: 1,
            watermark: 20,
            digest: "a".repeat(64),
          },
          candidates: [],
          notificationCursor: 12,
        } as const);
      },
    },
  );
  assert.equal(observed?.notificationCursor, 12);
  assert.deepEqual(watermarks, [undefined]);
});

test("selector observation discards a view when a later page resets", async () => {
  let page = 0;
  let firstToken: typeof delivery.command.observedViewToken | undefined;
  const observed = await observeSelectorProject(
    { partition, notificationCursor: 0, attention: "Monitoring" },
    {
      notifications: () =>
        Promise.resolve({ result: "Events", cursor: 0, events: [] } as const),
      dispatchView: (_partition, query) => {
        page += 1;
        if (page === 2) {
          assert.deepEqual(query.token, firstToken);
          return Promise.resolve({ result: "Reset" } as const);
        }
        firstToken = {
          ...partition,
          recoveryEpoch: "epoch",
          schemaVersion: 1,
          watermark: 1,
          digest: "b".repeat(64),
        };
        return Promise.resolve({
          result: "Page",
          token: firstToken,
          candidates: [],
          nextAfter: asTicketId(1),
          notificationCursor: 0,
        } as const);
      },
    },
  );
  assert.equal(observed, undefined);
});

test("ambiguous proposal delivery retries through ordinary operation idempotency", async () => {
  let submitted = 0;
  const store = {
    ...stateStore(() => undefined),
    submitted: () => {
      submitted += 1;
      return Promise.resolve();
    },
  };
  const ambiguous = await deliverSelectorProposal(
    store,
    {
      submit: () => Promise.reject(new Error("connection lost")),
    },
    delivery,
  );
  assert.equal(ambiguous.result, "Retry");
  const retried = await deliverSelectorProposal(
    store,
    {
      submit: () =>
        Promise.resolve({
          accepted: "Original",
          operation: {
            partition,
            operation: delivery.operation,
            ordinal: 1,
            state: "Pending",
            authorityKind: asAuthorityKind("Selector"),
            admission: "Ordinary",
            lifecycleGeneration: 1,
          },
        }),
    },
    delivery,
  );
  assert.equal(retried.result, "Delivered");
  assert.equal(submitted, 1);
});

test("accepted selector delivery reconciles its terminal operation outcome", async () => {
  let terminal: unknown;
  const reconciled = await reconcileSelectorProposal(
    stateStore((outcome) => {
      terminal = outcome;
    }),
    {
      operation: () =>
        Promise.resolve({ state: "Refused", code: "SelectionChanged" }),
    },
    delivery,
  );
  assert.equal(reconciled, true);
  assert.deepEqual(terminal, { state: "Refused", code: "SelectionChanged" });
});

test("authorized selector history exposes its durable continuation cursor", async () => {
  const store = {
    ...stateStore(() => undefined),
    history: () =>
      Promise.resolve([
        {
          ordinal: 41,
          decision: "decision-41",
          partition,
          instructionsVersion: "instructions-1",
          instructions: "wait",
          observedView: [],
          context: {},
          toolActivity: [],
          result: {},
          implementationRevision: "implementation-1",
          modelRevision: "model-1",
          policyRevision: "policy-1",
          accounting: {},
          startedAt: "2026-08-20T12:00:00.000Z",
          completedAt: "2026-08-20T12:00:01.000Z",
        },
      ]),
  };
  const history = selectorHistory(
    { authorize: () => Promise.resolve(deliveryAuthority) },
    store,
  );
  const found = await history.read(
    asPrincipal("principal"),
    partition,
    undefined,
    1,
  );
  assert.equal(found.result, "Found");
  if (found.result === "Found") assert.equal(found.nextAfter, 41);
});
