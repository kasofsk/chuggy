/**
 * The personal runners page, mounted: a member the workspace has not let register one
 * is told why and offered nothing; one it has is handed the personal command;
 * and a member with runners sees a row for each, registers another while under
 * the bound, gives them projects they read, takes them away, and takes one
 * runner off at a time; and their chat host is drawn, registered on the
 * machine they choose by the steps it is handed over in, and taken off.
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
import { copyTextEn } from "../../app/copy/catalog.ts";
import { runnerPackages } from "../../app/core/runners.ts";
import type { RunnerPackageName } from "../../app/core/runners.ts";
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

/** A runner of the reader's whose id ends in `tail`, polling where `live`, holding `held`. */
function runnerListed(
  tail: string,
  live = true,
  held: readonly unknown[] = [],
  heldTruncated = false,
): unknown {
  return {
    id: `chuggy-personal-${tail}-0000-4000-8000-000000000000`,
    capabilities: ["Platform:Linux:Amd64"],
    registeredAt: "2026-10-01T00:00:00Z",
    polledAt: "2026-10-01T00:01:00Z",
    live,
    executionsLive: live,
    held,
    heldTruncated,
  };
}

/** A project the reader's runners serve at Normal, with `waiting` attempts waiting in it. */
function projectServed(
  project: string,
  waiting = 0,
  waitingTruncated = false,
): unknown {
  return { project, priority: "Normal", waiting, waitingTruncated };
}

const runnerHeld = {
  runners: [runnerListed("3f2a9c1e")],
  projects: [projectServed("atlas")],
};

const runnersTwo = {
  runners: [runnerListed("3f2a9c1e"), runnerListed("a81c04d2", false)],
  projects: [projectServed("atlas")],
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
  /** Where set, the status a runner's token mint is refused with. */
  mintRefused?: number;
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
      return drawing.mintRefused === undefined
        ? answer({ token: "tok_en-1", expiresAtMs: 1_800_000_000_000 })
        : answer(
            { error: { code: "Forbidden", message: "no" } },
            drawing.mintRefused,
          );
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
  expect(screen.getByText(copyTextEn(myRunnerWithheld))).toBeTruthy();
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

/** The steps a runner's mint is handed over in, a list by its name. */
function runnerSteps(): HTMLElement {
  return screen.getByRole("list", { name: "Register runner" });
}

/** One of those steps, by the title it opens with. */
function runnerStep(title: string): HTMLElement {
  const found = within(runnerSteps())
    .getAllByRole("listitem")
    .find((item) => item.textContent.startsWith(title));
  if (found === undefined) throw new Error(`no step is titled ${title}`);
  return found;
}

test("a minted token is handed over in three steps, a list: install, register, and the guide for what is left", async () => {
  await drawMyRunner();
  await press("Register runner");
  await press("Create token");
  expect(
    within(runnerSteps())
      .getAllByRole("listitem")
      .map((item) => item.firstElementChild?.firstElementChild?.textContent),
  ).toStrictEqual(["Install", "Register", "Finish"]);
  expect(runnerStep("Install").textContent).toContain(
    "Linux · Node 24 · Docker or Podman",
  );
  expect(runnerStep("Install").querySelector("code")?.textContent).toBe(
    runnerPackages.linux.installCommand,
  );
  expect(runnerStep("Register").textContent).toContain("Expires");
  expect(runnerStep("Finish").querySelector("code")).toBeNull();
  const guide = within(runnerStep("Finish")).getByRole("link", {
    name: "Setup guide",
  });
  expect(guide.getAttribute("href")).toBe(
    "https://github.com/kasofsk/chuggy-linux#configure",
  );
  expect(guide.getAttribute("target")).toBe("_blank");
  expect(guide.getAttribute("rel")).toBe("noopener noreferrer");
});

test("the steps leave the focus with whatever holds it as they are drawn", async () => {
  await drawMyRunner();
  await press("Register runner");
  const elsewhere = document.body.appendChild(document.createElement("input"));
  elsewhere.focus();
  await press("Create token");
  expect(runnerSteps()).toBeTruthy();
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});

test("a mint the API refuses says so, draws no step and returns to the ask, which Cancel puts away", async () => {
  drawing = { granted: true, runner: undefined, mintRefused: 403 };
  await drawMyRunner();
  await press("Register runner");
  await press("Create token");
  expect(screen.getByText("Refused")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Forbidden");
  expect(screen.queryByRole("list", { name: "Register runner" })).toBeNull();
  expect(screen.getByRole("form", { name: "Runner" })).toBeTruthy();
  await press("Cancel");
  expect(screen.queryByRole("form", { name: "Runner" })).toBeNull();
});

test("a Mac asked to run work on itself and to declare capabilities mints a token that names none, and its steps install and register it so", async () => {
  const sent = await drawMyRunner();
  await press("Register runner");
  fireEvent.click(screen.getByRole("radio", { name: "Mac" }));
  await press("Advanced");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Runs without a container" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Capabilities" }), {
    target: { value: "Agent:Claude Tool:Xcode" },
  });
  await press("Create token");
  expect(sent.find((one) => one.method === "POST")?.body).toStrictEqual({
    lifetimeSecs: 3600,
  });
  expect(runnerStep("Install").textContent).toContain(
    "macOS · Node 24 · Colima",
  );
  expect(runnerStep("Register").querySelector("code")?.textContent).toBe(
    "chuggy-darwin register --personal --api https://chuggy.test --token=tok_en-1 --host --capability Agent:Claude --capability Tool:Xcode",
  );
});

