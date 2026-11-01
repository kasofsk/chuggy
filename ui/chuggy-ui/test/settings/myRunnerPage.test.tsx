/**
 * The My runners page, mounted: a member the workspace has not let register one
 * is told why and offered nothing; one it has is handed the personal command;
 * and a member with runners sees a row for each, registers another while under
 * the bound, gives them projects they read, takes them away, and takes one
 * runner off at a time; and their chat host is drawn, registered with a token
 * and taken off.
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

import {
  nativeHttpBasePath,
  personalRunnersMax,
} from "../../../../src/contract/http.ts";
import { MyRunnerPage } from "../../app/browser/settings/MyRunnerPage.tsx";
import {
  myRunnerRemovalLine,
  myRunnerWithheld,
} from "../../app/core/myRunner.ts";
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

/** A runner of the reader's whose id ends in `tail`, polling where `live`. */
function runnerListed(tail: string, live = true): unknown {
  return {
    id: `chuggy-personal-${tail}-0000-4000-8000-000000000000`,
    capabilities: ["Platform:Linux:Amd64"],
    registeredAt: "2026-10-01T00:00:00Z",
    polledAt: "2026-10-01T00:01:00Z",
    live,
    executionsLive: live,
  };
}

const runnerHeld = {
  runners: [runnerListed("3f2a9c1e")],
  projects: ["atlas"],
};

const runnersTwo = {
  runners: [runnerListed("3f2a9c1e"), runnerListed("a81c04d2", false)],
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
  /** Where set, the status a runner's removal is answered with. */
  removal?: number;
  /** The chat host every read answers; absent where the reader has none. */
  host?: unknown;
}

/** A chat host of the reader's whose id ends in `tail`, never polled. */
function hostListed(tail: string): unknown {
  return {
    id: `chuggy-personal-${tail}-0000-4000-8000-000000000000`,
    registeredAt: "2026-10-01T00:00:00Z",
    live: false,
  };
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
    if (path.startsWith(`${tenantPath}/personal-runner/runners/`))
      return drawing.removal === undefined
        ? answer(undefined, 204)
        : answer({ error: { code: "NotFound" } }, drawing.removal);
    if (path === `${nativeHttpBasePath}/projects`) return answer(inventory);
    if (path === `${tenantPath}/chat-host`) {
      if (request.method !== "GET") return answer(undefined, 204);
      return drawing.host === undefined
        ? answer({ error: { code: "NotFound" } }, 404)
        : answer(drawing.host);
    }
    if (path === `${tenantPath}/chat-host-registration-tokens`)
      return answer({ token: "tok_host-1", expiresAtMs: 1_800_000_000_000 });
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
  expect(
    screen.queryByRole("button", { name: "Register chat host" }),
  ).toBeNull();
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
    ["/personal-runner-registration-tokens", { lifetimeSecs: 3600 }],
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
  expect(row?.textContent).toContain("3f2a9c1e");
  expect(row?.textContent).toContain("Linux Amd64");
  expect(row?.textContent).toContain("Live");
  expect(screen.queryByText(myRunnerWithheld)).toBeNull();
  expect(screen.queryByRole("button", { name: "Register runner" })).toBeNull();
});

