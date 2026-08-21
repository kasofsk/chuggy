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
import { selectorRunOnce } from "../../src/interpreter/selectorRuntime.ts";
import { selectorNativeSource } from "../../src/interpreter/selectorNativeSource.ts";
import {
  asPrincipal,
  asPublicInstant,
} from "../../src/interpreter/nativeWeb.ts";
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
  const outcome = {
    operation: delivery.operation,
    acceptedAt: asPublicInstant("2026-08-20T12:00:00Z"),
    state: "Refused",
    code: "SelectionChanged",
    refusedHead: 1,
    refusedLifecycleGeneration: 1,
  } as const;
  const reconciled = await reconcileSelectorProposal(
    stateStore((outcome) => {
      terminal = outcome;
    }),
    {
      operation: () => Promise.resolve(outcome),
    },
    delivery,
  );
  assert.equal(reconciled, true);
  assert.deepEqual(terminal, outcome);
});

test("selector delivery does not disguise a state-store failure as a retry", async () => {
  await assert.rejects(
    deliverSelectorProposal(
      {
        ...stateStore(() => undefined),
        submitted: () => Promise.reject(new Error("state unavailable")),
      },
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
    ),
    /state unavailable/,
  );
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

test("a failing project cannot starve durable proposal delivery", async () => {
  let submitted = 0;
  const store = {
    ...stateStore(() => undefined),
    pending: () => Promise.resolve([delivery]),
    submitted: () => {
      submitted += 1;
      return Promise.resolve();
    },
  };
  const result = await selectorRunOnce(
    store,
    {
      projects: () => Promise.resolve([partition]),
      notifications: () =>
        Promise.resolve({ result: "Events", cursor: 0, events: [] } as const),
      dispatchView: () =>
        Promise.resolve({
          result: "Page",
          token: delivery.command.observedViewToken,
          candidates: [],
          notificationCursor: 0,
        } as const),
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
      operation: () => Promise.resolve(undefined),
    },
    { decide: () => Promise.reject(new Error("provider unavailable")) },
    {
      next: () => ({
        operation: asOperationId("next-operation"),
        selectorDecisionReference: "next-decision",
      }),
    },
  );
  assert.equal(result.delivered, 1);
  assert.equal(result.proposed, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.phase, "Observation");
  assert.equal(submitted, 1);
});

test("selector inventory progress stops before a failed project", async () => {
  const second = {
    tenant: partition.tenant,
    project: asProjectId("second-project"),
  };
  let saved: typeof partition | undefined;
  const result = await selectorRunOnce(
    {
      ...stateStore(() => undefined),
      saveInventoryCursor: (cursor) => {
        saved = cursor;
        return Promise.resolve();
      },
    },
    {
      projects: () => Promise.resolve([partition, second]),
      notifications: (current) =>
        current.project === second.project
          ? Promise.reject(new Error("notifications unavailable"))
          : Promise.resolve({ result: "Events", cursor: 0, events: [] }),
      dispatchView: (current) =>
        Promise.resolve({
          result: "Page",
          token: { ...delivery.command.observedViewToken, ...current },
          candidates: [],
          notificationCursor: 0,
        }),
      submit: () => Promise.reject(new Error("unexpected submission")),
      operation: () => Promise.resolve(undefined),
    },
    {
      decide: (observation) =>
        Promise.resolve({
          interaction: {
            decision: "next-decision",
            partition,
            instructionsVersion: "instructions",
            instructions: "wait",
            observedView: observation.candidates,
            context: {},
            toolActivity: [],
            result: {},
            implementationRevision: "implementation",
            modelRevision: "model",
            policyRevision: "policy",
            accounting: {},
            startedAt: "2026-08-21T00:00:00.000Z",
            completedAt: "2026-08-21T00:00:01.000Z",
          },
          attention: "Monitoring",
        }),
    },
    {
      next: (current) => ({
        operation: asOperationId(`operation-${current.project}`),
        selectorDecisionReference: "next-decision",
      }),
    },
    { projectsMax: 2, deliveriesMax: 1, reconciliationsMax: 1 },
  );
  assert.equal(result.failures.length, 1);
  assert.deepEqual(saved, partition);
});

test("selector native source uses the authenticated API and stable delivery identity", async () => {
  const principal = asPrincipal("selector-principal");
  let submittedKey: string | undefined;
  const source = selectorNativeSource(
    {
      projectInventory: (foundPrincipal) => {
        assert.equal(foundPrincipal, principal);
        return Promise.resolve([partition]);
      },
      notifications: () =>
        Promise.resolve({
          result: "Authorized",
          value: { result: "Events", cursor: 0, events: [] },
        }),
      dispatchView: () =>
        Promise.resolve({
          result: "Authorized",
          value: {
            result: "Page",
            token: delivery.command.observedViewToken,
            candidates: [],
            notificationCursor: 0,
          },
        }),
      submit: (_principal, submission) => {
        submittedKey = submission.key;
        return Promise.resolve({
          result: "Authorized",
          acceptance: { accepted: "InvalidCommand" },
        });
      },
      operation: () => Promise.resolve(undefined),
    },
    principal,
  );
  assert.deepEqual(await source.projects(undefined, 1), [partition]);
  assert.deepEqual(await source.submit(delivery), {
    accepted: "InvalidCommand",
  });
  assert.equal(submittedKey, delivery.decision);
});
