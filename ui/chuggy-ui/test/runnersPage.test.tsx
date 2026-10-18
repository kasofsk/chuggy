/**
 * The Runners page: the pools registered to the project, and the steps that
 * add another, each command copied by its own control.
 *
 * ADD IS AN ADMINISTRATOR'S PRESS. The page offers it only where the
 * execution placement read says this reader may choose a route, the same
 * signal the settings page's own Edit is gated on, so a reader with no choice
 * to make there is given no Add here either.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { RunnersPage } from "../app/browser/RunnersPage.tsx";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import {
  answer,
  openedStream,
  press,
  ScreenHarness,
  scriptedFetch,
  sectionOf,
  settled,
  turned,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { styleless } from "./styleless.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  currentOrigin: () => "https://chuggy.test",
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

/** What the page's copy controls put on the clipboard, in the order pressed. */
const copied: string[] = [];

beforeEach(() => {
  copied.length = 0;
  resizeObserverStubbed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Granted every route, so the reader may administer the pool roster. */
const granted = {
  work: { route: "InCluster", source: "Project" },
  evaluation: { route: "InCluster", source: "Override" },
  choices: ["InCluster", "Pool"],
};

const pools = {
  truncated: false,
  pools: [
    {
      pool: "shame",
      capabilities: ["Platform:Linux:Amd64"],
      registeredAt: "2026-09-29T00:00:00Z",
    },
  ],
};

const none = { truncated: false, pools: [] };

const install =
  "npm i -g https://github.com/kasofsk/chuggy-linux/releases/latest/download/chuggy-linux.tgz";

const register =
  "chuggy-linux register --api https://chuggy.test --token=tok-1";

function minted(): Response {
  return answer({ token: "tok-1", expiresAtMs: Date.now() + 60_000 });
}

interface Drawing {
  readonly placement?: unknown;
  readonly listed?: unknown;
  /** What a write answers, in the order the page makes them. */
  readonly written?: readonly Response[];
}

async function drawPage(
  drawing: Drawing = {},
): Promise<readonly SentRequest[]> {
  const placement: unknown = drawing.placement ?? granted;
  const listed: unknown = drawing.listed ?? pools;
  const written = [...(drawing.written ?? [])];
  const scripted = scriptedFetch((request) => {
    if (request.method !== "GET") return written.shift() ?? answer({}, 503);
    if (request.url.endsWith("/worker-pools")) return answer(listed);
    return answer(placement);
  });
  vi.stubGlobal("fetch", scripted.fetch);
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <CopyProvider
        write={(text) => {
          copied.push(text);
          return Promise.resolve(true);
        }}
      >
        <RunnersPage />
      </CopyProvider>
    </ScreenHarness>,
  );
  await settled();
  return scripted.sent;
}

/** The steps a mint draws, a list by its name. */
function steps(): HTMLElement {
  return screen.getByRole("list", { name: "Add runner" });
}

/** One step, by the title it opens with. */
function step(title: string): HTMLElement {
  const found = within(steps())
    .getAllByRole("listitem")
    .find((item) => item.textContent.startsWith(title));
  if (found === undefined) throw new Error(`no step is titled ${title}`);
  return found;
}

/** What a step's own copy control says it did. */
function said(title: string): string | null {
  return within(step(title)).getByRole("status").textContent;
}

function add(): HTMLElement {
  return screen.getByRole("button", { name: "Add runner" });
}

/** Opens the ask, fills it in as given, and mints. */
async function addRunner(
  asked: {
    readonly machine?: string;
    readonly host?: boolean;
    readonly typed?: string;
  } = {},
): Promise<void> {
  await press("Add runner");
  const machine = asked.machine;
  if (machine !== undefined)
    await turned(() => {
      fireEvent.click(screen.getByRole("radio", { name: machine }));
    });
  if (asked.host === true || asked.typed !== undefined) await press("Advanced");
  if (asked.host === true)
    await turned(() => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Run jobs without a container" }),
      );
    });
  if (asked.typed !== undefined)
    await turned(() => {
      fireEvent.change(screen.getByRole("textbox", { name: "Capabilities" }), {
        target: { value: asked.typed },
      });
    });
  await press("Create token");
}

