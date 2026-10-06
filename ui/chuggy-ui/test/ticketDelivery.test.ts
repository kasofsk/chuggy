/**
 * What the Delivery row draws of the read's answer, held over fixtures of the
 * response: a line an action at each mark, what of a report a line carries,
 * and the answers that draw no row at all.
 */

import { expect, test } from "vitest";

import {
  allActionReaches,
  ticketActionReachResponseSchema,
} from "../../../src/contract/actionReach.ts";
import { apiTimeoutMsDefault } from "../app/core/apiRequest.ts";
import {
  freshnessIsStale,
  freshnessStaleAfterMs,
} from "../app/core/freshness.ts";
import {
  ticketDeliveryDrawn,
  ticketDeliveryLines,
  ticketDeliveryPolledMs,
  ticketDeliveryRead,
  ticketDeliveryResource,
  ticketDeliverySummary,
} from "../app/core/ticketDelivery.ts";
import type { TicketDeliveryState } from "../app/core/ticketDelivery.ts";
import { ticketLandedNowhere } from "./screenHarness.tsx";
import {
  deliveryAction,
  deliveryDetail,
  deliveryEveryMark,
  deliveryFailedBare,
  deliveryFailedWhole,
  deliveryLandedWith,
  deliveryLink,
  deliveryReported,
  deliveryReportWhole,
} from "./ticketDeliveryFixture.ts";

const reported = { text: "43a251a", title: deliveryReported };
const linked = { href: deliveryLink, host: "grafana.example.test" };

/** The state a read is in once it answered `body` at `observedAtMs`. */
function answeredAt(
  body: unknown,
  observedAtMs: number | undefined,
): TicketDeliveryState {
  return ticketDeliveryRead({
    state: "Ready",
    value: ticketActionReachResponseSchema.parse(body),
    observedAtMs,
  });
}

/** When a case that says nothing of its answer's age read it. */
const answeredAtMs = 7;

/** The state a read that answered `body` is in. */
function answered(body: unknown): TicketDeliveryState {
  return answeredAt(body, answeredAtMs);
}

test("every body the suites draw from is one the read can answer", () => {
  for (const body of [
    deliveryEveryMark,
    ticketLandedNowhere,
    deliveryLandedWith([]),
    deliveryLandedWith([deliveryFailedWhole, deliveryFailedBare]),
  ])
    expect(ticketActionReachResponseSchema.parse(body)).toEqual(body);
  expect(
    deliveryEveryMark.actions.map((action) => action.reach).sort(),
  ).toEqual([...allActionReaches].sort());
});

test("each declared action is one line at its mark, in the order the read gives them", () => {
  expect(ticketDeliveryLines(deliveryEveryMark)).toEqual([
    {
      action: "build-api",
      name: "API image",
      reach: "Reached",
      commit: reported,
      detail: undefined,
      link: linked,
    },
    {
      action: "build-console",
      name: "Console image",
      reach: "NotYet",
      commit: undefined,
      detail: undefined,
      link: undefined,
    },
    {
      action: "publish",
      name: "Release published",
      reach: "Failed",
      commit: reported,
      detail: deliveryDetail,
      link: linked,
    },
    {
      action: "rig",
      name: "Rig",
      reach: "RolledBack",
      commit: reported,
      detail: undefined,
      link: undefined,
    },
    {
      action: "smoke",
      name: "Smoke",
      reach: "Unknown",
      commit: undefined,
      detail: undefined,
      link: undefined,
    },
  ]);
});

test("a failure carries its reporter's detail and link, and one given neither carries its commit alone", () => {
  const [whole, bare] = ticketDeliveryLines(
    deliveryLandedWith([deliveryFailedWhole, deliveryFailedBare]),
  );
  expect(whole).toMatchObject({ detail: deliveryDetail, link: linked });
  expect(bare).toMatchObject({
    reach: "Failed",
    commit: reported,
    detail: undefined,
    link: undefined,
  });
});

test("a link is carried at every mark read from a report, and a detail at a failure alone", () => {
  const lines = ticketDeliveryLines(
    deliveryLandedWith([
      deliveryAction("a", "A", "Reached", deliveryReportWhole),
      deliveryAction("b", "B", "RolledBack", deliveryReportWhole),
      deliveryAction("c", "C", "Failed", deliveryReportWhole),
    ]),
  );
  expect(lines.map((line) => line.link)).toEqual([linked, linked, linked]);
  expect(lines.map((line) => line.detail)).toEqual([
    undefined,
    undefined,
    deliveryDetail,
  ]);
});

