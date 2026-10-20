/**
 * The My runner page, mounted: a member the workspace has not let register one
 * is told why and offered nothing; one it has is handed the personal command;
 * and a member with a runner sees it, gives it projects they read, takes them
 * away, and takes it off.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { nativeHttpBasePath } from "../../../../src/contract/http.ts";
import { MyRunnerPage } from "../../app/browser/settings/MyRunnerPage.tsx";
import { myRunnerWithheld } from "../../app/core/myRunner.ts";
import { sessionPlacementPolledMs } from "../../app/core/sessionRunners.ts";
import {
  answer,
  drawnStrict,
  heldAnswer,
  press,
  settled,
} from "../screenHarness.tsx";
import type { SentRequest } from "../screenHarness.tsx";
import { leadPartition } from "../leadFixture.ts";
import { resizeObserverStubbed } from "../resizeObserver.ts";
import type * as BrowserPorts from "../../app/browser/ports.ts";

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  currentOrigin: () => "https://chuggy.test",
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ tenant: leadPartition.tenant }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

const tenantPath = `${nativeHttpBasePath}/tenants/${leadPartition.tenant}`;

const runnerHeld = {
  runners: [
    {
      id: "chuggy-personal-1",
      capabilities: ["Platform:Linux:Amd64"],
      registeredAt: "2026-10-01T00:00:00Z",
      polledAt: "2026-10-01T00:01:00Z",
      live: true,
      executionsLive: true,
    },
  ],
  projects: ["atlas"],
};

/** Projects the reader reads: two in this workspace, one in another. */
const inventory = {
  projects: [
    { tenant: "acme", project: "atlas" },
    { tenant: "acme", project: "borealis" },
    { tenant: "other", project: "cirrus" },
  ],
};

interface Drawing {
  readonly granted: boolean;
  /** The runner every read answers, which a case may move; absent where the
   * reader has none. */
  runner: unknown;
  /** Where set, a read of the runner waits on it, as one over a network does. */
  held?: Promise<Response> | undefined;
}

let drawing: Drawing = { granted: true, runner: undefined };