test("a reader who may choose nothing is offered no runner to add, and still reads the runners", async () => {
  await drawPage({ placement: { ...granted, choices: [] } });
  expect(screen.queryByRole("button", { name: "Add runner" })).toBeNull();
  expect(
    within(sectionOf("Runners")).getAllByRole("row")[1]?.textContent,
  ).toMatch(/^shame/u);
});

test("a registered pool is a row naming its platforms", async () => {
  await drawPage();
  const rows = within(sectionOf("Runners")).getAllByRole("row");
  expect(rows[1]?.textContent).toMatch(/^shameLinux Amd64/u);
});

test("a roster holding more than one read answers says so under its rows", async () => {
  await drawPage({ listed: { ...pools, truncated: true } });
  expect(within(sectionOf("Runners")).getByText("More not shown")).toBeTruthy();
  cleanup();
  await drawPage();
  expect(screen.queryByText("More not shown")).toBeNull();
});

test("a project with a pool offers Add runner in the panel's head", async () => {
  await drawPage();
  expect(add().closest("header")).not.toBeNull();
  expect(add().className).toContain("btn-default");
});

test("a project with no pool says so, and Add runner is the one thing under the line", async () => {
  await drawPage({ listed: none });
  const line = within(sectionOf("Runners")).getByText("No runner registered");
  expect(add().closest("header")).toBeNull();
  expect(line.parentElement?.contains(add())).toBe(true);
  expect(add().className).toContain("btn-primary");
});

test("a project with no pool says so and no more to a reader who may not add", async () => {
  await drawPage({ listed: none, placement: { ...granted, choices: [] } });
  expect(
    within(sectionOf("Runners")).getByText("No runner registered"),
  ).toBeTruthy();
  expect(within(sectionOf("Runners")).queryAllByRole("button")).toHaveLength(0);
});

test("adding a runner mints a token for the Linux platforms", async () => {
  const sent = await drawPage({ written: [minted()] });
  await addRunner();
  const mint = sent.find((one) => one.method === "POST");
  expect(mint?.url.endsWith("/worker-pool-registration-tokens")).toBe(true);
  expect(mint?.body).toStrictEqual({
    capabilities: ["Platform:Linux:Amd64", "Platform:Linux:Arm64"],
    lifetimeSecs: 3600,
  });
});

test("a minted token is handed over in three steps, a list: install, register, and the guide for what is left", async () => {
  await drawPage({ written: [minted()] });
  await addRunner();
  expect(
    within(steps())
      .getAllByRole("listitem")
      .map((item) => item.firstElementChild?.firstElementChild?.textContent),
  ).toStrictEqual(["Install", "Register", "Finish"]);
  expect(step("Install").textContent).toContain(
    "Linux · Node 24 · Docker or Podman",
  );
  expect(step("Install").querySelector("code")?.textContent).toBe(install);
  expect(step("Register").querySelector("code")?.textContent).toBe(register);
  expect(step("Register").textContent).toContain("Expires");
  expect(step("Finish").querySelector("code")).toBeNull();
  const guide = within(step("Finish")).getByRole("link", {
    name: "Setup guide",
  });
  expect(guide.getAttribute("href")).toBe(
    "https://github.com/kasofsk/chuggy-linux#configure",
  );
  expect(guide.getAttribute("target")).toBe("_blank");
  expect(guide.getAttribute("rel")).toBe("noopener noreferrer");
  styleless();
});

test("each command is copied by its own control, which says Copied for itself alone", async () => {
  await drawPage({ written: [minted(), minted()] });
  await addRunner();
  expect([said("Install"), said("Register")]).toStrictEqual(["", ""]);
  await press("Copy install command");
  expect(copied).toStrictEqual([install]);
  expect([said("Install"), said("Register")]).toStrictEqual(["Copied", ""]);
  await press("Done");
  await addRunner();
  await press("Copy register command");
  expect(copied).toStrictEqual([install, register]);
  expect([said("Install"), said("Register")]).toStrictEqual(["", "Copied"]);
  expect(within(step("Finish")).queryByRole("button")).toBeNull();
});