test("a link is offered under the host it names and pressed as the address it is", () => {
  const link = "https://logs.example.test:8443/run?next=https://other.example/";
  const [line] = ticketDeliveryLines(
    deliveryLandedWith([
      deliveryAction("a", "A", "Reached", { ...deliveryReportWhole, link }),
    ]),
  );
  expect(line?.link).toEqual({ href: link, host: "logs.example.test:8443" });
});

test("a row is drawn for a line to show and for a read that did not answer, and for nothing else", () => {
  const drawn: readonly (readonly [string, TicketDeliveryState, boolean])[] = [
    ["a read still out", { state: "Pending" }, false],
    ["a ticket that landed nowhere", answered(ticketLandedNowhere), false],
    ["a repository declaring nothing", answered(deliveryLandedWith([])), false],
    ["a landed ticket", answered(deliveryEveryMark), true],
    [
      "a landed ticket with one action",
      answered(deliveryLandedWith([deliveryFailedBare])),
      true,
    ],
    ["a read that failed", { state: "Failed", reason: "Fault" }, true],
    ["a read with no answer", { state: "Absent", reason: "Absent" }, true],
  ];
  for (const [what, state, expected] of drawn)
    expect(ticketDeliveryDrawn(state), what).toBe(expected);
});

test("a closed row counts its lines by mark, what went wrong first", () => {
  expect(ticketDeliverySummary(answered(deliveryEveryMark), answeredAtMs)).toBe(
    "1 Failed · 1 Rolled back · 1 Unknown · 1 Waiting · 1 Reached",
  );
  expect(
    ticketDeliverySummary(
      answered(
        deliveryLandedWith([
          deliveryAction("a", "A", "Reached"),
          deliveryAction("b", "B", "NotYet"),
          deliveryAction("c", "C", "Reached"),
          deliveryAction("d", "D", "Reached"),
        ]),
      ),
      answeredAtMs,
    ),
  ).toBe("1 Waiting · 3 Reached");
});

test("a closed row says an answer kept past the console's stale wait is stale, before its counts", () => {
  const kept = answered(
    deliveryLandedWith([
      deliveryAction("a", "A", "Reached"),
      deliveryAction("b", "B", "NotYet"),
    ]),
  );
  const staleAtMs = answeredAtMs + freshnessStaleAfterMs;
  expect(ticketDeliverySummary(kept, staleAtMs - 1)).toBe(
    "1 Waiting · 1 Reached",
  );
  expect(ticketDeliverySummary(kept, staleAtMs)).toBe(
    "Stale · 1 Waiting · 1 Reached",
  );
});

test("an answer is stale to a closed row exactly when the console's own rule says it is", () => {
  const nowMs = 10 * freshnessStaleAfterMs;
  for (const at of [
    undefined,
    0,
    nowMs - freshnessStaleAfterMs,
    nowMs - freshnessStaleAfterMs + 1,
    nowMs,
    nowMs + 1,
  ])
    expect(
      ticketDeliverySummary(
        answeredAt(deliveryEveryMark, at),
        nowMs,
      )?.startsWith("Stale · "),
      String(at),
    ).toBe(freshnessIsStale(nowMs, at));
});

test("the slowest read that answers lands before the answer it replaces is stale", () => {
  expect(ticketDeliveryPolledMs + apiTimeoutMsDefault).toBeLessThan(
    freshnessStaleAfterMs,
  );
});

test("a closed row says a read that did not answer was not read, and a row not drawn says nothing, whatever the clock", () => {
  for (const nowMs of [answeredAtMs, answeredAtMs + freshnessStaleAfterMs]) {
    expect(
      ticketDeliverySummary({ state: "Failed", reason: "Fault" }, nowMs),
    ).toBe("Not read");
    expect(
      ticketDeliverySummary({ state: "Absent", reason: "Absent" }, nowMs),
    ).toBe("Not read");
    expect(ticketDeliverySummary({ state: "Pending" }, nowMs)).toBeUndefined();
    expect(
      ticketDeliverySummary(answered(ticketLandedNowhere), nowMs),
    ).toBeUndefined();
  }
});

test("the read's state is kept as it stands, its answer alone turned into lines", () => {
  expect(answered(deliveryLandedWith([deliveryFailedBare]))).toEqual({
    state: "Ready",
    value: ticketDeliveryLines(deliveryLandedWith([deliveryFailedBare])),
    observedAtMs: answeredAtMs,
  });
  const failed = { state: "Failed", reason: "Unreachable" } as const;
  expect(ticketDeliveryRead(failed)).toBe(failed);
});

test("the read is kept under its ticket's own key, apart from the ticket", () => {
  expect(ticketDeliveryResource(21)).toBe("21/action-reach");
});