test("each of a member's runners is a row of its own, saying whether it is polling", async () => {
  drawing = { granted: true, runner: runnersTwo };
  await drawMyRunner();
  const rows = within(screen.getByRole("table", { name: "Runners" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => [
      row.querySelector("th")?.textContent?.includes("3f2a9c1e") === true
        ? "3f2a9c1e"
        : "a81c04d2",
      row.textContent?.includes("Live") === true ? "Live" : "Offline",
    ]);
  expect(rows).toStrictEqual([
    ["3f2a9c1e", "Live"],
    ["a81c04d2", "Offline"],
  ]);
  expect(screen.getByText("2 runners")).toBeTruthy();
});

test("a member holding a runner may register another, and one holding as many as a member may is told so", async () => {
  drawing = { granted: true, runner: runnerHeld };
  await drawMyRunner();
  expect(screen.getByRole("button", { name: "Register runner" })).toBeTruthy();
  cleanup();
  drawing = {
    granted: true,
    runner: {
      runners: Array.from({ length: personalRunnersMax }, (_, index) =>
        runnerListed(String(index).padStart(8, "0")),
      ),
      projects: [],
    },
  };
  await drawMyRunner();
  expect(screen.queryByRole("button", { name: "Register runner" })).toBeNull();
  expect(screen.getByText("Limit reached")).toBeTruthy();
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

test("taking one of two runners off is asked first, then sent by its id, and leaves the other listed", async () => {
  drawing = { granted: true, runner: runnersTwo };
  const sent = await drawMyRunner();
  await press("Remove runner a81c04d2");
  expect(written(sent)).toStrictEqual([]);
  expect(
    screen.getByRole("group", { name: "Remove runner a81c04d2?" }).textContent,
  ).toContain(myRunnerRemovalLine("a81c04d2", false));
  drawing.runner = runnerHeld;
  await press("Remove");
  expect(written(sent)).toStrictEqual([
    "DELETE /personal-runner/runners/chuggy-personal-a81c04d2-0000-4000-8000-000000000000",
  ]);
  expect(screen.getByText("1 runner")).toBeTruthy();
  expect(screen.queryByText(/a81c04d2/u)).toBeNull();
  expect(screen.getByText("3f2a9c1e")).toBeTruthy();
});

test("taking one runner off a list another removal emptied meanwhile leaves none listed", async () => {
  drawing = { granted: true, runner: runnersTwo };
  await drawMyRunner();
  await press("Remove runner 3f2a9c1e");
  drawing.runner = undefined;
  await press("Remove");
  expect(screen.getByText("0 runners")).toBeTruthy();
  expect(screen.queryByText(/a81c04d2/u)).toBeNull();
});

test("a runner already taken off elsewhere is answered as removed, and leaves none listed", async () => {
  drawing = { granted: true, runner: runnerHeld, removal: 404 };
  await drawMyRunner();
  await press("Remove runner 3f2a9c1e");
  drawing.runner = undefined;
  await press("Remove");
  expect(screen.queryByText(/^Refused/u)).toBeNull();
  expect(screen.getByText("0 runners")).toBeTruthy();
});

test("taking the last runner off says the projects go with it, and leaves none listed", async () => {
  drawing = { granted: true, runner: runnerHeld };
  const sent = await drawMyRunner();
  await press("Remove runner 3f2a9c1e");
  expect(
    screen.getByRole("group", { name: "Remove runner 3f2a9c1e?" }).textContent,
  ).toContain(myRunnerRemovalLine("3f2a9c1e", true));
  drawing.runner = undefined;
  await press("Remove");
  expect(written(sent)).toStrictEqual([
    "DELETE /personal-runner/runners/chuggy-personal-3f2a9c1e-0000-4000-8000-000000000000",
  ]);
  expect(screen.getByText("0 runners")).toBeTruthy();
  expect(screen.queryByRole("table", { name: "Runners" })).toBeNull();
  expect(screen.getByRole("button", { name: "Register runner" })).toBeTruthy();
});

test("a member with no chat host is handed a token that replaces nothing", async () => {
  const sent = await drawMyRunner();
  expect(screen.getByText("No chat host yet")).toBeTruthy();
  await press("Register chat host");
  expect(written(sent)).toStrictEqual(["POST /chat-host-registration-tokens"]);
  expect(screen.getByText("tok_host-1")).toBeTruthy();
  expect(screen.queryByText(/replaces chat host/u)).toBeNull();
});

test("a member's chat host is drawn with whether it has polled, and registering another hands over a token said to replace it and end its sessions", async () => {
  drawing = { granted: true, runner: undefined, host: hostListed("5be0d7aa") };
  const sent = await drawMyRunner();
  const row = within(screen.getByRole("table", { name: "Chat host" }))
    .getAllByRole("row")
    .slice(1);
  expect(row).toHaveLength(1);
  expect(row[0]?.textContent).toContain("5be0d7aa");
  expect(row[0]?.textContent).toContain("Never");
  expect(row[0]?.textContent).toContain("Offline");
  await press("Register chat host");
  expect(
    sent
      .filter((one) => one.method === "POST")
      .map((one) => [one.url.slice(tenantPath.length), one.body]),
  ).toStrictEqual([["/chat-host-registration-tokens", { lifetimeSecs: 3600 }]]);
  expect(screen.getByText("tok_host-1")).toBeTruthy();
  expect(
    screen.getByText("Replaces chat host 5be0d7aa · Ends its sessions"),
  ).toBeTruthy();
  await press("Done");
  expect(screen.queryByText("tok_host-1")).toBeNull();
});

test("a chat host is drawn though its owner may no longer register one, and taking it off is asked first, then sent, and leaves none", async () => {
  drawing = { granted: false, runner: undefined, host: hostListed("5be0d7aa") };
  const sent = await drawMyRunner();
  expect(
    screen.queryByRole("button", { name: "Register chat host" }),
  ).toBeNull();
  await press("Remove chat host 5be0d7aa");
  expect(written(sent)).toStrictEqual([]);
  expect(
    screen.getByRole("group", { name: "Remove chat host 5be0d7aa?" })
      .textContent,
  ).toContain(
    "Chat host 5be0d7aa stops taking your chats and questions in this workspace, and the sessions it is running now end.",
  );
  drawing.host = undefined;
  await press("Remove");
  expect(written(sent)).toStrictEqual(["DELETE /chat-host"]);
  expect(screen.queryByRole("table", { name: "Chat host" })).toBeNull();
  expect(screen.getByText("No chat host yet")).toBeTruthy();
});