test("the ask and then the steps take the focus as they are drawn, since an empty roster's Add runner is gone from under them", async () => {
  await drawPage({ listed: none, written: [minted()] });
  await press("Add runner");
  expect(document.activeElement).toBe(
    screen.getByRole("form", { name: "Runner" }),
  );
  await press("Create token");
  expect(document.activeElement).toBe(steps());
  expect(screen.queryByRole("button", { name: "Add runner" })).toBeNull();
  expect(
    within(sectionOf("Runners")).getByText("No runner registered"),
  ).toBeTruthy();
});

test("the steps leave the focus with whatever holds it as they are drawn", async () => {
  await drawPage({ listed: none, written: [minted()] });
  const elsewhere = document.body.appendChild(document.createElement("input"));
  elsewhere.focus();
  await addRunner();
  expect(steps()).toBeTruthy();
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});

test("Done puts the steps away and reads the pools again, and an empty roster offers Add runner again", async () => {
  const sent = await drawPage({ listed: none, written: [minted()] });
  const before = sent.filter((one) => one.url.endsWith("/worker-pools")).length;
  await addRunner();
  await press("Done");
  expect(screen.queryByRole("list", { name: "Add runner" })).toBeNull();
  expect(document.body.textContent).not.toContain("tok-1");
  expect(
    sent.filter((one) => one.url.endsWith("/worker-pools")).length,
  ).toBeGreaterThan(before);
  expect(add().closest("header")).toBeNull();
});

test("a mint the API refuses says so and draws no step", async () => {
  await drawPage({
    written: [answer({ error: { code: "Forbidden", message: "no" } }, 403)],
  });
  await addRunner();
  expect(
    within(sectionOf("Runners")).getByText(/^Refused · /u).textContent,
  ).toContain("Forbidden");
  expect(screen.queryByRole("list", { name: "Add runner" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Setup guide" })).toBeNull();
  expect(screen.getByRole("form", { name: "Runner" })).toBeTruthy();
  await press("Cancel");
  expect(screen.queryByRole("form", { name: "Runner" })).toBeNull();
  expect(add().closest("header")).not.toBeNull();
});

test("a Mac asked to run work on itself and to declare capabilities mints a token for them, and its steps install and register it so", async () => {
  const sent = await drawPage({ written: [minted()] });
  await addRunner({
    machine: "Mac",
    host: true,
    typed: "Agent:Claude Tool:Xcode",
  });
  expect(sent.find((one) => one.method === "POST")?.body).toStrictEqual({
    capabilities: [
      "Platform:Linux:Amd64",
      "Platform:Linux:Arm64",
      "Platform:MacOS:Amd64",
      "Platform:MacOS:Arm64",
      "Agent:Claude",
      "Tool:Xcode",
    ],
    lifetimeSecs: 3600,
  });
  expect(step("Install").textContent).toContain("macOS · Node 24 · Colima");
  expect(step("Install").querySelector("code")?.textContent).toBe(
    "npm i -g https://github.com/kasofsk/chuggy-darwin/releases/latest/download/chuggy-darwin.tgz",
  );
  expect(step("Register").querySelector("code")?.textContent).toBe(
    "chuggy-darwin register --api https://chuggy.test --token=tok-1 --host --capability Agent:Claude --capability Tool:Xcode",
  );
});

/** A refusal opens the fold it is drawn in, and the reader typing a fix there
 * is not folded away from it. */
test("a refusal of what was typed under a folded Advanced opens it, and it stays open while the reader fixes it", async () => {
  const sent = await drawPage({ written: [minted()] });
  await press("Add runner");
  await press("Advanced");
  const capabilities = (): HTMLElement =>
    screen.getByRole("textbox", { name: "Capabilities" });
  fireEvent.change(capabilities(), { target: { value: "_x" } });
  await press("Advanced");
  expect(screen.queryByRole("textbox", { name: "Capabilities" })).toBeNull();
  await press("Create token");
  expect(screen.getByText("_x · start with a letter or digit")).toBeTruthy();
  await turned(() => {
    fireEvent.change(capabilities(), { target: { value: "x" } });
  });
  expect(capabilities()).toBeTruthy();
  expect(sent.filter((one) => one.method === "POST")).toHaveLength(0);
});

test("capabilities typed that are not ones are refused before anything is minted", async () => {
  const sent = await drawPage({ written: [minted()] });
  await addRunner({ typed: "Platform:Linux:Amd64" });
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
