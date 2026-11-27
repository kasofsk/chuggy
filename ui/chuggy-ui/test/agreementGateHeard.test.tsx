/**
 * The agreement gate hearing the API refuse a signed-in person for want of
 * agreement, at either door: the store's own ports and the screens', joined
 * as `main.tsx` joins them. Several such answers read the standing once, the
 * router drawn while it is unanswered; its answer draws the page, under the
 * changed notice where the gate had passed by a standing and under none where
 * the deployment did not ask, the router where every policy is agreed, or the
 * page that could not read. Agreeing draws the router again, its refused read
 * asked again and its refused write not sent again.
 */

import { act, cleanup, screen } from "@testing-library/react";
import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";
import { afterEach, expect, test, vi } from "vitest";

import { agreementRequiredCode } from "../../../src/contract/rosters.ts";

import type { ConsoleState } from "../app/browser/store.ts";
import type { ConsoleExtra } from "../app/browser/storeExtra.ts";
import { apiSend } from "../app/core/apiRequest.ts";
import {
  agreementMounted as mounted,
  agreementRequests as requests,
  agreementSendPath as sendPath,
  agreementStandingPath as standingPath,
} from "./agreementGateDrawn.tsx";
import type { AgreementMounted } from "./agreementGateDrawn.tsx";
import {
  agreementPrivacy as privacy,
  agreementTerms as terms,
} from "./agreementPolicies.ts";
import {
  agreementRoutedContent as routedContent,
  agreementRoutedReadPath as readPath,
  agreementRoutedWritePath as writePath,
} from "./agreementRouted.tsx";
import { centeredPageSaid } from "./centeredPageDrawn.ts";
import { answer, heldAnswer, press, settled } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";

