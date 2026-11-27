/**
 * The agreement gate as the console's root draws it: nothing read under
 * `/agreements/v1` where the deployment does not ask for agreement; the
 * router where every policy is agreed; the page listing what is not, its send
 * made once and naming exactly that; what each answer of the send draws; the
 * page drawn where the standing could not be read; and a renewal of the
 * session reading nothing again.
 *
 * `App` is mocked no further than the route tree, which draws a marker here
 * so that the router being drawn can be seen.
 */

import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { agreementPoliciesChangedCode } from "../../../src/contract/agreementPlane.ts";

import {
  agreementMounted as mounted,
  agreementRequests as requests,
  agreementSendPath as sendPath,
  agreementStandingPath as standingPath,
} from "./agreementGateDrawn.tsx";
import {
  agreementPrivacy as privacy,
  agreementTerms as terms,
} from "./agreementPolicies.ts";
import { centeredPageSaid } from "./centeredPageDrawn.ts";
import { answer, heldAnswer, press, settled } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";

vi.mock("../app/browser/routes.tsx", () => ({ consoleRouter: {} }));
vi.mock("@tanstack/react-router", () => ({
  RouterProvider: () => "Routed",
  createLink: (component: unknown) => component,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const agreedAt = "2026-11-27T10:00:00Z";

/** The terms agreed and the privacy policy not. */
const halfAgreed = { policies: [{ ...terms, agreedAt }, privacy] };

const allAgreed = {
  policies: [
    { ...terms, agreedAt },
    { ...privacy, agreedAt },
  ],
};

function routed(): boolean {
  return screen.queryByText("Routed") !== null;
}

function agreeButton(): HTMLElement {
  return screen.getByRole("button", { name: "Agree and continue" });
}

/** A standing read answered `standing`, and every send `sent`. */
function served(
  standing: () => Response | Promise<Response>,
  sent: (request: SentRequest) => Response | Promise<Response> = () =>
    answer(allAgreed),
): (request: SentRequest) => Response | Promise<Response> {
  return (request) =>
    request.url === standingPath ? standing() : sent(request);
}

test.each([
  ["absent", {}],
  ["false", { agreements: false }],
])(
  "with agreements %s, a signed-in start reads nothing under /agreements/v1 and draws the router",
  async (_named, configuration) => {
    const { sent } = await mounted(
      served(() => answer(halfAgreed)),
      configuration,
    );
    expect(routed()).toBe(true);
    expect(requests(sent)).toStrictEqual([]);
  },
);

test("the opening card is drawn until the standing answers, and a standing fully agreed draws the router", async () => {
  const held = heldAnswer();
  const { sent } = await mounted(served(() => held.answered));
  expect(centeredPageSaid().title).toBe("Opening chuggy");
  expect(routed()).toBe(false);
  await act(async () => {
    held.release(answer(allAgreed));
    await settled();
  });
  expect(routed()).toBe(true);
  expect(requests(sent)).toStrictEqual([`GET ${standingPath}`]);
});

test("a standing with one of two policies unagreed draws the page listing that one, a link to its text in a tab of its own", async () => {
  await mounted(served(() => answer(halfAgreed)));
  expect(routed()).toBe(false);
  expect(centeredPageSaid()).toStrictEqual({
    title: "Agree to continue",
    actions: ["Agree and continue", "Sign out"],
  });
  expect(
    screen.getByText("Using chuggy needs your agreement to:"),
  ).toBeTruthy();
  const links = screen.getAllByRole("link");
  expect(links.map((link) => link.textContent)).toStrictEqual([privacy.title]);
  const [link] = links;
  expect(link?.getAttribute("href")).toBe(privacy.url);
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(screen.getByText(privacy.version)).toBeTruthy();
  expect(screen.queryByText(terms.title)).toBeNull();
});

test("a press sends exactly the policy listed, once however often it is pressed while unanswered, and an answer agreeing to all draws the router", async () => {
  const held = heldAnswer();
  const { sent } = await mounted(
    served(
      () => answer(halfAgreed),
      () => held.answered,
    ),
  );
  await press("Agree and continue");
  expect(agreeButton().getAttribute("aria-busy")).toBe("true");
  expect(agreeButton().hasAttribute("disabled")).toBe(true);
  await press("Agree and continue");
  await press("Agree and continue");
  const sends = sent.filter((request) => request.url === sendPath);
  expect(sends.map((request) => [request.method, request.body])).toStrictEqual([
    [
      "POST",
      {
        agreements: [
          {
            policy: privacy.policy,
            version: privacy.version,
            digest: privacy.digest,
          },
        ],
      },
    ],
  ]);
  await act(async () => {
    held.release(answer(allAgreed));
    await settled();
  });
  expect(routed()).toBe(true);
  expect(requests(sent)).toStrictEqual([
    `GET ${standingPath}`,
    `POST ${sendPath}`,
  ]);
});

test("an answer that still lists a policy unagreed draws the page with that one", async () => {
  const both = { policies: [terms, privacy] };
  await mounted(
    served(
      () => answer(both),
      () => answer(halfAgreed),
    ),
  );
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
    terms.title,
    privacy.title,
  ]);
  await press("Agree and continue");
  expect(routed()).toBe(false);
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
    privacy.title,
  ]);
  expect(agreeButton().hasAttribute("disabled")).toBe(false);
});

