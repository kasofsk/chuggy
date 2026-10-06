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
import {
  ticketDeliveryDrawn,
  ticketDeliveryLines,
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

/** The state a read that answered `body` is in. */
function answered(body: unknown): TicketDeliveryState {
  return ticketDeliveryRead({
    state: "Ready",
    value: ticketActionReachResponseSchema.parse(body),
    observedAtMs: 7,
  });
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
  expect(ticketDeliverySummary(answered(deliveryEveryMark))).toBe(
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
    ),
  ).toBe("1 Waiting · 3 Reached");
});

test("a closed row says a read that did not answer was not read, and a row not drawn says nothing", () => {
  expect(ticketDeliverySummary({ state: "Failed", reason: "Fault" })).toBe(
    "Not read",
  );
  expect(ticketDeliverySummary({ state: "Absent", reason: "Absent" })).toBe(
    "Not read",
  );
  expect(ticketDeliverySummary({ state: "Pending" })).toBeUndefined();
  expect(ticketDeliverySummary(answered(ticketLandedNowhere))).toBeUndefined();
});

test("the read's state is kept as it stands, its answer alone turned into lines", () => {
  expect(answered(deliveryLandedWith([deliveryFailedBare]))).toEqual({
    state: "Ready",
    value: ticketDeliveryLines(deliveryLandedWith([deliveryFailedBare])),
    observedAtMs: 7,
  });
  const failed = { state: "Failed", reason: "Unreachable" } as const;
  expect(ticketDeliveryRead(failed)).toBe(failed);
});

test("the read is kept under its ticket's own key, apart from the ticket", () => {
  expect(ticketDeliveryResource(21)).toBe("21/action-reach");
});
