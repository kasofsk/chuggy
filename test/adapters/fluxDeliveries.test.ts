/**
 * Flux's own deliveries, sent to the report route over a connection as the
 * bytes that arrived and read by the `FluxSignature` scheme at the time each
 * arrived: what each is answered, and what of it reaches the store.
 *
 * THE STORE HERE ANSWERS `Recorded` TO EVERYTHING. What a report repeating
 * the newest comes to is the relation's to say, and the suite that runs
 * against a server asks it of the delivery Flux retried.
 */

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  fluxSignatureReporters,
  fluxSignatureToleranceSecs,
} from "../../src/adapters/reporters/fluxSignature.ts";
import {
  actionReporterRoster,
  actionReports,
  rosterActionReporters,
  type ActionReport,
} from "../../src/interpreter/actionReport.ts";
import { actionReportsApp } from "./actionReportFixtures.ts";
import {
  allFluxDeliveryNames,
  fluxDelivery,
  fluxDeliveryAnswered,
  fluxDeliveryKey,
  fluxDeliveryRequest,
  fluxDeliverySigned,
  fluxKeyFile,
  type FluxDelivery,
  type FluxDeliveryAnswered,
  type FluxDeliveryName,
} from "./fluxDeliveryFixtures.ts";
import { planeListening } from "./planeBodies.ts";

const address = { tenant: "vteng", project: "chuggy", action: "rig" } as const;
const route = `/api/v1/tenants/${address.tenant}/projects/${address.project}/actions/${address.action}/reports`;

const ignored: FluxDeliveryAnswered = {
  status: 200,
  body: { report: "Ignored" },
};
const recorded: FluxDeliveryAnswered = {
  status: 200,
  body: { report: "Recorded" },
};
const notFound: FluxDeliveryAnswered = {
  status: 404,
  body: { error: { code: "NotFound", message: "Resource not found." } },
};
const refused: FluxDeliveryAnswered = {
  status: 422,
  body: {
    error: { code: "ReportRefused", message: "The report could not be read." },
  },
};

const rolledOut = "5c720e5ca64a2fc7cda1bd8b9b2e72132353eac6";
const unhealthy = "500a9eed707289ca16595e96ec4de991cfdc96cb";

/** What each delivery is answered, and the report it is where it is one. */
const expected: Readonly<
  Record<FluxDeliveryName, readonly [FluxDeliveryAnswered, ActionReport?]>
> = {
  "dependency-not-ready": [ignored],
  progressing: [ignored],
  "reconciliation-succeeded": [
    recorded,
    {
      commit: rolledOut,
      outcome: "Succeeded",
      observedAtMs: Date.UTC(2026, 9, 5, 22, 45, 50),
      detail:
        "1791240292.0.0@sha256:5d0d8d68b6df6d9cfdea76619883b875793304f3999deef901db4b38cfa3f587",
    } as ActionReport,
  ],
  "health-check-failed": [
    recorded,
    {
      commit: unhealthy,
      outcome: "Failed",
      observedAtMs: Date.UTC(2026, 9, 5, 22, 49, 41),
      detail:
        "health check failed after 1m30.00664574s: timeout waiting for: [Deployment/chuggy/chuggy-api status: 'InProgress']",
    } as ActionReport,
  ],
  retried: [
    recorded,
    {
      commit: "8b2114bfd2a7d359dd13299f2ae5fc91d6cc6a8b",
      outcome: "Succeeded",
      observedAtMs: Date.UTC(2026, 9, 5, 22, 36, 19),
      detail:
        "1791239720.0.0@sha256:ba156c26ba34282008d7f929c9fbeb7e908a6bbf0e2903ca105de231cfa83cb2",
    } as ActionReport,
  ],
  unsigned: [notFound],
  "unsigned-new-artifact": [notFound],
  "constructed-escaped": [
    recorded,
    {
      commit: unhealthy,
      outcome: "Failed",
      observedAtMs: Date.UTC(2026, 9, 5, 22, 49, 41),
      detail:
        'Deployment/chuggy/chuggy-api dry-run failed (Invalid): Deployment.apps "chuggy-api" is invalid: spec.replicas: Invalid value: -1: must be >= 0 && <= 2147483647, got <nil>',
    } as ActionReport,
  ],
  "constructed-no-origin": [refused],
};

/** A server whose one reporter is Flux's for the action addressed, under the key given: what it answers a delivery arriving at an instant, and every report that reached its store. */
async function receiving(
  t: TestContext,
  key: string = fluxDeliveryKey,
): Promise<{
  readonly stored: ActionReport[];
  readonly answered: (
    delivery: FluxDelivery,
    atMs: number,
  ) => Promise<FluxDeliveryAnswered>;
}> {
  const roster = actionReporterRoster(
    JSON.stringify([
      {
        reporter: "rig-flux",
        scheme: "FluxSignature",
        secretFile: fluxKeyFile(t, key),
        tenant: address.tenant,
        project: address.project,
        actions: [address.action],
      },
    ]),
  );
  assert.equal(roster.read, "Roster");
  const clock = { nowMs: 0 };
  const stored: ActionReport[] = [];
  const unreached: string[] = [];
  const app = actionReportsApp(
    unreached,
    actionReports({
      reporters: rosterActionReporters(roster.reporters, {
        FluxSignature: fluxSignatureReporters(() => clock.nowMs),
      }),
      observations: {
        record: ({ report }) => {
          stored.push(report);
          return Promise.resolve("Recorded");
        },
      },
    }),
  );
  t.after(async () => {
    await app.close();
    assert.deepEqual(unreached, []);
  });
  const port = await planeListening(app);
  return {
    stored,
    answered: (delivery, atMs) => {
      clock.nowMs = atMs;
      return fluxDeliveryAnswered(port, route, delivery);
    },
  };
}