test("policies that changed under the page are read again, the button busy until they answer, and drawn under the info notice", async () => {
  const standings = [answer(halfAgreed)];
  const reread = heldAnswer();
  const { sent } = await mounted(
    served(
      () => standings.shift() ?? reread.answered,
      () =>
        answer(
          {
            error: {
              code: agreementPoliciesChangedCode,
              message: "changed",
            },
            policies: [terms, privacy],
          },
          409,
        ),
    ),
  );
  await press("Agree and continue");
  expect(centeredPageSaid().title).toBe("Agree to continue");
  expect(agreeButton().getAttribute("aria-busy")).toBe("true");
  const changedPrivacy = { ...privacy, version: "2026-12-01" };
  await act(async () => {
    reread.release(
      answer({ policies: [{ ...terms, agreedAt }, changedPrivacy] }),
    );
    await settled();
  });
  expect(requests(sent)).toStrictEqual([
    `GET ${standingPath}`,
    `POST ${sendPath}`,
    `GET ${standingPath}`,
  ]);
  expect(screen.getByRole("status").textContent).toBe(
    "These changed while this page was open.",
  );
  expect(screen.getByText("2026-12-01")).toBeTruthy();
  expect(agreeButton().hasAttribute("disabled")).toBe(false);
});

test("any other refusal of the send is drawn as the danger notice above the same list, the button pressable again", async () => {
  const { sent } = await mounted(
    served(
      () => answer(halfAgreed),
      () => answer({ error: { code: "InternalError", message: "no" } }, 500),
    ),
  );
  await press("Agree and continue");
  expect(screen.getByRole("alert").textContent).toBe(
    "Not recorded. Try again.",
  );
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
    privacy.title,
  ]);
  expect(agreeButton().hasAttribute("disabled")).toBe(false);
  await press("Agree and continue");
  expect(requests(sent)).toStrictEqual([
    `GET ${standingPath}`,
    `POST ${sendPath}`,
    `POST ${sendPath}`,
  ]);
});

test("a standing that could not be read draws Agreements not read and no router, and Retry reads it again", async () => {
  const standings = [
    answer({ error: { code: "InternalError", message: "no" } }, 500),
  ];
  const retried = heldAnswer();
  const { sent } = await mounted(
    served(() => standings.shift() ?? retried.answered),
  );
  expect(centeredPageSaid()).toStrictEqual({
    title: "Agreements not read",
    actions: ["Retry", "Sign out"],
  });
  expect(
    screen.getByText("chuggy could not read what you have agreed to."),
  ).toBeTruthy();
  expect(routed()).toBe(false);
  await press("Retry");
  expect(centeredPageSaid().title).toBe("Agreements not read");
  const retry = screen.getByRole("button", { name: "Retry" });
  expect(retry.getAttribute("aria-busy")).toBe("true");
  expect(retry.hasAttribute("disabled")).toBe(true);
  await act(async () => {
    retried.release(answer(allAgreed));
    await settled();
  });
  expect(routed()).toBe(true);
  expect(requests(sent)).toStrictEqual([
    `GET ${standingPath}`,
    `GET ${standingPath}`,
  ]);
});

test("a standing read again after a send that could not be read is no pass either", async () => {
  const standings = [answer(halfAgreed)];
  await mounted(
    served(
      () =>
        standings.shift() ??
        answer({ error: { code: "InternalError", message: "no" } }, 500),
      () =>
        answer(
          { error: { code: agreementPoliciesChangedCode, message: "x" } },
          409,
        ),
    ),
  );
  await press("Agree and continue");
  expect(centeredPageSaid().title).toBe("Agreements not read");
  expect(routed()).toBe(false);
});

test.each([
  ["the page", () => answer(halfAgreed)],
  [
    "the not-read page",
    () => answer({ error: { code: "InternalError", message: "no" } }, 500),
  ],
])(
  "Sign out on %s ends the session as the account menu's does",
  async (_page, standing) => {
    const { holder, harness } = await mounted(served(standing));
    const asked = harness.asked.length;
    await press("Sign out");
    expect(holder.snapshot().phase).toBe("SignedOut");
    expect(harness.asked.slice(asked)).toStrictEqual([
      expect.objectContaining({ url: "https://auth.example/oauth2/revoke" }),
    ]);
    expect(
      screen.getByRole("heading", { name: "Sign in to chuggy" }),
    ).toBeTruthy();
  },
);

test.each([
  ["under the page", halfAgreed, false],
  ["under the router", allAgreed, true],
])(
  "a renewal of the session %s reads nothing under /agreements/v1 and redraws nothing",
  async (_under, standing, router) => {
    const { holder, sent } = await mounted(served(() => answer(standing)));
    const before = requests(sent);
    const snapshot = holder.snapshot();
    await act(async () => {
      expect(await holder.refresh()).toBe(true);
      await settled();
    });
    expect(holder.snapshot()).not.toBe(snapshot);
    expect(holder.snapshot().phase).toBe("SignedIn");
    expect(requests(sent)).toStrictEqual(before);
    expect(routed()).toBe(router);
  },
);