/** A refusal opens the fold it is drawn in, and the reader typing a fix there
 * is not folded away from it. */
test("a refusal of what was typed under a folded Advanced opens it, and it stays open while the reader fixes it", async () => {
  const sent = await drawMyRunner();
  await press("Register runner");
  await press("Advanced");
  const capabilities = (): HTMLElement =>
    screen.getByRole("textbox", { name: "Capabilities" });
  fireEvent.change(capabilities(), { target: { value: "_x" } });
  await press("Advanced");
  expect(screen.queryByRole("textbox", { name: "Capabilities" })).toBeNull();
  await press("Create token");
  expect(screen.getByText("_x · start with a letter or digit")).toBeTruthy();
  fireEvent.change(capabilities(), { target: { value: "x" } });
  await settled();
  expect(capabilities()).toBeTruthy();
  expect(sent.filter((one) => one.method === "POST")).toHaveLength(0);
});

test("capabilities typed that are not ones are refused before anything is minted", async () => {
  const sent = await drawMyRunner();
  await press("Register runner");
  await press("Advanced");
  fireEvent.change(screen.getByRole("textbox", { name: "Capabilities" }), {
    target: { value: "Platform:Linux:Amd64" },
  });
  await press("Create token");
  expect(sent.filter((one) => one.method === "POST")).toHaveLength(0);
  expect(
    screen.getByText("Platform:Linux:Amd64 is detected, not typed"),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("textbox", { name: "Capabilities" })
      .getAttribute("aria-invalid"),
  ).toBe("true");
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
  expect(screen.queryByText(copyTextEn(myRunnerWithheld))).toBeNull();
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
  expect(screen.getByText("2 personal runners")).toBeTruthy();
});

test("each runner says what it is running, each ticket linked with what it runs, and Idle where it holds nothing; each project says how many wait", async () => {
  drawing = {
    granted: true,
    runner: {
      runners: [
        runnerListed(
          "3f2a9c1e",
          true,
          [
            {
              project: "atlas",
              ticket: 12,
              identity: { type: "WorkTask", value: { ticket: 12, cycle: 1 } },
            },
            {
              project: "borealis",
              ticket: 4,
              identity: {
                type: "EvaluationTask",
                value: {
                  ticket: 4,
                  workCycle: 2,
                  stage: 1,
                  generation: 1,
                  evaluator: 1,
                },
              },
            },
          ],
          true,
        ),
        runnerListed("a81c04d2"),
      ],
      projects: [
        projectServed("atlas", 3),
        projectServed("borealis", 99, true),
      ],
    },
  };
  await drawMyRunner();
  const [busy, idle] = within(screen.getByRole("table", { name: "Runners" }))
    .getAllByRole("row")
    .slice(1);
  expect(
    within(busy ?? document.body)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toStrictEqual(["atlas #12", "borealis #4"]);
  expect(busy?.textContent).toContain("Work · cycle 1");
  expect(busy?.textContent).toContain("Stage 1 · cycle 2");
  expect(busy?.textContent).toContain("More not shown");
  expect(idle?.textContent).toContain("Idle");
  expect(
    within(screen.getByRole("table", { name: "Projects" }))
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelectorAll("td")[1]?.textContent),
  ).toStrictEqual(["Waiting3", "Waiting99+"]);
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

test("a project's priority is drawn and chosen from High, Normal and Low, and only a change is written, naming it", async () => {
  drawing = { granted: true, runner: runnerHeld };
  const sent = await drawMyRunner();
  const priority = screen.getByRole("button", {
    name: /^Priority of atlas/u,
  });
  expect(priority.textContent).toContain("Normal");
  const choose = async (name: string) => {
    fireEvent.keyDown(
      screen.getByRole("button", { name: /^Priority of atlas/u }),
      { key: "ArrowDown" },
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toStrictEqual(["High", "Normal", "Low"]);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name }));
    await settled();
  };
  await choose("Normal");
  await choose("High");
  expect(
    sent
      .filter((one) => one.method !== "GET")
      .map((one) => [one.method, one.url.slice(tenantPath.length), one.body]),
  ).toStrictEqual([
    ["PUT", "/personal-runner/projects/atlas", { priority: "High" }],
  ]);
});