test("each delivery is answered as what its event says, at each time it arrived", async (t) => {
  for (const name of allFluxDeliveryNames) {
    const { stored, answered } = await receiving(t);
    const delivery = fluxDelivery(name);
    const [answer, report] = expected[name];
    for (const atMs of delivery.arrivedAtMs)
      assert.deepEqual(await answered(delivery, atMs), answer, name);
    assert.deepEqual(
      stored,
      report === undefined ? [] : delivery.arrivedAtMs.map(() => report),
      name,
    );
  }
});

test("the deliveries hold one of each event Flux was seen to send, and one it retried", () => {
  const said = (name: FluxDeliveryName) => {
    const event = JSON.parse(fluxDelivery(name).body.toString("utf8")) as {
      involvedObject: { kind: string };
      severity: string;
      reason: string;
    };
    return `${event.involvedObject.kind} ${event.severity} ${event.reason}`;
  };
  assert.deepEqual(
    [
      ...new Set(
        allFluxDeliveryNames
          .filter((name) => !name.startsWith("constructed-"))
          .map(said),
      ),
    ].sort(),
    [
      "Kustomization error HealthCheckFailed",
      "Kustomization info DependencyNotReady",
      "Kustomization info Progressing",
      "Kustomization info ReconciliationSucceeded",
      "OCIRepository info NewArtifact",
    ],
  );
  assert.ok(fluxDelivery("retried").arrivedAtMs.length > 1);
});

test("an event unsigned as it arrived is read as its kind once it is signed, and one of no Kustomization needs no origin revision", async (t) => {
  const { stored, answered } = await receiving(t);
  const artifact = fluxDelivery("unsigned-new-artifact");
  const [arrivedAtMs] = artifact.arrivedAtMs;
  assert.ok(arrivedAtMs !== undefined);
  assert.match(artifact.body.toString("utf8"), /@sha1:[0-9a-f]{40}'/u);
  assert.doesNotMatch(artifact.body.toString("utf8"), /originRevision/u);
  assert.deepEqual(
    await answered(fluxDeliverySigned(artifact), arrivedAtMs),
    ignored,
  );
  assert.deepEqual(stored, []);

  const reconciled = fluxDelivery("unsigned");
  assert.deepEqual(
    reconciled.body,
    fluxDelivery("reconciliation-succeeded").body,
  );
  assert.deepEqual(
    await answered(fluxDeliverySigned(reconciled), arrivedAtMs),
    notFound,
    "at another event's time",
  );
  for (const atMs of reconciled.arrivedAtMs)
    assert.deepEqual(
      await answered(fluxDeliverySigned(reconciled), atMs),
      recorded,
    );
  assert.deepEqual(stored, [expected["reconciliation-succeeded"][1]]);
});

test("a delivery is its reporter's under the key it was signed with and no other", async (t) => {
  const { stored, answered } = await receiving(t, `${fluxDeliveryKey}-rotated`);
  for (const name of allFluxDeliveryNames) {
    const delivery = fluxDelivery(name);
    for (const atMs of delivery.arrivedAtMs)
      assert.deepEqual(await answered(delivery, atMs), notFound, name);
  }
  assert.deepEqual(stored, []);
});

test("a delivery sent again once the tolerance has passed is not found", async (t) => {
  const { stored, answered } = await receiving(t);
  const delivery = fluxDelivery("reconciliation-succeeded");
  const report = expected["reconciliation-succeeded"][1];
  const observedAtMs = report?.observedAtMs;
  assert.ok(observedAtMs !== undefined);
  const toleranceMs = fluxSignatureToleranceSecs * 1_000;
  assert.deepEqual(
    await answered(delivery, observedAtMs + toleranceMs),
    recorded,
  );
  assert.deepEqual(
    await answered(delivery, observedAtMs + toleranceMs + 1),
    notFound,
  );
  assert.deepEqual(stored, [report]);
});

/** A body read and written back, as a server that parsed it before weighing it would hold it. */
function rewritten(body: Buffer): Buffer {
  return Buffer.from(JSON.stringify(JSON.parse(body.toString("utf8"))));
}

test("a signature is of the bytes sent: the same event written again is another body, and verifies nothing", async (t) => {
  const delivery = fluxDelivery("constructed-escaped");
  const [atMs] = delivery.arrivedAtMs;
  const again = rewritten(delivery.body);
  assert.notDeepEqual(again, delivery.body);
  assert.match(delivery.body.toString("utf8"), /\\u003e= 0 \\u0026\\u0026/u);
  assert.match(again.toString("utf8"), />= 0 && <= /u);

  const scheme = fluxSignatureReporters(() => atMs ?? 0);
  const file = fluxKeyFile(t, fluxDeliveryKey);
  const request = fluxDeliveryRequest(delivery, address);
  assert.deepEqual(await scheme.said(file, request), {
    said: "Report",
    report: expected["constructed-escaped"][1],
  });
  assert.equal(await scheme.said(file, { ...request, body: again }), undefined);
});

test("no captured delivery holds a byte a second writer writes otherwise, which is why one is constructed", () => {
  for (const name of allFluxDeliveryNames) {
    if (name.startsWith("constructed-")) continue;
    const { body } = fluxDelivery(name);
    assert.deepEqual(rewritten(body), body, name);
  }
});
