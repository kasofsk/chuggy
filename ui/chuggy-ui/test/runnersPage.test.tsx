/**
 * The Runners page: where the project's work runs and what decided it, the
 * pools registered to it, and the one command that adds another.
 *
 * THE HOSTED ROUTE IS THE CASE WITH TEETH. The page may offer only what the
 * read says the reader may choose, so a reader the tenant has not granted
 * hosted runs is never shown the choice, and a write the grant refuses anyway
 * is said in the section rather than drawn as written.
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
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import { styleless } from "./styleless.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const copied = vi.hoisted(() => ({ texts: [] as string[], allowed: true }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  currentOrigin: () => "https://chuggy.test",
  clipboardWritten: (text: string) => {
    copied.texts.push(text);
    return Promise.resolve(copied.allowed);
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  copied.texts.length = 0;
  copied.allowed = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

interface Drawing {
  readonly placement?: unknown;
  readonly listed?: unknown;
  /** What a write answers, in the order the page makes them. */
  readonly written?: readonly Response[];
}

async function drawPage(drawing: Drawing = {}): Promise<readonly Sent[]> {
  const placement: unknown = drawing.placement ?? granted;
  const listed: unknown = drawing.listed ?? pools;
  const written = [...(drawing.written ?? [])];
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    (
      url: string,
      init?: { readonly method?: string; readonly body?: string },
    ) => {
      const method = init?.method ?? "GET";
      sent.push({
        method,
        url,
        body: init?.body === undefined ? undefined : JSON.parse(init.body),
      });
      if (method !== "GET")
        return Promise.resolve(written.shift() ?? answer({}, 503));
      if (url.endsWith("/worker-pools")) return Promise.resolve(answer(listed));
      return Promise.resolve(answer(placement));
    },
  );
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <RunnersPage />
    </ScreenHarness>,
  );
  await settled();
  return sent;
}

function sectionOf(title: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${title}`) });
}

async function press(name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await settled();
}

function offered(kind: string): readonly string[] {
  return within(screen.getByRole("radiogroup", { name: kind }))
    .getAllByRole("radio")
    .map((radio) => radio.getAttribute("value") ?? "");
}

async function choose(kind: string, name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: kind })).getByRole(
        "radio",
        { name },
      ),
    );
  });
}

test("each kind is drawn with where it runs and what decided it", async () => {
  await drawPage();
  const rows = within(sectionOf("Placement")).getAllByRole("row");
  expect(rows.map((row) => row.textContent)).toStrictEqual([
    "KindRuns onSet by",
    "WorkHostedProject",
    "EvaluationHostedDeployment",
  ]);
  styleless();
});

test("a reader the tenant granted hosted runs is offered both routes, and a save writes both kinds", async () => {
  const sent = await drawPage({
    written: [
      answer({
        ...granted,
        evaluation: { route: "Pool", source: "Project" },
      }),
    ],
  });
  await press("Edit");
  expect(offered("Work")).toStrictEqual(["InCluster", "Pool"]);
  await choose("Evaluation", "Runners");
  await press("Save changes");
  const wrote = sent.find((one) => one.method === "PUT");
  expect(wrote?.url.endsWith("/execution-placement")).toBe(true);
  expect(wrote?.body).toStrictEqual({ work: "InCluster", evaluation: "Pool" });
  expect(screen.getByText("Written")).toBeTruthy();
  expect(
    within(sectionOf("Placement"))
      .getAllByRole("row")
      .map((row) => row.textContent),
  ).toContain("EvaluationRunnersProject");
});

test("a reader without the hosted grant is offered runners alone, and a draft starts there", async () => {
  const sent = await drawPage({
    placement: { ...granted, choices: ["Pool"] },
    written: [answer({ ...granted, choices: ["Pool"] })],
  });
  await press("Edit");
  expect(offered("Work")).toStrictEqual(["Pool"]);
  expect(offered("Evaluation")).toStrictEqual(["Pool"]);
  await press("Save changes");
  expect(sent.find((one) => one.method === "PUT")?.body).toStrictEqual({
    work: "Pool",
    evaluation: "Pool",
  });
});

test("a write the hosted grant refuses says so and stays open", async () => {
  await drawPage({
    written: [answer({ error: { code: "HostedRunsNotGranted" } }, 403)],
  });
  await press("Edit");
  await press("Save changes");
  expect(screen.getByText("Needs hosted runs")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
});

test("a reader who may choose nothing is given no Edit to press", async () => {
  await drawPage({ placement: { ...granted, choices: [] } });
  expect(
    screen.getByRole("button", { name: "Edit" }).hasAttribute("disabled"),
  ).toBe(true);
});

test("a registered pool is a row naming its platforms", async () => {
  await drawPage();
  const rows = within(sectionOf("Runners")).getAllByRole("row");
  expect(rows[1]?.textContent).toMatch(/^shameLinux Amd64/u);
});

test("a project with no pool says so", async () => {
  await drawPage({ listed: { truncated: false, pools: [] } });
  expect(
    within(sectionOf("Runners")).getByText("No runner registered"),
  ).toBeTruthy();
});

test("adding a runner mints a token for the Linux platforms and hands over one command, copied by one press", async () => {
  const sent = await drawPage({
    written: [answer({ token: "tok-1", expiresAtMs: Date.now() + 60_000 })],
  });
  await press("Add runner");
  const minted = sent.find((one) => one.method === "POST");
  expect(minted?.url.endsWith("/worker-pool-registration-tokens")).toBe(true);
  expect(minted?.body).toStrictEqual({
    capabilities: ["Platform:Linux:Amd64", "Platform:Linux:Arm64"],
    lifetimeSecs: 3600,
  });
  const command =
    "chuggy-linux register --api https://chuggy.test --token tok-1";
  expect(screen.getByLabelText("Command").textContent).toBe(command);
  await press("Copy");
  expect(copied.texts).toStrictEqual([command]);
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  styleless();
});

test("a copy the browser blocks says so", async () => {
  copied.allowed = false;
  await drawPage({
    written: [answer({ token: "tok-1", expiresAtMs: Date.now() + 60_000 })],
  });
  await press("Add runner");
  await press("Copy");
  expect(screen.getByText("Copy blocked")).toBeTruthy();
});

test("Done puts the command away and reads the pools again", async () => {
  const sent = await drawPage({
    written: [answer({ token: "tok-1", expiresAtMs: Date.now() + 60_000 })],
  });
  const before = sent.filter((one) => one.url.endsWith("/worker-pools")).length;
  await press("Add runner");
  await press("Done");
  expect(screen.queryByLabelText("Command")).toBeNull();
  expect(
    sent.filter((one) => one.url.endsWith("/worker-pools")).length,
  ).toBeGreaterThan(before);
});