test("taking one of two runners off is asked first, then sent by its id, and leaves the other listed", async () => {
  drawing = { granted: true, runner: runnersTwo };
  const sent = await drawMyRunner();
  await press("Remove runner a81c04d2");
  expect(written(sent)).toStrictEqual([]);
  expect(
    screen.getByRole("group", { name: "Remove runner a81c04d2?" }).textContent,
  ).toContain(copyTextEn(myRunnerRemovalLine("a81c04d2", false)));
  drawing.runner = runnerHeld;
  await press("Remove");
  expect(written(sent)).toStrictEqual([
    "DELETE /personal-runner/runners/chuggy-personal-a81c04d2-0000-4000-8000-000000000000",
  ]);
  expect(screen.getByText("1 personal runner")).toBeTruthy();
  expect(screen.queryByText(/a81c04d2/u)).toBeNull();
  expect(screen.getByText("3f2a9c1e")).toBeTruthy();
});

test("taking one runner off a list another removal emptied meanwhile leaves none listed", async () => {
  drawing = { granted: true, runner: runnersTwo };
  await drawMyRunner();
  await press("Remove runner 3f2a9c1e");
  drawing.runner = undefined;
  await press("Remove");
  expect(screen.getByText("0 personal runners")).toBeTruthy();
  expect(screen.queryByText(/a81c04d2/u)).toBeNull();
});

test("a runner already taken off elsewhere is answered as removed, and leaves none listed", async () => {
  drawing = { granted: true, runner: runnerHeld, removal: 404 };
  await drawMyRunner();
  await press("Remove runner 3f2a9c1e");
  drawing.runner = undefined;
  await press("Remove");
  expect(screen.queryByText(/^Refused/u)).toBeNull();
  expect(screen.getByText("0 personal runners")).toBeTruthy();
});

test("taking the last runner off says the projects go with it, and leaves none listed", async () => {
  drawing = { granted: true, runner: runnerHeld };
  const sent = await drawMyRunner();
  await press("Remove runner 3f2a9c1e");
  expect(
    screen.getByRole("group", { name: "Remove runner 3f2a9c1e?" }).textContent,
  ).toContain(copyTextEn(myRunnerRemovalLine("3f2a9c1e", true)));
  drawing.runner = undefined;
  await press("Remove");
  expect(written(sent)).toStrictEqual([
    "DELETE /personal-runner/runners/chuggy-personal-3f2a9c1e-0000-4000-8000-000000000000",
  ]);
  expect(screen.getByText("0 personal runners")).toBeTruthy();
  expect(screen.queryByRole("table", { name: "Runners" })).toBeNull();
  expect(screen.getByRole("button", { name: "Register runner" })).toBeTruthy();
});

/** Register chat host pressed, `machine` chosen and its token minted. */
async function chatHostRegistered(machine: string): Promise<void> {
  await press("Register chat host");
  await turnedMachine(machine);
  await press("Create token");
}

async function turnedMachine(machine: string): Promise<void> {
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "Machine" })).getByRole(
      "radio",
      {
        name: machine,
      },
    ),
  );
  await settled();
}

/** The commands the chat host's steps hand over, each in its own box. */
function chatHostStepsCommands(): readonly (string | null)[] {
  const steps = screen.getByRole("list", { name: "Register chat host" });
  return [...steps.querySelectorAll("code")].map((code) => code.textContent);
}

test("a member with no chat host chooses the machine before a token is minted, and is handed one that replaces nothing", async () => {
  const sent = await drawMyRunner();
  expect(screen.getByText("No chat host yet")).toBeTruthy();
  await press("Register chat host");
  expect(written(sent)).toStrictEqual([]);
  expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
  await press("Create token");
  expect(written(sent)).toStrictEqual(["POST /chat-host-registration-tokens"]);
  expect(chatHostStepsCommands()).toContain(
    "chuggy-linux register --api https://chuggy.test --token=tok_host-1 --chat",
  );
  expect(screen.queryByText(/replaces chat host/u)).toBeNull();
});