vi.mock("../app/browser/routes.tsx", () => ({ consoleRouter: {} }));
vi.mock("@tanstack/react-router", async () => {
  const { AgreementRouted } = await import("./agreementRouted.tsx");
  return {
    RouterProvider: AgreementRouted,
    createLink: (component: unknown) => component,
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const agreedAt = "2026-11-27T10:00:00Z";
const halfAgreed = { policies: [{ ...terms, agreedAt }, privacy] };
const allAgreed = {
  policies: [
    { ...terms, agreedAt },
    { ...privacy, agreedAt },
  ],
};
const notRead = () =>
  answer({ error: { code: "InternalError", message: "no" } }, 500);
const refused = () =>
  answer({ error: { code: agreementRequiredCode, message: "agree" } }, 403);

/** An API that refuses every read and write outside `/agreements/v1` for want
 * of agreement while `api.asking` and not `api.agreed`, answers the standing
 * from `standings` in turn and a send with every policy agreed. */
interface Scripted {
  asking: boolean;
  agreed: boolean;
  readonly standings: (() => Response | Promise<Response>)[];
  readonly answered: (request: SentRequest) => Response | Promise<Response>;
}

function scripted(asking: boolean): Scripted {
  const api: Scripted = {
    asking,
    agreed: false,
    standings: [],
    answered: (request) => {
      if (request.url === standingPath)
        return (api.standings.shift() ?? (() => answer(allAgreed)))();
      if (request.url === sendPath) {
        api.agreed = true;
        return answer(allAgreed);
      }
      if (api.asking && !api.agreed) return refused();
      return request.url === readPath ? answer({}) : answer({}, 204);
    },
  };
  return api;
}

function routed(): boolean {
  return screen.queryByText("Routed") !== null;
}

type Sent = ThunkAction<
  Promise<void>,
  ConsoleState,
  ConsoleExtra,
  UnknownAction
>;

/** A write sent on the store's own ports, as a thunk sends one. */
function storeSent(): Sent {
  return async (_dispatch, _state, extra) => {
    await apiSend(extra.ports, { method: "PUT", path: writePath, body: {} });
  };
}

const doors = [
  [
    "the store's own ports",
    async (root: AgreementMounted, times: number) => {
      await act(async () => {
        for (let sent = 0; sent < times; sent += 1)
          void root.store.dispatch(storeSent());
        await settled();
      });
    },
  ],
  [
    "the screens' ports",
    async (_root: AgreementMounted, times: number) => {
      for (let sent = 0; sent < times; sent += 1) await press("Write");
    },
  ],
] as const;

const heardTimes = 3;

test.each(
  doors.flatMap(([door, heard]) =>
    (
      [
        [
          "a policy unagreed draws the page under the changed notice",
          () => answer(halfAgreed),
          () => {
            expect(routed()).toBe(false);
            expect(centeredPageSaid().title).toBe("Agree to continue");
            expect(screen.getByRole("status").textContent).toBe(
              "These changed while this page was open.",
            );
          },
        ],
        [
          "every policy agreed leaves the router drawn",
          () => answer(allAgreed),
          () => {
            expect(routed()).toBe(true);
          },
        ],
        [
          "a standing not read draws the page that says so",
          notRead,
          () => {
            expect(routed()).toBe(false);
            expect(centeredPageSaid()).toStrictEqual({
              title: "Agreements not read",
              actions: ["Retry", "Sign out"],
            });
          },
        ],
      ] as const
    ).map(([outcome, standing, drawn]) => ({
      door,
      heard,
      outcome,
      standing,
      drawn,
    })),
  ),
)(
  "heard at $door after a pass by a standing, several refusals read it once under the router, and $outcome",
  async ({ heard, standing, drawn }) => {
    const api = scripted(false);
    const held = heldAnswer();
    api.standings.push(
      () => answer(allAgreed),
      () => held.answered,
    );
    const root = await mounted(api.answered);
    expect(routed()).toBe(true);
    api.asking = true;
    await heard(root, heardTimes);
    expect(requests(root.sent)).toStrictEqual([
      `GET ${standingPath}`,
      `GET ${standingPath}`,
    ]);
    expect(routed()).toBe(true);
    expect(screen.queryByText("Opening chuggy")).toBeNull();
    await act(async () => {
      held.release(standing());
      await settled();
    });
    drawn();
    expect(requests(root.sent)).toStrictEqual([
      `GET ${standingPath}`,
      `GET ${standingPath}`,
    ]);
  },
);

test.each([
  ["absent", {}],
  ["false", { agreements: false }],
])(
  "with agreements %s, the router is drawn with nothing asked under /agreements/v1, and a refusal heard draws the page with no notice",
  async (_named, configuration) => {
    const api = scripted(false);
    api.standings.push(() => answer(halfAgreed));
    const root = await mounted(api.answered, configuration);
    expect(routed()).toBe(true);
    expect(screen.getByText(routedContent)).toBeTruthy();
    expect(requests(root.sent)).toStrictEqual([]);
    api.asking = true;
    await press("Write");
    expect(requests(root.sent)).toStrictEqual([`GET ${standingPath}`]);
    expect(centeredPageSaid().title).toBe("Agree to continue");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

test("agreeing on the page draws the router again, its refused read asked again and its refused write not sent again", async () => {
  const api = scripted(true);
  const held = heldAnswer();
  api.standings.push(() => held.answered);
  const root = await mounted(api.answered, {});
  expect(routed()).toBe(true);
  expect(screen.getByText("Read failed")).toBeTruthy();
  await press("Write");
  await act(async () => {
    held.release(answer(halfAgreed));
    await settled();
  });
  expect(routed()).toBe(false);
  await press("Agree and continue");
  expect(routed()).toBe(true);
  expect(screen.getByText(routedContent)).toBeTruthy();
  const sent = root.sent.map((request) => `${request.method} ${request.url}`);
  expect(sent.filter((line) => line === `GET ${readPath}`)).toHaveLength(2);
  expect(sent.filter((line) => line === `PUT ${writePath}`)).toHaveLength(1);
  expect(requests(root.sent)).toStrictEqual([
    `GET ${standingPath}`,
    `POST ${sendPath}`,
  ]);
});

test("a read kept since it landed and then refused for want of agreement is asked again once the person agrees", async () => {
  const api = scripted(false);
  api.standings.push(() => answer(halfAgreed));
  const root = await mounted(api.answered, {});
  expect(screen.getByText(routedContent)).toBeTruthy();
  api.asking = true;
  await press("Read again");
  expect(routed()).toBe(false);
  await press("Agree and continue");
  expect(routed()).toBe(true);
  expect(root.sent.filter((request) => request.url === readPath)).toHaveLength(
    3,
  );
});
