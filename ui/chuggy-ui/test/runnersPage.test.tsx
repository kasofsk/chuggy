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
import { cleanup, render, screen, within } from "@testing-library/react";
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
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
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
  await press("Add runner");
  const mint = sent.find((one) => one.method === "POST");
  expect(mint?.url.endsWith("/worker-pool-registration-tokens")).toBe(true);
  expect(mint?.body).toStrictEqual({
    capabilities: ["Platform:Linux:Amd64", "Platform:Linux:Arm64"],
    lifetimeSecs: 3600,
  });
});

test("a minted token is handed over in three steps, a list: install, register, and the guide for what is left", async () => {
  await drawPage({ written: [minted()] });
  await press("Add runner");
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
  await press("Add runner");
  expect([said("Install"), said("Register")]).toStrictEqual(["", ""]);
  await press("Copy install command");
  expect(copied).toStrictEqual([install]);
  expect([said("Install"), said("Register")]).toStrictEqual(["Copied", ""]);
  await press("Done");
  await press("Add runner");
  await press("Copy register command");
  expect(copied).toStrictEqual([install, register]);
  expect([said("Install"), said("Register")]).toStrictEqual(["", "Copied"]);
  expect(within(step("Finish")).queryByRole("button")).toBeNull();
});

test("the steps take the focus as they are drawn, since an empty roster's Add runner is gone from under them", async () => {
  await drawPage({ listed: none, written: [minted()] });
  await press("Add runner");
  expect(document.activeElement).toBe(steps());
  expect(screen.queryByRole("button", { name: "Add runner" })).toBeNull();
  expect(
    within(sectionOf("Runners")).getByText("No runner registered"),
  ).toBeTruthy();
});

test("the steps leave the focus where a reader has put it since the press", async () => {
  await drawPage({ listed: none, written: [minted()] });
  const elsewhere = document.body.appendChild(document.createElement("input"));
  elsewhere.focus();
  await press("Add runner");
  expect(steps()).toBeTruthy();
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});

test("Done puts the steps away and reads the pools again, and an empty roster offers Add runner again", async () => {
  const sent = await drawPage({ listed: none, written: [minted()] });
  const before = sent.filter((one) => one.url.endsWith("/worker-pools")).length;
  await press("Add runner");
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
  await press("Add runner");
  expect(
    within(sectionOf("Runners")).getByText(/^Refused · /u).textContent,
  ).toContain("Forbidden");
  expect(screen.queryByRole("list", { name: "Add runner" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Setup guide" })).toBeNull();
  expect(add().closest("header")).not.toBeNull();
});
