/**
 * The device approval page, mounted: the code filled from the link, the one
 * call Continue sends, where an approval sends the browser, and the line each
 * refusal is drawn as.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { DeviceDonePage, DevicePage } from "../app/browser/DevicePage.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { SignedOutCard } from "../app/browser/SessionCard.tsx";
import { deviceQueryOf } from "../app/core/deviceApproval.ts";
import { renderCopied } from "./copied.tsx";
import {
  answer,
  drawnStrict,
  heldAnswer,
  holderDouble,
  press,
  settled,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const held = vi.hoisted((): { redirects: string[] } => ({ redirects: [] }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  redirect: (url: string) => {
    held.redirects.push(url);
  },
}));
// jscpd:ignore-end -- the case's own doubles resume here

const linked = deviceQueryOf({
  device_challenge: "a-challenge",
  user_code: "BCDF-GHJK",
});

const redirectTo = "https://auth.invalid/oauth2/auth?device_verifier=v";

beforeEach(() => {
  held.redirects.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function refusal(status: number, code: string, retryAfter?: string): Response {
  const answered = answer({ error: { code, message: code } }, status);
  if (retryAfter !== undefined) answered.headers.set("retry-after", retryAfter);
  return answered;
}

async function continued(
  answered: (request: SentRequest) => Response,
): Promise<readonly SentRequest[]> {
  const { sent } = await drawnStrict(<DevicePage query={linked} />, answered);
  await press("Continue");
  return sent;
}

test("the code is filled from the link, under the guard's line, and nothing is sent before Continue", async () => {
  const { sent } = await drawnStrict(<DevicePage query={linked} />, () =>
    answer({}),
  );
  expect(screen.getByRole("textbox", { name: "Code" })).toHaveProperty(
    "value",
    "BCDF-GHJK",
  );
  expect(
    screen.getByText("Enter only a code shown on a device you are using"),
  ).toBeDefined();
  expect(sent).toStrictEqual([]);
});

test("a code of digits alone the router read as a number is still the code", () => {
  expect(deviceQueryOf({ device_challenge: "c", user_code: 1234 })).toEqual({
    challenge: "c",
    userCode: "1234",
  });
});

test("Continue hands the code and the challenge on once, and an approval sends the browser where the issuer said", async () => {
  const sent = await continued(() => answer({ redirectTo }));
  expect(sent).toHaveLength(1);
  expect(sent[0]?.method).toBe("POST");
  expect(sent[0]?.url).toContain("/device-approvals");
  expect(sent[0]?.body).toStrictEqual({
    challenge: "a-challenge",
    userCode: "BCDF-GHJK",
  });
  expect(held.redirects).toStrictEqual([redirectTo]);
});

for (const [why, answered, line] of [
  [
    "a code not accepted",
    () => refusal(422, "DeviceCodeNotAccepted"),
    "Code not accepted",
  ],
  [
    "a link expired",
    () => refusal(422, "DeviceLinkExpired"),
    "Link expired · open it again on the device",
  ],
  [
    "a spent bound",
    () => refusal(429, "DeviceTriesSpent", "130"),
    "Too many tries · try again in 3 min",
  ],
  [
    "a fault",
    () => refusal(503, "DeviceApprovalUnavailable", "1"),
    "Failed · try again",
  ],
] as const)
  test(`${why} is sent once and drawn as its own line, the browser staying`, async () => {
    const sent = await continued(answered);
    expect(sent).toHaveLength(1);
    expect(screen.getByText(line)).toBeDefined();
    expect(held.redirects).toStrictEqual([]);
    expect(
      screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled"),
    ).toBe(false);
  });

test("Continue is busy while its one call is out", async () => {
  const { answered, release } = heldAnswer();
  await drawnStrict(<DevicePage query={linked} />, () => answered);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await settled();
  const busy = screen.getByRole("button", { name: "Continue" });
  expect(busy.getAttribute("aria-busy")).toBe("true");
  expect(busy.hasAttribute("disabled")).toBe(true);
  release(answer({ redirectTo }));
  await settled();
  expect(held.redirects).toStrictEqual([redirectTo]);
});

test("a page opened without a challenge says to open the link the device shows", async () => {
  await drawnStrict(
    <DevicePage query={deviceQueryOf({ user_code: "BCDF" })} />,
    () => answer({}),
  );
  expect(screen.getByText("Open the link the device shows")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
});

test("the done page says the device is approved", async () => {
  await drawnStrict(<DeviceDonePage />, () => answer({}));
  expect(screen.getByText("Device approved · go back to it")).toBeDefined();
});

test("signing in from the page returns to it with the challenge and the code", async () => {
  const path = "/device?device_challenge=a-challenge&user_code=BCDF-GHJK";
  history.replaceState(null, "", path);
  const signIns: (string | undefined)[] = [];
  const signedOut = {
    phase: "SignedOut" as const,
    reason: undefined,
    configuration: undefined,
  };
  const holder = {
    ...holderDouble(),
    signIn: (returnTo?: string) => {
      signIns.push(returnTo);
      return Promise.resolve();
    },
    snapshot: () => signedOut,
  };
  renderCopied(
    <SessionProvider holder={holder}>
      <SignedOutCard />
    </SessionProvider>,
  );
  await press("Sign in");
  expect(signIns).toStrictEqual([path]);
  history.replaceState(null, "", "/");
});
