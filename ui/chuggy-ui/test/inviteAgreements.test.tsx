/**
 * The policies the open invite card names before sign-in, where the
 * deployment asks for agreement: two listed are drawn as links under the
 * card's line; none listed, a read that failed, or a deployment that asks for
 * none draws nothing; and the card's sign-in is pressable before they answer.
 */

import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { inviteConfiguration } from "./inviteDouble.ts";
import {
  agreementPrivacy as privacy,
  agreementTerms as terms,
} from "./agreementPolicies.ts";
import {
  inviteButtonsDrawn as drawnButtons,
  inviteOpened as opened,
} from "./invitePageDrawn.tsx";
import { answer, heldAnswer, press, settled } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const policiesPath = "/agreements/v1/policies";
const line = "After signing in you are asked to agree to:";

/** The open card under a deployment asking for agreement, its policies read
 * as `policies` answers. */
function openedAsking(
  policies: () => Response | Promise<Response>,
  agreements: { readonly agreements?: boolean } = { agreements: true },
): ReturnType<typeof opened> {
  return opened(
    "SignedOut",
    { anchor: "t0ken" },
    {
      configuration: { ...inviteConfiguration(), ...agreements },
      answered: (request: SentRequest) =>
        request.url === policiesPath ? policies() : answer({}, 404),
    },
  );
}

function policiesRead(sent: readonly SentRequest[]): number {
  return sent.filter((request) => request.url === policiesPath).length;
}

test("two policies listed are drawn after the card's line, each a link to its text in a tab of its own", async () => {
  const { sent } = await openedAsking(() =>
    answer({ policies: [terms, privacy] }),
  );
  expect(screen.getByText(line)).toBeTruthy();
  const links = screen.getAllByRole("link");
  expect(
    links.map((link) => [
      link.textContent,
      link.getAttribute("href"),
      link.getAttribute("target"),
      link.getAttribute("rel"),
    ]),
  ).toStrictEqual(
    [terms, privacy].map((policy) => [
      policy.title,
      policy.url,
      "_blank",
      "noopener noreferrer",
    ]),
  );
  expect(drawnButtons()).toStrictEqual(["Sign in with GitHub"]);
  expect(policiesRead(sent)).toBeGreaterThan(0);
});

test.each([
  ["none listed", () => answer({ policies: [] })],
  [
    "a read that failed",
    () => answer({ error: { code: "InternalError", message: "no" } }, 500),
  ],
])("%s draws nothing of them", async (_case, policies) => {
  await openedAsking(policies);
  expect(screen.getByRole("heading").textContent).toBe("Join Acme Co");
  expect(screen.queryByText(line)).toBeNull();
  expect(screen.queryAllByRole("link")).toStrictEqual([]);
});

test("a deployment whose configuration leaves agreements out reads no policies", async () => {
  const { sent } = await openedAsking(() => answer({ policies: [terms] }), {});
  expect(screen.getByRole("heading").textContent).toBe("Join Acme Co");
  expect(policiesRead(sent)).toBe(0);
  expect(screen.queryByText(line)).toBeNull();
});

test("the card's sign-in is pressable before the policies answer", async () => {
  const held = heldAnswer();
  const { signIns } = await openedAsking(() => held.answered);
  expect(screen.queryByText(line)).toBeNull();
  await press("Sign in with GitHub");
  expect(signIns).toStrictEqual(["/invite"]);
  await act(async () => {
    held.release(answer({ policies: [terms] }));
    await settled();
  });
});
