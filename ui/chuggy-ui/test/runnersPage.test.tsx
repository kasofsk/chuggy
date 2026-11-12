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
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
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
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";
import runnerMintSheet from "../app/browser/RunnerMint.css?raw";
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
      live: false,
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
  renderCopied(
    <ScreenHarness
      partition={leadPartition}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
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

/** Each registered runner's cells, by what each holds, its label aside. */
function rosterValues(): readonly (readonly string[])[] {
  return within(sectionOf("Registered runners"))
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      Array.from(
        row.children,
        (cell) => cell.querySelector(".tabular-value")?.textContent ?? "",
      ),
    );
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
        screen.getByRole("checkbox", { name: "Runs without a container" }),
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
  expect(rosterValues()[0]?.[0]).toMatch(/^shame/u);
});

test("the page is headed by one title, with what its runners are under it", async () => {
  await drawPage();
  const titles = screen.getAllByRole("heading", { level: 1 });
  expect(titles.map((title) => title.textContent)).toStrictEqual(["Runners"]);
  expect(titles[0]?.closest("header")?.textContent).toContain(
    "Machines that run this project's agents.",
  );
});

test("a registered pool is a card of its name and platforms, then its state, its version and when it last polled, each labelled", async () => {
  await drawPage();
  const table = screen.getByRole("table", { name: "Registered runners" });
  const row = within(table).getAllByRole("row")[1];
  expect(
    Array.from(
      row?.children ?? [],
      (cell) => cell.querySelector(".tabular-label")?.textContent,
    ),
  ).toStrictEqual(["Runner", "Status", "Version", "Last polled"]);
  expect(row?.firstElementChild?.getAttribute("role")).toBe("rowheader");
  expect(rosterValues()).toStrictEqual([
    ["shameLinux Amd64", "Offline", "—", "Never"],
  ]);
});

test("a runner's state is a word beside a mark, Live where its poll is recent and Offline where it is not", async () => {
  const pool = pools.pools[0];
  await drawPage({
    listed: {
      truncated: false,
      pools: [
        { ...pool, pool: "up", live: true, polledAt: "2026-09-30T00:00:00Z" },
        { ...pool, pool: "down" },
      ],
    },
  });
  const states = within(sectionOf("Registered runners"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.children[1]?.querySelector(".pill"));
  expect(states.map((state) => state?.textContent)).toStrictEqual([
    "Live",
    "Offline",
  ]);
  for (const state of states)
    expect(
      state?.querySelector(".pill-mark")?.getAttribute("aria-hidden"),
    ).toBe("true");
  expect(rosterValues()[0]?.[3]).not.toBe("Never");
});

test("a pool's version is drawn, Outdated where chuggy pins a later one, and a dash where none is known", async () => {
  const pool = pools.pools[0];
  await drawPage({
    listed: {
      truncated: false,
      pools: [
        {
          ...pool,
          pool: "behind",
          runner: {
            package: "chuggy-linux",
            version: "0.9.0",
            pinned: "0.10.0",
          },
        },
        {
          ...pool,
          pool: "current",
          runner: {
            package: "chuggy-linux",
            version: "0.10.0",
            pinned: "0.10.0",
          },
        },
        { ...pool, pool: "unnamed" },
      ],
    },
  });
  expect(rosterValues().map((cells) => cells[2])).toStrictEqual([
    "0.9.0Outdated",
    "0.10.0",
    "—",
  ]);
});

test("a roster holding more than one read answers says so under its rows", async () => {
  await drawPage({ listed: { ...pools, truncated: true } });
  expect(
    within(sectionOf("Registered runners")).getByText("More not shown"),
  ).toBeTruthy();
  cleanup();
  await drawPage();
  expect(screen.queryByText("More not shown")).toBeNull();
});

test("a project with a pool offers Add runner as the page head's one primary action", async () => {
  await drawPage();
  expect(add().closest("header")?.className).toBe("page-header");
  expect(add().className).toContain("btn-primary");
  expect(
    screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("btn-primary")),
  ).toStrictEqual([add()]);
});

test("a project with no pool says so in one line, and Add runner, which leads to the steps, is the one thing beside it", async () => {
  await drawPage({ listed: none, written: [minted()] });
  const line = within(sectionOf("Registered runners")).getByText(
    "No runner registered",
  );
  expect(add().closest("header")).toBeNull();
  expect(add().parentElement).toBe(line.parentElement);
  expect(line.parentElement?.className).toContain("flex-wrap");
  expect(add().className).toContain("btn-primary");
  await addRunner();
  expect(steps()).toBeTruthy();
});

test("a project with no pool says so and no more to a reader who may not add", async () => {
  await drawPage({ listed: none, placement: { ...granted, choices: [] } });
  expect(
    within(sectionOf("Registered runners")).getByText("No runner registered"),
  ).toBeTruthy();
  expect(
    within(sectionOf("Registered runners")).queryAllByRole("button"),
  ).toHaveLength(0);
});

test("adding a runner mints a token for how long it stands and nothing more", async () => {
  const sent = await drawPage({ written: [minted()] });
  await addRunner();
  const mint = sent.find((one) => one.method === "POST");
  expect(mint?.url.endsWith("/worker-pool-registration-tokens")).toBe(true);
  expect(mint?.body).toStrictEqual({ lifetimeSecs: 3600 });
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
    within(sectionOf("Registered runners")).getByText("No runner registered"),
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
    within(sectionOf("Registered runners")).getByText("Refused"),
  ).toBeDefined();
  expect(sectionOf("Registered runners").textContent).not.toContain(
    "Forbidden",
  );
  expect(screen.queryByRole("list", { name: "Add runner" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Setup guide" })).toBeNull();
  expect(screen.getByRole("form", { name: "Runner" })).toBeTruthy();
  await press("Cancel");
  expect(screen.queryByRole("form", { name: "Runner" })).toBeNull();
  expect(add().closest("header")).not.toBeNull();
});

test("a Mac asked to run work on itself and to declare capabilities mints a token that names none, and its steps install and register it so", async () => {
  const sent = await drawPage({ written: [minted()] });
  await addRunner({
    machine: "Mac",
    host: true,
    typed: "Agent:Claude Tool:Xcode",
  });
  expect(sent.find((one) => one.method === "POST")?.body).toStrictEqual({
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

test("the ask and the steps each measure their own column, and narrow, every press and link in them is a finger's height", async () => {
  await drawPage({ written: [minted()] });
  const wide = sheetRules(runnerMintSheet, []);
  const narrow = sheetRules(runnerMintSheet, [sheetNarrowCondition]);
  await press("Add runner");
  const form = screen.getByRole("form", { name: "Runner" });
  expect(sheetDeclared(wide, form, "container-type")).toBe("inline-size");
  for (const button of within(form).getAllByRole("button"))
    expect(sheetDeclared(narrow, button, "min-height")).toBe(
      "var(--height-touch)",
    );
  await press("Create token");
  const drawn = steps().parentElement ?? steps();
  expect(sheetDeclared(wide, drawn, "container-type")).toBe("inline-size");
  for (const control of [
    ...within(drawn).getAllByRole("button"),
    within(drawn).getByRole("link", { name: "Setup guide" }),
  ]) {
    expect(sheetDeclared(narrow, control, "min-height")).toBe(
      "var(--height-touch)",
    );
    expect(sheetDeclared(wide, control, "min-height")).toBe("");
  }
});