test("a chat host is handed over on each machine as its package's install, a register command carrying --chat and the minted token, and its package's chat host guide", async () => {
  for (const [machine, name, guide] of [
    ["Linux", "linux", "https://github.com/kasofsk/chuggy-linux#a-chat-host"],
    ["Mac", "darwin", "https://github.com/kasofsk/chuggy-darwin#chat-host"],
  ] as const satisfies readonly (readonly [
    string,
    RunnerPackageName,
    string,
  ])[]) {
    await drawMyRunner();
    await chatHostRegistered(machine);
    const offered = runnerPackages[name];
    expect(chatHostStepsCommands()).toStrictEqual([
      offered.installCommand,
      `${offered.program} register --api https://chuggy.test --token=tok_host-1 --chat`,
    ]);
    expect(
      within(screen.getByRole("list", { name: "Register chat host" }))
        .getByRole("link", { name: "Setup guide" })
        .getAttribute("href"),
    ).toBe(guide);
    cleanup();
  }
});

test("on Linux the line to paste into Claude Code, naming chat-host and the workspace and no token, comes before the steps, and on a Mac only the steps are handed over", async () => {
  await drawMyRunner();
  await chatHostRegistered("Linux");
  const line = screen.getByText(/chat-host --site/u);
  expect(line.textContent).toBe(
    `Make this machine my chuggy chat host: run "curl -fsS https://chuggy.test/chuggy-setup.mjs -o ~/.chuggy-setup.mjs && node ~/.chuggy-setup.mjs chat-host --site https://chuggy.test --workspace ${leadPartition.tenant}" and do what its output says.`,
  );
  expect(
    screen.getByText(
      "Paste into Claude Code on the machine that will be your chat host",
    ),
  ).toBeTruthy();
  expect(
    line.compareDocumentPosition(
      screen.getByRole("list", { name: "Register chat host" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  cleanup();
  await drawMyRunner();
  await chatHostRegistered("Mac");
  expect(screen.getByRole("list", { name: "Register chat host" })).toBeTruthy();
  expect(screen.queryByText(/chat-host --site/u)).toBeNull();
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
  await chatHostRegistered("Linux");
  expect(
    sent
      .filter((one) => one.method === "POST")
      .map((one) => [one.url.slice(tenantPath.length), one.body]),
  ).toStrictEqual([["/chat-host-registration-tokens", { lifetimeSecs: 3600 }]]);
  expect(chatHostStepsCommands().join(" ")).toContain("--token=tok_host-1");
  expect(
    screen.getByText("Replaces chat host 5be0d7aa · Ends its sessions"),
  ).toBeTruthy();
  await press("Done");
  expect(screen.queryByRole("list", { name: "Register chat host" })).toBeNull();
});

test("a member's chat host says what the chats it hosts may do where it named that, and that each may do everything its own roster allows where it named nothing", async () => {
  for (const [named, said] of [
    [
      ["ProjectRead", "ThreadOffer"],
      "Chats here may: Read the project, Offer you a page or an action",
    ],
    [[], "Chats here may: nothing"],
    [undefined, "Chats here may do everything their own roster allows"],
  ] as const) {
    drawing = {
      granted: true,
      runner: undefined,
      host: {
        ...(hostListed("5be0d7aa") as object),
        ...(named === undefined ? {} : { sessionCapabilities: [...named] }),
      },
    };
    await drawMyRunner();
    const [row] = within(screen.getByRole("table", { name: "Chat host" }))
      .getAllByRole("row")
      .slice(1);
    expect(row?.textContent).toContain(said);
    cleanup();
  }
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

test("no agent is said paused above a member's runners where their read answers none paused, or answers no pauses at all", async () => {
  for (const runner of [runnerHeld, { ...runnerHeld, pauses: [] }]) {
    drawing = { granted: true, runner };
    await drawMyRunner();
    expect(screen.queryByRole("group", { name: "Paused agents" })).toBeNull();
    cleanup();
  }
});

test("each agent the read of a member's runners answers paused is said above them, by its agent, with where it is set", async () => {
  drawing = {
    granted: true,
    runner: {
      ...runnerHeld,
      pauses: [
        {
          agent: "Claude",
          pause: {
            until: "2026-10-01T03:00:00Z",
            reasons: ["five_hour"],
            pressed: false,
          },
        },
        {
          agent: "Codex",
          pause: {
            until: "2026-10-01T05:00:00Z",
            reasons: ["seven_day", "limit"],
            pressed: false,
          },
        },
      ],
    },
  };
  await drawMyRunner();
  const paused = screen.getByRole("group", { name: "Paused agents" });
  expect(paused.textContent).toContain(
    "Claude · Paused · Five-hour window · until ",
  );
  expect(paused.textContent).toContain(
    "Codex · Paused · Weekly window · Provider limit · until ",
  );
  expect(within(paused).getAllByRole("link", { name: "Usage" })).toHaveLength(
    2,
  );
});