beforeEach(() => {
  drawing = { granted: true, runner: undefined };
  resizeObserverStubbed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function drawMyRunner(): Promise<readonly SentRequest[]> {
  const drawn = await drawnStrict(<MyRunnerPage />, (request) => {
    const path = request.url.split("?")[0] ?? "";
    if (path === `${tenantPath}/personal-runner-permit`)
      return answer({ granted: drawing.granted });
    if (path === `${tenantPath}/personal-runner`) {
      if (request.method !== "GET") return answer(undefined, 204);
      if (drawing.held !== undefined) return drawing.held;
      return drawing.runner === undefined
        ? answer({ error: { code: "NotFound" } }, 404)
        : answer(drawing.runner);
    }
    if (path === `${nativeHttpBasePath}/projects`) return answer(inventory);
    if (path === `${tenantPath}/personal-runner-registration-tokens`)
      return answer({ token: "tok_en-1", expiresAtMs: 1_800_000_000_000 });
    if (path.startsWith(`${tenantPath}/personal-runner/projects/`))
      return answer(undefined, 204);
    return answer({}, 404);
  });
  await settled();
  return drawn.sent;
}

function written(sent: readonly SentRequest[]): readonly string[] {
  return sent
    .filter((one) => one.method !== "GET")
    .map((one) => `${one.method} ${one.url.slice(tenantPath.length)}`);
}

test("a member the workspace has not let register a runner is told why and offered nothing", async () => {
  drawing = { granted: false, runner: undefined };
  await drawMyRunner();
  expect(screen.getByText(myRunnerWithheld)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Register runner" })).toBeNull();
});

test("a member the workspace lets register one asks what it is for, and is handed the personal command for their token", async () => {
  const sent = await drawMyRunner();
  await press("Register runner");
  expect(sent.filter((one) => one.method === "POST")).toHaveLength(0);
  await press("Create token");
  expect(
    sent
      .filter((one) => one.method === "POST")
      .map((one) => [one.url.slice(tenantPath.length), one.body]),
  ).toStrictEqual([
    [
      "/personal-runner-registration-tokens",
      {
        capabilities: ["Platform:Linux:Amd64", "Platform:Linux:Arm64"],
        lifetimeSecs: 3600,
      },
    ],
  ]);
  const steps = screen.getByRole("list", { name: "Register runner" });
  expect(
    [...steps.querySelectorAll("code")].map((code) => code.textContent),
  ).toContain(
    "chuggy-linux register --personal --api https://chuggy.test --token=tok_en-1",
  );
});

/** The runner read again on its clock, as a page left open is, and drawn
 * while that read is still out; it answers none unless told otherwise. */
async function polled(): Promise<(status?: number) => Promise<void>> {
  const held = heldAnswer();
  drawing.held = held.answered;
  await act(() => vi.advanceTimersByTimeAsync(sessionPlacementPolledMs));
  await settled();
  return async (status = 404) => {
    drawing.held = undefined;
    held.release(answer({ error: { code: "NotFound" } }, status));
    await settled();
  };
}

/**
 * A READER WITH NO RUNNER IS READ AGAIN ON THE CLOCK, and an answer of none
 * that stands is no reason to take away what they are filling in, or the
 * command they were handed.
 */
test("the ask and the steps a member was handed stand through a read of their runner that answers none again, or fails", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const sent = await drawMyRunner();
  await press("Register runner");
  await press("Advanced");
  fireEvent.change(screen.getByRole("textbox", { name: "Capabilities" }), {
    target: { value: "Tool:Bazel" },
  });
  const reads = (): number =>
    sent.filter((one) => one.url.endsWith("/personal-runner")).length;
  const before = reads();
  const asking = await polled();
  expect(reads(), "the runner was not read again").toBeGreaterThan(before);
  const typed = (): string =>
    screen.getByRole<HTMLInputElement>("textbox", { name: "Capabilities" })
      .value;
  expect(typed()).toBe("Tool:Bazel");
  await asking();
  expect(typed()).toBe("Tool:Bazel");
  await press("Create token");
  const stepping = await polled();
  expect(screen.getByRole("list", { name: "Register runner" })).toBeTruthy();
  await stepping();
  expect(screen.getByRole("list", { name: "Register runner" })).toBeTruthy();
  await (
    await polled()
  )(502);
  expect(screen.getByRole("list", { name: "Register runner" })).toBeTruthy();
  await (
    await polled()
  )();
  expect(screen.getByRole("list", { name: "Register runner" })).toBeTruthy();
});

test("a runner is drawn with what it declared and whether it is polling, though its owner may no longer register one", async () => {
  drawing = { granted: false, runner: runnerHeld };
  await drawMyRunner();
  const row = screen.getAllByRole("row")[1];
  expect(row?.textContent).toContain("Linux Amd64");
  expect(row?.textContent).toContain("Live");
  expect(screen.queryByText(myRunnerWithheld)).toBeNull();
});

test("a runner is given only a project of this workspace the reader reads, and takes one away", async () => {
  drawing = { granted: true, runner: runnerHeld };
  const sent = await drawMyRunner();
  fireEvent.keyDown(screen.getByRole("button", { name: /^Add a project/u }), {
    key: "ArrowDown",
  });
  const menu = await screen.findByRole("menu");
  expect(
    within(menu)
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent),
  ).toStrictEqual(["borealis"]);
  fireEvent.click(
    within(menu).getByRole("menuitemradio", { name: "borealis" }),
  );
  await settled();
  await press("Remove atlas");
  expect(written(sent)).toStrictEqual([
    "PUT /personal-runner/projects/borealis",
    "DELETE /personal-runner/projects/atlas",
  ]);
});

test("taking the runner off is asked first, and then sent", async () => {
  drawing = { granted: true, runner: runnerHeld };
  const sent = await drawMyRunner();
  await press("Remove runner");
  expect(written(sent)).toStrictEqual([]);
  drawing.runner = undefined;
  await press("Remove");
  expect(written(sent)).toStrictEqual(["DELETE /personal-runner"]);
  expect(screen.getByRole("button", { name: "Register runner" })).toBeTruthy();
});
